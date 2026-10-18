import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { TrustTradeEscrow } from "../typechain-types";

describe("TrustTradeEscrow", function () {
  let escrow: TrustTradeEscrow;
  let buyer: any, seller: any, arbitrator: any, outsider: any;
  const amount = ethers.parseEther("1");

  async function create(deadlineOffset = 2 * 60 * 60) {
    const deadline = BigInt((await time.latest()) + deadlineOffset);
    const tx = await escrow.connect(buyer).createEscrow(seller.address, deadline, "Sample laptop", { value: amount });
    await tx.wait();
    return (await escrow.nextEscrowId()) - 1n;
  }

  beforeEach(async function () {
    [arbitrator, buyer, seller, outsider] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("TrustTradeEscrow", arbitrator);
    escrow = await Factory.deploy() as TrustTradeEscrow;
    await escrow.waitForDeployment();
  });

  it("creates and funds an escrow", async function () {
    const deadline = BigInt((await time.latest()) + 2 * 60 * 60);
    const tx = await escrow.connect(buyer).createEscrow(seller.address, deadline, "Sample laptop", { value: amount });
    await expect(tx).to.emit(escrow, "EscrowCreated").withArgs(0, buyer.address, seller.address, amount, deadline, "Sample laptop");
    const id = (await escrow.nextEscrowId()) - 1n;
    const item = await escrow.getEscrow(id);
    expect(item.buyer).to.equal(buyer.address);
    expect(item.seller).to.equal(seller.address);
    expect(item.amount).to.equal(amount);
    expect(item.status).to.equal(0);
    expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(amount);
  });

  it("releases payment after seller marks delivery; seller withdraws once", async function () {
    const id = await create();
    await expect(escrow.connect(seller).markDelivered(id)).to.emit(escrow, "DeliveryMarked");
    await expect(escrow.connect(buyer).releasePayment(id)).to.emit(escrow, "PaymentReleased").withArgs(id, buyer.address, seller.address, amount);
    expect(await escrow.pendingWithdrawals(seller.address)).to.equal(amount);
    await expect(escrow.connect(seller).withdraw(seller.address)).to.emit(escrow, "Withdrawal").withArgs(seller.address, seller.address, amount);
    expect(await escrow.pendingWithdrawals(seller.address)).to.equal(0);
    await expect(escrow.connect(seller).withdraw(seller.address)).to.be.revertedWithCustomError(escrow, "NothingToWithdraw");
  });

  it("rejects unauthorized actions", async function () {
    const id = await create();
    await expect(escrow.connect(outsider).markDelivered(id)).to.be.revertedWithCustomError(escrow, "NotSeller");
    await expect(escrow.connect(seller).releasePayment(id)).to.be.revertedWithCustomError(escrow, "NotBuyer");
    await expect(escrow.connect(outsider).resolveDispute(id, true)).to.be.revertedWithCustomError(escrow, "NotArbitrator");
  });

  it("allows buyer refund after the deadline", async function () {
    const id = await create();
    await expect(escrow.connect(buyer).claimRefund(id)).to.be.revertedWithCustomError(escrow, "RefundWindowOpen");
    const item = await escrow.getEscrow(id);
    await time.increaseTo(item.refundDeadline);
    await expect(escrow.connect(buyer).claimRefund(id)).to.emit(escrow, "RefundIssued").withArgs(id, buyer.address, amount);
    expect(await escrow.pendingWithdrawals(buyer.address)).to.equal(amount);
    await expect(escrow.connect(buyer).claimRefund(id)).to.be.revertedWithCustomError(escrow, "InvalidStatus");
  });

  it("arbitrator can resolve disputes to either party, and resolution is one-time", async function () {
    const buyerRefundId = await create();
    await escrow.connect(buyer).raiseDispute(buyerRefundId, "Item not received");
    await expect(escrow.connect(arbitrator).resolveDispute(buyerRefundId, true)).to.emit(escrow, "DisputeResolved");
    expect(await escrow.pendingWithdrawals(buyer.address)).to.equal(amount);
    await expect(escrow.connect(arbitrator).resolveDispute(buyerRefundId, false)).to.be.revertedWithCustomError(escrow, "InvalidStatus");

    const sellerPayId = await create();
    await escrow.connect(seller).raiseDispute(sellerPayId, "Buyer unresponsive");
    await escrow.connect(arbitrator).resolveDispute(sellerPayId, false);
    expect(await escrow.pendingWithdrawals(seller.address)).to.equal(amount);
  });

  it("prevents invalid states and invalid escrow terms", async function () {
    await expect(escrow.connect(buyer).createEscrow(seller.address, BigInt(await time.latest()) + 60n, "Item", { value: amount }))
      .to.be.revertedWithCustomError(escrow, "InvalidDeadline");
    await expect(escrow.connect(buyer).createEscrow(buyer.address, BigInt(await time.latest()) + 7200n, "Item", { value: amount }))
      .to.be.revertedWithCustomError(escrow, "InvalidSeller");
    await expect(escrow.connect(buyer).createEscrow(seller.address, BigInt(await time.latest()) + 7200n, "Item", { value: 0 }))
      .to.be.revertedWithCustomError(escrow, "InvalidAmount");
    const id = await create();
    await expect(escrow.connect(buyer).releasePayment(id)).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    await expect(escrow.connect(seller).raiseDispute(id, "bad")).to.emit(escrow, "DisputeRaised");
    await expect(escrow.connect(seller).markDelivered(id)).to.be.revertedWithCustomError(escrow, "InvalidStatus");
  });
});
