// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title TipVault
 * @notice Autonomous treasury managed exclusively by the VALOR agent wallet.
 *
 *         The agent holds a WDK self-custodial wallet, scores on-chain
 *         contributions off-chain, then calls executeTip / executeBatchTips
 *         to distribute USD₮ rewards on-chain.
 *
 *         Every tip is anchored by a `reasoningHash` — the keccak256 of the
 *         agent's JSON decision log — so every on-chain action is cryptographically
 *         linked to the agent's off-chain reasoning. Full auditability.
 *
 * Security model:
 *   AGENT_ROLE  → execute tips only. Cannot withdraw, cannot change limits.
 *   ADMIN_ROLE  → update limits, rotate agent, pause, emergency-withdraw.
 *                 In production: assign to a multisig.
 *   Rate limits → maxTipAmount + epochBudget bound worst-case loss even if
 *                 the agent key is compromised.
 */
contract TipVault is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ─── Roles ────────────────────────────────────────────────────────────────
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // ─── Immutable ────────────────────────────────────────────────────────────
    IERC20 public immutable usdtToken;

    // ─── Mutable state ────────────────────────────────────────────────────────
    address public agentWallet;

    uint256 public maxTipAmount;        // max per single tip  (USDT 6-dec units)
    uint256 public epochBudget;         // max per epoch
    uint256 public epochDuration;       // seconds per epoch
    uint256 public minTreasuryReserve;  // vault must keep this amount untipped
    uint256 public recipientCooldown;   // seconds between tips to same address

    uint256 public currentEpochStart;
    uint256 public currentEpochSpend;

    uint256 public totalTipsDistributed;
    uint256 public totalTipCount;

    mapping(address => uint256) public lastTipAt;
    mapping(address => uint256) public totalTipsReceived;
    mapping(uint256 => TipRecord) public tipRecords;

    // ─── Structs ──────────────────────────────────────────────────────────────
    struct TipRecord {
        uint256 tipId;
        address recipient;
        uint256 amount;
        bytes32 reasoningHash;      // keccak256 of agent JSON decision log
        uint256 contributionScore;  // 0–10000 basis points
        uint256 timestamp;
        uint256 epochNumber;
    }

    // ─── Events ───────────────────────────────────────────────────────────────
    event TipExecuted(
        uint256 indexed tipId,
        address indexed recipient,
        uint256 amount,
        bytes32 reasoningHash,
        uint256 contributionScore,
        uint256 timestamp
    );
    event TreasuryDeposited(address indexed depositor, uint256 amount);
    event TreasuryWithdrawn(address indexed to, uint256 amount);
    event EpochRolled(uint256 indexed newEpochStart, uint256 previousSpend, uint256 balance);
    event LimitsUpdated(uint256 maxTip, uint256 budget, uint256 duration, uint256 reserve, uint256 cooldown);
    event AgentRotated(address indexed oldAgent, address indexed newAgent);

    // ─── Errors ───────────────────────────────────────────────────────────────
    error TipAmountZero();
    error TipAmountExceedsMax(uint256 amount, uint256 max);
    error EpochBudgetExceeded(uint256 requested, uint256 remaining);
    error InsufficientTreasuryReserve(uint256 balance, uint256 required);
    error RecipientOnCooldown(address recipient, uint256 cooldownEnds);
    error RecipientIsZeroAddress();
    error InvalidAmount();
    error InvalidDuration();
    error BatchSizeInvalid();
    error ArrayLengthMismatch();

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor(
        address _usdtToken,
        address _agentWallet,
        address _admin,
        uint256 _maxTipAmount,
        uint256 _epochBudget,
        uint256 _epochDuration,
        uint256 _minTreasuryReserve,
        uint256 _recipientCooldown
    ) {
        require(_usdtToken != address(0),      "TipVault: zero USDT");
        require(_agentWallet != address(0),    "TipVault: zero agent");
        require(_admin != address(0),          "TipVault: zero admin");
        require(_maxTipAmount > 0,             "TipVault: maxTip=0");
        require(_epochBudget >= _maxTipAmount, "TipVault: budget<maxTip");
        require(_epochDuration >= 1 hours,     "TipVault: epoch<1h");

        usdtToken          = IERC20(_usdtToken);
        agentWallet        = _agentWallet;
        maxTipAmount       = _maxTipAmount;
        epochBudget        = _epochBudget;
        epochDuration      = _epochDuration;
        minTreasuryReserve = _minTreasuryReserve;
        recipientCooldown  = _recipientCooldown;
        currentEpochStart  = block.timestamp;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
        _grantRole(AGENT_ROLE, _agentWallet);
    }

    // ─── Agent: Single Tip ────────────────────────────────────────────────────

    /**
     * @notice Execute a single tip. Only the VALOR agent may call this.
     * @param recipient         USD₮ destination
     * @param amount            Amount in USDT base units (1 USDT = 1_000_000)
     * @param reasoningHash     keccak256(agentDecisionJSON) — proof of reasoning
     * @param contributionScore 0–10000 score this tip is based on
     */
    function executeTip(
        address recipient,
        uint256 amount,
        bytes32 reasoningHash,
        uint256 contributionScore
    ) external nonReentrant whenNotPaused onlyRole(AGENT_ROLE) {
        if (recipient == address(0)) revert RecipientIsZeroAddress();
        if (amount == 0)             revert TipAmountZero();
        if (amount > maxTipAmount)   revert TipAmountExceedsMax(amount, maxTipAmount);

        _maybeRollEpoch();
        _spendBudget(amount);
        _updateRecipient(recipient, amount);

        uint256 tipId = totalTipCount++;
        tipRecords[tipId] = TipRecord({
            tipId:             tipId,
            recipient:         recipient,
            amount:            amount,
            reasoningHash:     reasoningHash,
            contributionScore: contributionScore,
            timestamp:         block.timestamp,
            epochNumber:       _epochNumber()
        });

        usdtToken.safeTransfer(recipient, amount);
        emit TipExecuted(tipId, recipient, amount, reasoningHash, contributionScore, block.timestamp);
    }

    // ─── Agent: Batch Tips ────────────────────────────────────────────────────

    /**
     * @notice Execute up to 50 tips atomically. More efficient for epoch settlement.
     *         Reverts entirely if any tip fails validation.
     */
    function executeBatchTips(
        address[] calldata recipients,
        uint256[] calldata amounts,
        bytes32[] calldata reasoningHashes,
        uint256[] calldata contributionScores
    ) external nonReentrant whenNotPaused onlyRole(AGENT_ROLE) {
        uint256 len = recipients.length;
        if (len == 0 || len > 50) revert BatchSizeInvalid();
        if (amounts.length != len || reasoningHashes.length != len || contributionScores.length != len)
            revert ArrayLengthMismatch();

        _maybeRollEpoch();

        // Pre-flight validation
        uint256 batchTotal = 0;
        for (uint256 i = 0; i < len; i++) {
            if (amounts[i] == 0)           revert TipAmountZero();
            if (amounts[i] > maxTipAmount) revert TipAmountExceedsMax(amounts[i], maxTipAmount);
            batchTotal += amounts[i];
        }
        if (batchTotal > epochBudget - currentEpochSpend)
            revert EpochBudgetExceeded(batchTotal, epochBudget - currentEpochSpend);

        uint256 vaultBalance = usdtToken.balanceOf(address(this));
        if (vaultBalance < batchTotal + minTreasuryReserve)
            revert InsufficientTreasuryReserve(vaultBalance, batchTotal + minTreasuryReserve);

        uint256 epNum = _epochNumber();

        for (uint256 i = 0; i < len; i++) {
            if (recipients[i] == address(0)) revert RecipientIsZeroAddress();

            uint256 cooldownEnds = lastTipAt[recipients[i]] + recipientCooldown;
            if (block.timestamp < cooldownEnds)
                revert RecipientOnCooldown(recipients[i], cooldownEnds);

            uint256 tipId = totalTipCount++;
            currentEpochSpend           += amounts[i];
            totalTipsDistributed        += amounts[i];
            lastTipAt[recipients[i]]     = block.timestamp;
            totalTipsReceived[recipients[i]] += amounts[i];

            tipRecords[tipId] = TipRecord({
                tipId:             tipId,
                recipient:         recipients[i],
                amount:            amounts[i],
                reasoningHash:     reasoningHashes[i],
                contributionScore: contributionScores[i],
                timestamp:         block.timestamp,
                epochNumber:       epNum
            });

            usdtToken.safeTransfer(recipients[i], amounts[i]);
            emit TipExecuted(tipId, recipients[i], amounts[i], reasoningHashes[i], contributionScores[i], block.timestamp);
        }
    }

    // ─── Treasury ─────────────────────────────────────────────────────────────

    /// @notice Anyone can fund the vault (DAOs, protocols, individuals)
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        usdtToken.safeTransferFrom(msg.sender, address(this), amount);
        emit TreasuryDeposited(msg.sender, amount);
    }

    /// @notice Admin-only emergency drain
    function emergencyWithdraw(address to, uint256 amount)
        external onlyRole(ADMIN_ROLE) nonReentrant
    {
        require(to != address(0), "TipVault: zero to");
        if (amount == 0) revert InvalidAmount();
        usdtToken.safeTransfer(to, amount);
        emit TreasuryWithdrawn(to, amount);
    }

    // ─── Admin Config ─────────────────────────────────────────────────────────

    function updateLimits(
        uint256 _maxTipAmount,
        uint256 _epochBudget,
        uint256 _epochDuration,
        uint256 _minTreasuryReserve,
        uint256 _recipientCooldown
    ) external onlyRole(ADMIN_ROLE) {
        if (_maxTipAmount == 0)           revert InvalidAmount();
        if (_epochBudget < _maxTipAmount) revert InvalidAmount();
        if (_epochDuration < 1 hours)     revert InvalidDuration();

        maxTipAmount       = _maxTipAmount;
        epochBudget        = _epochBudget;
        epochDuration      = _epochDuration;
        minTreasuryReserve = _minTreasuryReserve;
        recipientCooldown  = _recipientCooldown;

        emit LimitsUpdated(_maxTipAmount, _epochBudget, _epochDuration, _minTreasuryReserve, _recipientCooldown);
    }

    function rotateAgent(address oldAgent, address newAgent) external onlyRole(ADMIN_ROLE) {
        require(oldAgent != address(0) && newAgent != address(0), "TipVault: zero address");
        require(hasRole(AGENT_ROLE, oldAgent), "TipVault: oldAgent not agent");

        _revokeRole(AGENT_ROLE, oldAgent);
        _grantRole(AGENT_ROLE, newAgent);
        agentWallet = newAgent;

        emit AgentRotated(oldAgent, newAgent);
    }

    function pause()   external onlyRole(ADMIN_ROLE) { _pause();   }
    function unpause() external onlyRole(ADMIN_ROLE) { _unpause(); }

    // ─── View ─────────────────────────────────────────────────────────────────

    function treasuryBalance() external view returns (uint256) {
        return usdtToken.balanceOf(address(this));
    }

    function epochBudgetRemaining() external view returns (uint256) {
        if (block.timestamp >= currentEpochStart + epochDuration) return epochBudget;
        return epochBudget - currentEpochSpend;
    }

    function epochTimeRemaining() external view returns (uint256) {
        uint256 end = currentEpochStart + epochDuration;
        if (block.timestamp >= end) return 0;
        return end - block.timestamp;
    }

    function canTip(address recipient, uint256 amount)
        external view returns (bool ok, string memory reason)
    {
        if (paused())              return (false, "paused");
        if (amount == 0)           return (false, "zero amount");
        if (amount > maxTipAmount) return (false, "exceeds max tip");

        uint256 bal = usdtToken.balanceOf(address(this));
        if (bal < amount + minTreasuryReserve) return (false, "insufficient reserve");

        uint256 available = (block.timestamp >= currentEpochStart + epochDuration)
            ? epochBudget
            : epochBudget - currentEpochSpend;
        if (amount > available) return (false, "epoch budget exceeded");

        if (block.timestamp < lastTipAt[recipient] + recipientCooldown)
            return (false, "recipient on cooldown");

        return (true, "ok");
    }

    /// @notice Full vault snapshot for agent decision loop
    function getVaultState() external view returns (
        uint256 balance,
        uint256 budgetRemaining,
        uint256 epochSecondsRemaining,
        uint256 totalDistributed,
        uint256 tipCount,
        bool    isPaused
    ) {
        balance               = usdtToken.balanceOf(address(this));
        budgetRemaining       = this.epochBudgetRemaining();
        epochSecondsRemaining = this.epochTimeRemaining();
        totalDistributed      = totalTipsDistributed;
        tipCount              = totalTipCount;
        isPaused              = paused();
    }

    /// @notice Paginated tip history
    function getTipRecords(uint256 offset, uint256 limit)
        external view returns (TipRecord[] memory records)
    {
        uint256 total = totalTipCount;
        if (offset >= total || limit == 0) return new TipRecord[](0);
        uint256 end = offset + limit > total ? total : offset + limit;
        records = new TipRecord[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            records[i - offset] = tipRecords[i];
        }
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _maybeRollEpoch() internal {
        if (block.timestamp >= currentEpochStart + epochDuration) {
            uint256 prev = currentEpochSpend;
            currentEpochStart = block.timestamp;
            currentEpochSpend = 0;
            emit EpochRolled(currentEpochStart, prev, usdtToken.balanceOf(address(this)));
        }
    }

    function _spendBudget(uint256 amount) internal {
        uint256 remaining = epochBudget - currentEpochSpend;
        if (amount > remaining) revert EpochBudgetExceeded(amount, remaining);

        uint256 bal = usdtToken.balanceOf(address(this));
        if (bal < amount + minTreasuryReserve)
            revert InsufficientTreasuryReserve(bal, amount + minTreasuryReserve);

        currentEpochSpend    += amount;
        totalTipsDistributed += amount;
    }

    function _updateRecipient(address recipient, uint256 amount) internal {
        uint256 cd = lastTipAt[recipient] + recipientCooldown;
        if (block.timestamp < cd) revert RecipientOnCooldown(recipient, cd);

        lastTipAt[recipient]           = block.timestamp;
        totalTipsReceived[recipient]  += amount;
    }

    function _epochNumber() internal view returns (uint256) {
        if (epochDuration == 0) return 0;
        return (block.timestamp - currentEpochStart) / epochDuration;
    }
}