// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title ContributionRegistry
 * @notice On-chain registry where protocols, DAOs, or users can register
 *         contribution signals that the VALOR agent reads during its scoring loop.
 *
 *         Any registered signal source (SIGNAL_SOURCE_ROLE) can record that
 *         an address did something worth rewarding. The agent queries these
 *         signals off-chain, scores them, and then tips via TipVault.
 *
 *         This contract is intentionally simple — it is a data layer, not
 *         an execution layer. Execution happens in TipVault.
 *
 * Signal sources can be:
 *   - A DAO governance contract emitting proposal votes
 *   - A protocol emitting liquidity provision events
 *   - An off-chain oracle posting batched contribution proofs
 *   - The VALOR agent itself recording custom signals
 */
contract ContributionRegistry is AccessControl {

    // ─── Roles ────────────────────────────────────────────────────────────────
    bytes32 public constant SIGNAL_SOURCE_ROLE = keccak256("SIGNAL_SOURCE_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // ─── Enums ────────────────────────────────────────────────────────────────
    enum SignalType {
        ONCHAIN_TRANSACTION,     // Wallet made a relevant on-chain tx
        GOVERNANCE_VOTE,         // Participated in governance
        LIQUIDITY_PROVISION,     // Provided liquidity to a protocol
        CONTRACT_DEPLOYMENT,     // Deployed a contract
        PROTOCOL_INTERACTION,    // Interacted with a registered protocol
        CUSTOM                   // Source-defined custom signal
    }

    // ─── Structs ──────────────────────────────────────────────────────────────
    struct ContributionSignal {
        uint256 signalId;
        address contributor;
        SignalType signalType;
        uint256 weight;         // 0–10000 basis points (raw weight before agent scoring)
        bytes32 dataHash;       // keccak256 of off-chain evidence (tx hash, IPFS CID, etc.)
        address source;         // Who registered this signal
        uint256 timestamp;
        bool processed;         // True after the agent has acted on this signal
    }

    // ─── State ────────────────────────────────────────────────────────────────
    uint256 public signalCount;

    mapping(uint256 => ContributionSignal) public signals;

    /// @notice All signal IDs per contributor (for fast lookup)
    mapping(address => uint256[]) public contributorSignals;

    /// @notice Unprocessed signal IDs queue (agent drains this)
    uint256[] public pendingSignalIds;

    /// @notice Index of next pending signal to process
    uint256 public pendingHead;

    // ─── Events ───────────────────────────────────────────────────────────────
    event SignalRegistered(
        uint256 indexed signalId,
        address indexed contributor,
        SignalType signalType,
        uint256 weight,
        bytes32 dataHash,
        address indexed source
    );

    event SignalProcessed(uint256 indexed signalId, address indexed processedBy);
    event SignalSourceAdded(address indexed source);
    event SignalSourceRemoved(address indexed source);

    // ─── Errors ───────────────────────────────────────────────────────────────
    error InvalidContributor();
    error InvalidWeight();
    error SignalNotFound();
    error AlreadyProcessed();

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor(address _admin) {
        require(_admin != address(0), "ContributionRegistry: zero admin");
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
    }

    // ─── Signal Registration ──────────────────────────────────────────────────

    /**
     * @notice Register a contribution signal. Only registered signal sources may call this.
     * @param contributor   Address that made the contribution
     * @param signalType    Category of contribution
     * @param weight        Raw weight 0–10000 (agent applies additional scoring on top)
     * @param dataHash      keccak256 of off-chain evidence for this signal
     */
    function registerSignal(
        address contributor,
        SignalType signalType,
        uint256 weight,
        bytes32 dataHash
    ) external onlyRole(SIGNAL_SOURCE_ROLE) returns (uint256 signalId) {
        if (contributor == address(0)) revert InvalidContributor();
        if (weight > 10000)            revert InvalidWeight();

        signalId = signalCount++;

        signals[signalId] = ContributionSignal({
            signalId:    signalId,
            contributor: contributor,
            signalType:  signalType,
            weight:      weight,
            dataHash:    dataHash,
            source:      msg.sender,
            timestamp:   block.timestamp,
            processed:   false
        });

        contributorSignals[contributor].push(signalId);
        pendingSignalIds.push(signalId);

        emit SignalRegistered(signalId, contributor, signalType, weight, dataHash, msg.sender);
    }

    /**
     * @notice Batch register multiple signals in one tx (gas efficient for oracles)
     */
    function registerSignalBatch(
        address[] calldata contributors,
        SignalType[] calldata signalTypes,
        uint256[] calldata weights,
        bytes32[] calldata dataHashes
    ) external onlyRole(SIGNAL_SOURCE_ROLE) {
        uint256 len = contributors.length;
        require(
            len == signalTypes.length &&
            len == weights.length &&
            len == dataHashes.length,
            "ContributionRegistry: length mismatch"
        );
        require(len > 0 && len <= 100, "ContributionRegistry: batch 1-100");

        for (uint256 i = 0; i < len; i++) {
            if (contributors[i] == address(0)) revert InvalidContributor();
            if (weights[i] > 10000)            revert InvalidWeight();

            uint256 signalId = signalCount++;

            signals[signalId] = ContributionSignal({
                signalId:    signalId,
                contributor: contributors[i],
                signalType:  signalTypes[i],
                weight:      weights[i],
                dataHash:    dataHashes[i],
                source:      msg.sender,
                timestamp:   block.timestamp,
                processed:   false
            });

            contributorSignals[contributors[i]].push(signalId);
            pendingSignalIds.push(signalId);

            emit SignalRegistered(signalId, contributors[i], signalTypes[i], weights[i], dataHashes[i], msg.sender);
        }
    }

    // ─── Agent: Mark Processed ────────────────────────────────────────────────

    /**
     * @notice Mark signals as processed after the agent has tipped or decided not to.
     *         Only SIGNAL_SOURCE_ROLE (which includes the agent) can call this.
     */
    function markProcessed(uint256[] calldata signalIds) external onlyRole(SIGNAL_SOURCE_ROLE) {
        for (uint256 i = 0; i < signalIds.length; i++) {
            uint256 sid = signalIds[i];
            if (sid >= signalCount) revert SignalNotFound();
            if (signals[sid].processed) revert AlreadyProcessed();

            signals[sid].processed = true;
            emit SignalProcessed(sid, msg.sender);
        }
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function addSignalSource(address source) external onlyRole(ADMIN_ROLE) {
        _grantRole(SIGNAL_SOURCE_ROLE, source);
        emit SignalSourceAdded(source);
    }

    function removeSignalSource(address source) external onlyRole(ADMIN_ROLE) {
        _revokeRole(SIGNAL_SOURCE_ROLE, source);
        emit SignalSourceRemoved(source);
    }

    // ─── View ─────────────────────────────────────────────────────────────────

    /// @notice Get all signals for a contributor
    function getContributorSignals(address contributor)
        external view returns (uint256[] memory)
    {
        return contributorSignals[contributor];
    }

    /// @notice Get a batch of pending (unprocessed) signals for the agent to consume
    function getPendingSignals(uint256 maxCount)
        external view returns (ContributionSignal[] memory pending)
    {
        uint256 total = pendingSignalIds.length;
        uint256 start = pendingHead;
        if (start >= total) return new ContributionSignal[](0);

        // Count actually unprocessed
        uint256 count = 0;
        for (uint256 i = start; i < total && count < maxCount; i++) {
            if (!signals[pendingSignalIds[i]].processed) count++;
        }

        pending = new ContributionSignal[](count);
        uint256 j = 0;
        for (uint256 i = start; i < total && j < count; i++) {
            uint256 sid = pendingSignalIds[i];
            if (!signals[sid].processed) {
                pending[j++] = signals[sid];
            }
        }
    }

    /// @notice Paginated signal lookup
    function getSignals(uint256 offset, uint256 limit)
        external view returns (ContributionSignal[] memory result)
    {
        uint256 total = signalCount;
        if (offset >= total || limit == 0) return new ContributionSignal[](0);
        uint256 end = offset + limit > total ? total : offset + limit;
        result = new ContributionSignal[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = signals[i];
        }
    }
}
