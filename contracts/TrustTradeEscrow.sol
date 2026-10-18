// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title TrustTradeEscrow
/// @notice Testnet/local-chain escrow. The deployer is the immutable arbitrator.
/// @dev Arbitrator permissions are limited to resolving an active dispute. Funds
///      are credited to the winning party and withdrawn separately using pull payments.
contract TrustTradeEscrow is ReentrancyGuard {
    enum Status { Funded, Delivered, Disputed, Released, Refunded }

    struct Escrow {
        address buyer;
        address seller;
        uint256 amount;
        uint64 refundDeadline;
        Status status;
        string description;
    }

    address public immutable arbitrator;
    uint256 public nextEscrowId;
    mapping(uint256 => Escrow) private escrows;
    mapping(address => uint256) public pendingWithdrawals;

    event EscrowCreated(uint256 indexed escrowId, address indexed buyer, address indexed seller, uint256 amount, uint64 refundDeadline, string description);
    event DeliveryMarked(uint256 indexed escrowId, address indexed seller);
    event PaymentReleased(uint256 indexed escrowId, address indexed buyer, address indexed seller, uint256 amount);
    event RefundIssued(uint256 indexed escrowId, address indexed buyer, uint256 amount);
    event DisputeRaised(uint256 indexed escrowId, address indexed raisedBy, string reason);
    event DisputeResolved(uint256 indexed escrowId, address indexed arbitrator, address indexed recipient, bool refundedToBuyer, uint256 amount);
    event Withdrawal(address indexed account, address indexed recipient, uint256 amount);

    error InvalidSeller();
    error InvalidAmount();
    error InvalidDeadline();
    error InvalidDescription();
    error NotBuyer();
    error NotSeller();
    error NotArbitrator();
    error InvalidStatus();
    error RefundWindowOpen();
    error RefundWindowClosed();
    error EmptyReason();
    error NothingToWithdraw();
    error TransferFailed();
    error InvalidEscrow();

    constructor() { arbitrator = msg.sender; }

    /// @notice Creates a funded escrow. Refund deadline must be at least one hour away.
    function createEscrow(address seller, uint64 refundDeadline, string calldata description)
        external payable returns (uint256 escrowId)
    {
        if (seller == address(0) || seller == msg.sender) revert InvalidSeller();
        if (msg.value == 0) revert InvalidAmount();
        if (refundDeadline < block.timestamp + 1 hours) revert InvalidDeadline();
        if (bytes(description).length == 0 || bytes(description).length > 256) revert InvalidDescription();

        escrowId = nextEscrowId++;
        escrows[escrowId] = Escrow(msg.sender, seller, msg.value, refundDeadline, Status.Funded, description);
        emit EscrowCreated(escrowId, msg.sender, seller, msg.value, refundDeadline, description);
        emit EscrowCreated(escrowId, msg.sender, seller, msg.value, refundDeadline, description);
    }

    function getEscrow(uint256 escrowId) external view returns (Escrow memory) {
        if (escrowId >= nextEscrowId) revert InvalidEscrow();
        return escrows[escrowId];
    }

    function markDelivered(uint256 escrowId) external {
        Escrow storage escrow = _escrow(escrowId);
        if (msg.sender != escrow.seller) revert NotSeller();
        if (escrow.status != Status.Funded) revert InvalidStatus();
        escrow.status = Status.Delivered;
        emit DeliveryMarked(escrowId, msg.sender);
    }

    function releasePayment(uint256 escrowId) external {
        Escrow storage escrow = _escrow(escrowId);
        if (msg.sender != escrow.buyer) revert NotBuyer();
        if (escrow.status != Status.Delivered) revert InvalidStatus();
        escrow.status = Status.Released;
        pendingWithdrawals[escrow.seller] += escrow.amount;
        emit PaymentReleased(escrowId, escrow.buyer, escrow.seller, escrow.amount);
    }

    /// @notice Buyer may self-refund only while escrow is funded and its deadline has passed.
    function claimRefund(uint256 escrowId) external {
        Escrow storage escrow = _escrow(escrowId);
        if (msg.sender != escrow.buyer) revert NotBuyer();
        if (escrow.status != Status.Funded) revert InvalidStatus();
        if (block.timestamp < escrow.refundDeadline) revert RefundWindowOpen();
        escrow.status = Status.Refunded;
        pendingWithdrawals[escrow.buyer] += escrow.amount;
        emit RefundIssued(escrowId, escrow.buyer, escrow.amount);
    }

    /// @notice Buyer or seller may pause settlement by raising a dispute before resolution.
    function raiseDispute(uint256 escrowId, string calldata reason) external {
        Escrow storage escrow = _escrow(escrowId);
        if (msg.sender != escrow.buyer && msg.sender != escrow.seller) revert InvalidStatus();
        if (escrow.status != Status.Funded && escrow.status != Status.Delivered) revert InvalidStatus();
        if (bytes(reason).length == 0 || bytes(reason).length > 512) revert EmptyReason();
        escrow.status = Status.Disputed;
        emit DisputeRaised(escrowId, msg.sender, reason);
    }

    /// @notice Arbitrator can only resolve disputed funds to the buyer or seller.
    function resolveDispute(uint256 escrowId, bool refundBuyer) external {
        if (msg.sender != arbitrator) revert NotArbitrator();
        Escrow storage escrow = _escrow(escrowId);
        if (escrow.status != Status.Disputed) revert InvalidStatus();
        escrow.status = refundBuyer ? Status.Refunded : Status.Released;
        address recipient = refundBuyer ? escrow.buyer : escrow.seller;
        pendingWithdrawals[recipient] += escrow.amount;
        emit DisputeResolved(escrowId, msg.sender, recipient, refundBuyer, escrow.amount);
    }

    /// @notice Withdraw an account's credited funds. Any caller may submit, but funds go only to account.
    function withdraw(address payable recipient) external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        if (recipient == address(0)) revert TransferFailed();
        pendingWithdrawals[msg.sender] = 0;
        (bool success,) = recipient.call{value: amount}("");
        if (!success) revert TransferFailed();
        emit Withdrawal(msg.sender, recipient, amount);
    }

    function _escrow(uint256 escrowId) private view returns (Escrow storage escrow) {
        if (escrowId >= nextEscrowId) revert InvalidEscrow();
        return escrows[escrowId];
    }
}
