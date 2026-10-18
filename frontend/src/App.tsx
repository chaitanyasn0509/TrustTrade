import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserProvider, Contract, formatEther, parseEther } from "ethers";
import { Activity, ArrowUpRight, Check, ClipboardList, House, Moon, Plus, Search as SearchIcon, ShieldCheck, ShoppingBag, Sun, Trash2, X } from "lucide-react";
import { PRODUCTS, STATUS_LABELS } from "./data";
import type { Deployment, EscrowRow, HistoryRow } from "./types";

declare global { interface Window { ethereum?: any } }

const LOCAL_CHAIN = { chainId: "0x7a69", chainName: "Hardhat Local", nativeCurrency: { name: "Test Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["http://127.0.0.1:8545"] };
const shorten = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const txShort = (hash: string) => `${hash.slice(0, 10)}…${hash.slice(-6)}`;
const dateText = (timestamp: bigint) => new Date(Number(timestamp) * 1000).toLocaleString();

function App() {
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [arbitratorAddress, setArbitratorAddress] = useState("");
  const [account, setAccount] = useState("");
  const [chainName, setChainName] = useState("Not connected");
  const [balance, setBalance] = useState("0.00");
  const [escrows, setEscrows] = useState<EscrowRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [tab, setTab] = useState<"market" | "orders" | "activity">("market");
  const [selectedId, setSelectedId] = useState<bigint | null>(null);
  const [disputeReason, setDisputeReason] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lastHash, setLastHash] = useState("");
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<string[]>(() => {
    try { return JSON.parse(window.localStorage.getItem("trusttrade-cart") ?? "[]"); }
    catch { return []; }
  });
  const [cartOpen, setCartOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All items");
  const searchInput = useRef<HTMLInputElement>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try { return window.localStorage.getItem("trusttrade-theme") === "dark" ? "dark" : "light"; }
    catch { return "light"; }
  });

  const localNetwork = chainName === "Hardhat Local";
  const selectedEscrow = escrows.find((item) => item.id === selectedId) ?? null;
  const isArbitrator = Boolean(account && arbitratorAddress && account.toLowerCase() === arbitratorAddress.toLowerCase());
  const myOrders = useMemo(() => escrows.filter((item) => [item.buyer, item.seller].some((party) => party.toLowerCase() === account.toLowerCase())), [escrows, account]);
  const activeOrders = myOrders.filter((item) => item.status <= 2);
  const completedOrders = myOrders.filter((item) => item.status >= 3);
  const lockedValue = activeOrders.reduce((sum, item) => sum + item.amount, 0n);
  const cartProducts = PRODUCTS.filter((product) => cart.includes(product.id));
  const cartTotal = cartProducts.reduce((sum, product) => sum + parseEther(product.price), 0n);
  const categories = ["All items", ...new Set(PRODUCTS.map((product) => product.category))];
  const visibleProducts = PRODUCTS.filter((product) => (category === "All items" || product.category === category) && `${product.name} ${product.category} ${product.description}`.toLowerCase().includes(search.toLowerCase()));

  useEffect(() => { window.localStorage.setItem("trusttrade-cart", JSON.stringify(cart)); }, [cart]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("trusttrade-theme", theme);
  }, [theme]);
  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); searchInput.current?.focus(); }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  useEffect(() => {
    fetch("/contract-deployment.json").then((response) => response.json()).then((data) => {
      if (data.address && data.abi) setDeployment(data as Deployment);
    }).catch(() => undefined).finally(() => setLoading(false));
  }, []);

  const loadChainData = useCallback(async (activeAccount?: string) => {
    if (!deployment || !window.ethereum) return;
    try {
      const provider = new BrowserProvider(window.ethereum);
      const network = await provider.getNetwork();
      setChainName(Number(network.chainId) === 31337 ? "Hardhat Local" : `Chain ${network.chainId}`);
      if (activeAccount) {
        const value = await provider.getBalance(activeAccount);
        setBalance(Number(formatEther(value)).toFixed(2));
      }
      const contract = new Contract(deployment.address, deployment.abi, provider);
      setArbitratorAddress(await contract.arbitrator());
      const count = Number(await contract.nextEscrowId());
      const rows: EscrowRow[] = [];
      for (let i = 0; i < count; i++) {
        const row = await contract.getEscrow(i);
        rows.push({ id: BigInt(i), buyer: row.buyer, seller: row.seller, amount: row.amount, refundDeadline: row.refundDeadline, status: Number(row.status), description: row.description });
      }
      setEscrows(rows.reverse());

      const eventSpecs: [string, string, (args: any) => string][] = [
        ["EscrowCreated", "Escrow created", (args) => `${shorten(args.buyer)} funded ${formatEther(args.amount)} ETH`],
        ["DeliveryMarked", "Marked delivered", (args) => `Seller marked order #${args.escrowId} delivered`],
        ["PaymentReleased", "Payment released", (args) => `${formatEther(args.amount)} ETH credited to seller`],
        ["RefundIssued", "Refund claimed", (args) => `${formatEther(args.amount)} ETH credited to buyer`],
        ["DisputeRaised", "Dispute raised", (args) => args.reason],
        ["DisputeResolved", "Dispute resolved", (args) => `${formatEther(args.amount)} ETH awarded to ${shorten(args.recipient)}`],
        ["Withdrawal", "Funds withdrawn", (args) => `${formatEther(args.amount)} ETH withdrawn by ${shorten(args.account)}`],
      ];
      const logs = (await Promise.all(eventSpecs.map(async ([eventName, title, describe]) => {
        const entries = await contract.queryFilter(contract.filters[eventName](), 0, "latest");
        return entries.map((entry: any) => ({ escrowId: BigInt(entry.args.escrowId ?? 0), name: title, detail: describe(entry.args), hash: entry.transactionHash, blockNumber: entry.blockNumber }));
      }))).flat();
      setHistory(logs.sort((a, b) => b.blockNumber - a.blockNumber));
    } catch (problem: any) {
      setError(problem?.shortMessage || problem?.message || "Could not read the local chain. Is the Hardhat node running?");
    }
  }, [deployment]);

  useEffect(() => {
    if (!deployment || !window.ethereum) return;
    window.ethereum.request({ method: "eth_accounts" }).then((accounts: string[]) => {
      if (accounts[0]) setAccount(accounts[0]);
    }).catch(() => undefined);
    const accountChanged = (accounts: string[]) => { setAccount(accounts[0] ?? ""); setNotice(""); };
    const chainChanged = () => window.location.reload();
    window.ethereum.on("accountsChanged", accountChanged);
    window.ethereum.on("chainChanged", chainChanged);
    return () => { window.ethereum.removeListener("accountsChanged", accountChanged); window.ethereum.removeListener("chainChanged", chainChanged); };
  }, [deployment]);

  useEffect(() => { if (account && deployment) void loadChainData(account); }, [account, deployment, loadChainData]);

  async function connectWallet() {
    setError("");
    if (!window.ethereum) { setError("MetaMask was not found. Install the MetaMask browser extension to connect a local account."); return; }
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      if (accounts[0]) { setAccount(accounts[0]); await ensureLocalNetwork(); }
    } catch (problem: any) { setError(problem?.message || "Wallet connection was cancelled."); }
  }

  async function ensureLocalNetwork() {
    if (!window.ethereum) return;
    try { await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: LOCAL_CHAIN.chainId }] }); }
    catch (problem: any) {
      if (problem?.code !== 4902) throw problem;
      await window.ethereum.request({ method: "wallet_addEthereumChain", params: [LOCAL_CHAIN] });
    }
  }

  async function transact(label: string, action: (contract: Contract) => Promise<any>) {
    if (!window.ethereum || !deployment || !account) { setError("Connect MetaMask first."); return; }
    setBusy(label); setError(""); setNotice(""); setLastHash("");
    try {
      const provider = new BrowserProvider(window.ethereum);
      const network = await provider.getNetwork();
      if (Number(network.chainId) !== 31337) { await ensureLocalNetwork(); throw new Error("Switched MetaMask to Hardhat Local. Please retry the action."); }
      const signer = await provider.getSigner();
      const contract = new Contract(deployment.address, deployment.abi, signer);
      const tx = await action(contract);
      setLastHash(tx.hash);
      setNotice("Transaction submitted. Waiting for local confirmation…");
      await tx.wait();
      setNotice("Transaction confirmed on Hardhat Local.");
      await loadChainData(account);
    } catch (problem: any) { setError(problem?.shortMessage || problem?.reason || problem?.message || "Transaction failed."); }
    finally { setBusy(""); }
  }

  function addToCart(productId: string) {
    setCart((items) => items.includes(productId) ? items : [...items, productId]);
    setNotice("Added to your cart."); setError("");
  }

  async function checkoutCart() {
    if (!window.ethereum || !deployment || !account) { setError("Connect MetaMask before checkout."); return; }
    if (cartProducts.length === 0) return;
    const invalidProduct = cartProducts.find((product) => product.seller.toLowerCase() === account.toLowerCase());
    if (invalidProduct) { setError(`Switch to a buyer wallet. Your connected account is the seller of ${invalidProduct.name}.`); return; }
    setBusy(`Checkout 0/${cartProducts.length}`); setError(""); setNotice(""); setLastHash("");
    const completed: string[] = [];
    try {
      const provider = new BrowserProvider(window.ethereum);
      const network = await provider.getNetwork();
      if (Number(network.chainId) !== 31337) { await ensureLocalNetwork(); throw new Error("Switched MetaMask to Hardhat Local. Please retry checkout."); }
      const signer = await provider.getSigner();
      const contract = new Contract(deployment.address, deployment.abi, signer);
      for (const [index, product] of cartProducts.entries()) {
        setBusy(`Checkout ${index + 1}/${cartProducts.length} · ${product.name}`);
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 24 * 60 * 60);
        const tx = await contract.createEscrow(product.seller, deadline, product.name, { value: parseEther(product.price) });
        setLastHash(tx.hash);
        setNotice(`Confirm escrow ${index + 1} of ${cartProducts.length} in MetaMask…`);
        await tx.wait();
        completed.push(product.id);
        setCart((items) => items.filter((id) => id !== product.id));
        await loadChainData(account);
      }
      setNotice(`${completed.length} ${completed.length === 1 ? "escrow is" : "escrows are"} confirmed on Hardhat Local.`);
      setCartOpen(false);
    } catch (problem: any) {
      const reason = problem?.shortMessage || problem?.reason || problem?.message || "Checkout failed.";
      setError(completed.length ? `${completed.length} item${completed.length === 1 ? " was" : "s were"} secured; remaining cart items are still saved. ${reason}` : reason);
    } finally { setBusy(""); }
  }

  async function withdraw() {
    if (!account || !deployment || !window.ethereum) return;
    try {
      const provider = new BrowserProvider(window.ethereum);
      const contract = new Contract(deployment.address, deployment.abi, provider);
      const pending = await contract.pendingWithdrawals(account);
      if (pending === 0n) { setError("There are no escrow proceeds to withdraw for this wallet."); return; }
      void transact("Withdrawing funds", (signed) => signed.withdraw(account));
    } catch (problem: any) { setError(problem?.message || "Could not check withdrawable balance."); }
  }

  function raiseDispute() {
    if (!selectedEscrow || !disputeReason.trim()) { setError("Add a short reason before raising a dispute."); return; }
    void transact("Raising dispute", (contract) => contract.raiseDispute(selectedEscrow.id, disputeReason.trim()));
    setDisputeReason("");
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#top"><span className="brand-icon">T</span><span>trusttrade<small>LOCAL MARKETPLACE</small></span></a>
      <div className="side-label">WORKSPACE</div>
      <button className={`nav-item ${tab === "market" ? "active" : ""}`} onClick={() => setTab("market")}><span><House size={16} /></span> Marketplace</button>
      <button className={`nav-item ${tab === "orders" ? "active" : ""}`} onClick={() => setTab("orders")}><span><ClipboardList size={16} /></span> My escrows <span className="nav-count">{myOrders.length}</span></button>
      <button className={`nav-item ${tab === "activity" ? "active" : ""}`} onClick={() => setTab("activity")}><span><Activity size={16} /></span> Activity</button>
      <div className="sidebar-bottom">
        <div className="secure-note"><span className="secure-icon"><ShieldCheck size={15} /></span><strong>Protected by escrow</strong><p>Funds stay locked until you confirm delivery.</p></div>
        <div className="network-card"><span className={`network-dot ${localNetwork ? "online" : ""}`} /> <span>{chainName === "Not connected" ? "Connect to local chain" : chainName}</span></div>
        <div className="side-foot">TrustTrade v1.0 <span>·</span> Local demo</div>
      </div>
    </aside>

    <main className="main-area" id="top">
      <header className="topbar"><div className="mobile-brand"><span className="brand-icon">T</span> trusttrade</div><div className="topbar-right">
        <div className={`network-pill ${localNetwork ? "ok" : ""}`}><span className="network-dot" />{chainName}</div>
        <button className="theme-toggle" aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`} title={`Switch to ${theme === "light" ? "dark" : "light"} mode`} onClick={() => setTheme(theme === "light" ? "dark" : "light")}>{theme === "light" ? <Moon size={15} /> : <Sun size={15} />}</button>
        <button className={`cart-trigger ${cartOpen ? "is-open" : ""}`} aria-label={`Open cart, ${cart.length} items`} onClick={() => setCartOpen(true)}><ShoppingBag size={15} /><span>Cart</span><b>{cart.length}</b></button>
        {account ? <button className="wallet-button connected" onClick={connectWallet}><span className="avatar">{account.slice(2, 4).toUpperCase()}</span><span>{shorten(account)}<small>{balance} test ETH</small></span><span className="chevron">⌄</span></button> : <button className="wallet-button" onClick={connectWallet}>Connect wallet <span>↗</span></button>}
      </div></header>

      <div className="content">
        <div className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-dot" /> THE MARKETPLACE, REIMAGINED</div><h1>{tab === "market" ? <>Buy with <em>confidence.</em></> : tab === "orders" ? <>Your <em>escrows.</em></> : <>On-chain <em>activity.</em></>}</h1><p className="page-intro">{tab === "market" ? "Every purchase is protected by a smart contract. Your ETH is only released when you say so." : tab === "orders" ? "Track your purchases and sales, and take action when your order is ready." : "A clear record of every confirmed action on your local blockchain."}</p></div>
          {account && <div className="quick-total"><span>YOUR LOCKED FUNDS</span><strong>{formatEther(lockedValue)} <small>ETH</small></strong><span className="tiny-note">Across {activeOrders.length} active {activeOrders.length === 1 ? "escrow" : "escrows"}</span></div>}
        </div>

        {!deployment && <div className="setup-banner"><span className="setup-symbol">i</span><div><strong>{loading ? "Loading local contract…" : "Contract not deployed yet"}</strong><p>Start the Hardhat node, then run <code>npm run deploy:local</code> in a second terminal.</p></div></div>}
        {!account && deployment && <div className="setup-banner"><span className="setup-symbol">⌑</span><div><strong>Connect a local wallet to get started</strong><p>In MetaMask, connect to Hardhat Local (127.0.0.1:8545, chain ID 31337) and use a Hardhat test account.</p></div><button className="button button-dark" onClick={connectWallet}>Connect MetaMask</button></div>}
        {error && <div className="alert alert-error"><span>!</span><div>{error}</div><button onClick={() => setError("")}>×</button></div>}
        {notice && <div className="alert alert-success"><span>✓</span><div>{notice}{lastHash && <a href="#activity" onClick={() => setTab("activity")}>View transaction {txShort(lastHash)} ↗</a>}</div><button onClick={() => setNotice("")}>×</button></div>}

        {tab === "market" && <>
          <div className="catalog-heading"><div><div className="section-heading"><div><h2>Find your next favorite</h2><p>Thoughtful picks from the local community</p></div><div className="market-meta"><span className="live-dot" /> Escrow protected <span className="meta-divider" /> {PRODUCTS.length} items</div></div></div>
            <label className="search-box"><SearchIcon size={15} /><input ref={searchInput} aria-label="Search products" placeholder="Search the marketplace" value={search} onChange={(event) => setSearch(event.target.value)} /><kbd>Ctrl K</kbd></label>
          </div>
          <div className="category-row">{categories.map((item) => <button key={item} className={`category-chip ${category === item ? "selected" : ""}`} onClick={() => setCategory(item)}>{item}</button>)}</div>
          <div className="product-grid">{visibleProducts.map((product) => <article className="product-card" key={product.id}>
            <div className={`product-art art-${product.tone} with-photo`}><span className="art-index">{String(PRODUCTS.indexOf(product) + 1).padStart(2, "0")}</span><img className="product-photo" src={`/images/${product.id}.png`} alt={product.name} /><span className="art-category">{product.category}</span></div>
            <div className="product-info"><div className="product-title-row"><h3>{product.name}</h3><span className="verified">✓</span></div><p>{product.description}</p>
              <div className="seller-row"><span className="seller-avatar">{product.seller.slice(2, 4).toUpperCase()}</span><span><small>SELLER</small><strong>{shorten(product.seller)}</strong></span><span className="seller-check">✓</span></div>
              <div className="buy-row"><div><strong>{product.price}</strong><span> ETH</span><small>Test ETH · escrow protected</small></div><button className={`button ${cart.includes(product.id) ? "button-added" : "button-buy"}`} disabled={Boolean(busy) || cart.includes(product.id)} onClick={() => addToCart(product.id)}>{cart.includes(product.id) ? <>In cart <Check size={13} /></> : <>Add to cart <Plus size={14} /></>}</button></div>
            </div>
          </article>)}</div>
          {visibleProducts.length === 0 && <div className="catalog-empty"><span>⌕</span><strong>No items match that search</strong><p>Try a different name or category.</p><button className="text-button" onClick={() => { setSearch(""); setCategory("All items"); }}>Clear filters</button></div>}
          <div className="how-card"><div className="how-title"><span className="how-icon">⌑</span><div><strong>A safer way to trade</strong><p>Three simple steps. Your funds stay in your control.</p></div></div><div className="steps"><div><b>01</b><span><strong>Pay into escrow</strong><small>Your ETH is held securely on-chain.</small></span></div><div><b>02</b><span><strong>Seller ships your item</strong><small>Track the order as it progresses.</small></span></div><div><b>03</b><span><strong>Confirm & release</strong><small>Payment only releases when you approve.</small></span></div></div></div>
        </>}

        {tab === "orders" && <>
          <div className="stats-grid"><Stat label="Active escrows" value={String(activeOrders.length)} icon="◷" /><Stat label="Completed" value={String(completedOrders.length)} icon="✓" /><Stat label="Funds locked" value={`${Number(formatEther(lockedValue)).toFixed(3)} ETH`} icon="⌑" /><button className="stat-card withdraw-card" onClick={withdraw} disabled={!account || Boolean(busy)}><span className="stat-icon">↗</span><span className="stat-label">Available to withdraw</span><strong>Withdraw funds</strong><small>For the connected wallet</small></button></div>
          <div className="section-heading order-heading"><div><h2>Your orders</h2><p>You're shown as a buyer or seller</p></div><button className="text-button" onClick={() => void loadChainData(account)}>↻ Refresh</button></div>
          {myOrders.length === 0 ? <EmptyState title="No escrows yet" text="Secure your first purchase from the marketplace. Your orders will appear here after the transaction confirms." onClick={() => setTab("market")} action="Explore marketplace" /> : <div className="order-list">{myOrders.map((order) => <OrderCard key={String(order.id)} order={order} account={account} selected={selectedId === order.id} onSelect={() => { setSelectedId(selectedId === order.id ? null : order.id); setDisputeReason(""); }} />)}</div>}
          {selectedEscrow && <section className="detail-panel"><div className="detail-head"><div><div className="eyebrow">ESCROW #{selectedEscrow.id.toString().padStart(4, "0")}</div><h2>{selectedEscrow.description}</h2></div><StatusBadge status={selectedEscrow.status} /></div><div className="detail-grid"><Detail label="Amount secured" value={`${formatEther(selectedEscrow.amount)} ETH`} /><Detail label="Buyer" value={shorten(selectedEscrow.buyer)} copy={selectedEscrow.buyer} /><Detail label="Seller" value={shorten(selectedEscrow.seller)} copy={selectedEscrow.seller} /><Detail label="Refund deadline" value={dateText(selectedEscrow.refundDeadline)} /></div>
            <div className="action-area">{selectedEscrow.status === 0 && account.toLowerCase() === selectedEscrow.seller.toLowerCase() && <button className="button button-dark" disabled={Boolean(busy)} onClick={() => void transact("Marking delivered", (contract) => contract.markDelivered(selectedEscrow.id))}>Mark as delivered ↗</button>}
              {selectedEscrow.status === 1 && account.toLowerCase() === selectedEscrow.buyer.toLowerCase() && <button className="button button-dark" disabled={Boolean(busy)} onClick={() => void transact("Releasing payment", (contract) => contract.releasePayment(selectedEscrow.id))}>Confirm receipt & release ↗</button>}
              {selectedEscrow.status === 0 && account.toLowerCase() === selectedEscrow.buyer.toLowerCase() && BigInt(Math.floor(Date.now() / 1000)) >= selectedEscrow.refundDeadline && <button className="button button-outline" disabled={Boolean(busy)} onClick={() => void transact("Claiming refund", (contract) => contract.claimRefund(selectedEscrow.id))}>Claim timeout refund</button>}
              {(selectedEscrow.status === 0 || selectedEscrow.status === 1) && [selectedEscrow.buyer, selectedEscrow.seller].some((party) => party.toLowerCase() === account.toLowerCase()) && <div className="dispute-control"><label htmlFor="dispute">Need help? Raise a dispute</label><div><input id="dispute" maxLength={512} placeholder="Briefly explain the issue…" value={disputeReason} onChange={(event) => setDisputeReason(event.target.value)} /><button className="button button-outline" disabled={Boolean(busy) || !disputeReason.trim()} onClick={raiseDispute}>Raise dispute</button></div></div>}
              {selectedEscrow.status === 2 && isArbitrator && <div className="arbitrator-actions"><strong>Arbitrator resolution</strong><button className="button button-outline" disabled={Boolean(busy)} onClick={() => void transact("Refunding buyer", (contract) => contract.resolveDispute(selectedEscrow.id, true))}>Refund buyer</button><button className="button button-dark" disabled={Boolean(busy)} onClick={() => void transact("Releasing to seller", (contract) => contract.resolveDispute(selectedEscrow.id, false))}>Release to seller</button></div>}
              {selectedEscrow.status === 2 && !isArbitrator && <p className="pending-note">This order is disputed. The local contract deployer is the authorized arbitrator.</p>}
              {selectedEscrow.status >= 3 && <p className="pending-note">This escrow is complete. The winner can withdraw their credited funds from the dashboard.</p>}
              {busy && <span className="busy-text"><span className="spinner" />{busy}…</span>}
            </div></section>}
        </>}

        {tab === "activity" && <div id="activity"><div className="section-heading"><div><h2>Transaction history</h2><p>Events read directly from your local contract</p></div><button className="text-button" onClick={() => void loadChainData(account)}>↻ Refresh</button></div>
          {history.length === 0 ? <EmptyState title="No activity yet" text="Confirmed escrow transactions will appear here with their real local-chain transaction hashes." onClick={() => setTab("market")} action="Browse listings" /> : <div className="history-list">{history.map((item, index) => <div className="history-row" key={`${item.hash}-${index}`}><span className="history-icon">{item.name.includes("dispute") ? "!" : item.name.includes("withdrawn") ? "↗" : item.name.includes("created") ? "＋" : "✓"}</span><div className="history-main"><strong>{item.name}</strong><span>{item.detail}</span></div><a className="hash-link" href={`http://127.0.0.1:8545`} title={item.hash} onClick={(event) => { event.preventDefault(); navigator.clipboard?.writeText(item.hash); setNotice(`Copied transaction hash ${item.hash}`); }}>{txShort(item.hash)} <span>⧉</span></a><small className="block-tag">Block {item.blockNumber}</small></div>)}</div>}
        </div>}

        <footer className="footer"><span>© 2026 TrustTrade</span><span><span className="footer-dot" /> Local blockchain · Test ETH only</span><span>Built for safer trades</span></footer>
      </div>
    </main>
    {cartOpen && <div className="cart-backdrop" role="presentation" onClick={() => setCartOpen(false)}><aside className="cart-drawer" role="dialog" aria-modal="true" aria-label="Shopping cart" onClick={(event) => event.stopPropagation()}>
      <div className="cart-head"><div><span className="eyebrow"><span className="eyebrow-dot" /> YOUR BAG</span><h2>Shopping cart <small>{cartProducts.length}</small></h2></div><button className="icon-button" aria-label="Close cart" onClick={() => setCartOpen(false)}><X size={16} /></button></div>
      {cartProducts.length === 0 ? <div className="cart-empty"><span className="cart-empty-icon"><ShoppingBag size={21} /></span><strong>Your cart is taking a breather</strong><p>Add something you love and we’ll keep it safe here.</p><button className="button button-dark" onClick={() => setCartOpen(false)}>Explore the marketplace <ArrowUpRight size={13} /></button></div> : <>
        <div className="cart-local-note"><span><ShieldCheck size={15} /></span><div><strong>Protected checkout</strong><small>Each item creates its own on-chain escrow.</small></div></div>
        <div className="cart-lines">{cartProducts.map((product) => <div className="cart-line" key={product.id}><img className="cart-thumb" src={`/images/${product.id}.png`} alt={product.name} /><div className="cart-line-info"><strong>{product.name}</strong><small>{shorten(product.seller)} · seller</small><b>{product.price} ETH</b></div><button className="remove-item" aria-label={`Remove ${product.name}`} onClick={() => setCart((items) => items.filter((id) => id !== product.id))}><Trash2 size={14} /></button></div>)}</div>
        <div className="cart-summary"><div><span>Items</span><strong>{cartProducts.length}</strong></div><div><span>Network</span><strong>Hardhat Local</strong></div><div className="cart-total"><span>Subtotal</span><strong>{formatEther(cartTotal)} ETH</strong></div><p>Network gas is paid in local test ETH. No real money is used.</p><button className="button button-checkout" disabled={!deployment || !account || Boolean(busy)} onClick={() => void checkoutCart()}>{busy.startsWith("Checkout") ? <><span className="spinner" />{busy}</> : !account ? <>Connect wallet to checkout ↗</> : <>Secure checkout <span>↗</span></>}</button><small className="checkout-hint">{!account ? "Connect your local MetaMask wallet first." : `MetaMask will request ${cartProducts.length} separate confirmation${cartProducts.length === 1 ? "" : "s"}.`}</small></div>
      </>}
    </aside></div>}
  </div>;
}

function Stat({ label, value, icon }: { label: string; value: string; icon: string }) { return <div className="stat-card"><span className="stat-icon">{icon}</span><span className="stat-label">{label}</span><strong>{value}</strong><small>From confirmed contract data</small></div>; }
function Detail({ label, value, copy }: { label: string; value: string; copy?: string }) { return <div><span>{label}</span><strong title={copy}>{value}</strong></div>; }
function StatusBadge({ status }: { status: number }) { return <span className={`status-badge status-${status}`}><i />{STATUS_LABELS[status]}</span>; }
function OrderCard({ order, account, selected, onSelect }: { order: EscrowRow; account: string; selected: boolean; onSelect: () => void }) {
  const role = account.toLowerCase() === order.buyer.toLowerCase() ? "BUYER" : "SELLER";
  return <button className={`order-card ${selected ? "selected" : ""}`} onClick={onSelect}><span className="order-glyph">{order.status === 3 ? "✓" : order.status === 4 ? "↩" : "⌑"}</span><span className="order-product"><strong>{order.description}</strong><small>#{order.id.toString().padStart(4, "0")} <span>·</span> {role} <span>·</span> {shorten(role === "BUYER" ? order.seller : order.buyer)}</small></span><span className="order-amount">{formatEther(order.amount)} <small>ETH</small></span><StatusBadge status={order.status} /><span className="order-chevron">›</span></button>;
}
function EmptyState({ title, text, action, onClick }: { title: string; text: string; action: string; onClick: () => void }) { return <div className="empty-state"><span className="empty-icon">⌑</span><strong>{title}</strong><p>{text}</p><button className="button button-dark" onClick={onClick}>{action} ↗</button></div>; }

export default App;
