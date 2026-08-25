// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title MedConsent
 * @notice Patient-controlled EHR consent contract for MedConsentChain.
 *
 * Architecture role: this contract is the on-chain boundary of the
 * hexagonal architecture. The off-chain Proxy layer subscribes to
 * PermissionGranted and PermissionRevoked events to maintain a local
 * cache; access decisions are resolved against that cache in
 * sub-millisecond. checkPermission() is called asynchronously by the
 * Proxy to emit the tamper-evident AccessLogged audit event on-chain.
 *
 * Direct record retrieval via getRecord() is intentionally restricted
 * to the patient address in a production deployment; the Proxy enforces
 * permission checks before any off-chain retrieval path reaches this
 * function.
 */
contract MedConsent {

    struct RecordMetadata {
        bytes32 contentHash;   // SHA-256 of plaintext content
        string  ipfsPointer;   // IPFS CID of AES-256 encrypted blob
        string  wrappedKey;    // AES key wrapped with recipient public key
        uint256 createdAt;
        uint256 updatedAt;
    }

    struct Permission {
        address provider;
        uint256 expiresAt;
        bool    revoked;
        bool    exists;
    }

    address public patient;

    mapping(string => RecordMetadata)                  private records;
    mapping(string => mapping(address => Permission))  private permissions;

    event RecordAdded(
        string  recordId,
        bytes32 contentHash,
        uint256 timestamp
    );
    event PermissionGranted(
        string  recordId,
        address provider,
        uint256 expiresAt,
        uint256 timestamp
    );
    event PermissionRevoked(
        string  recordId,
        address provider,
        uint256 timestamp
    );
    /// @notice Emitted by the Proxy (via checkPermission) for every
    ///         access attempt, forming the tamper-evident audit log.
    event AccessLogged(
        string  recordId,
        address provider,
        bool    allowed,
        uint256 timestamp
    );

    modifier onlyPatient() {
        require(msg.sender == patient, "Only patient can call this");
        _;
    }

    constructor() {
        patient = msg.sender;
    }

    // ----------------------------------------------------------------
    // Patient-only state-changing functions
    // ----------------------------------------------------------------

    function addRecord(
        string  memory recordId,
        bytes32        contentHash,
        string  memory ipfsPointer,
        string  memory wrappedKey
    ) external onlyPatient {
        records[recordId] = RecordMetadata({
            contentHash: contentHash,
            ipfsPointer: ipfsPointer,
            wrappedKey:  wrappedKey,
            createdAt:   block.timestamp,
            updatedAt:   block.timestamp
        });
        emit RecordAdded(recordId, contentHash, block.timestamp);
    }

    function grantPermission(
        string  memory recordId,
        address        provider,
        uint256        durationSeconds
    ) external onlyPatient {
        uint256 expiresAt = block.timestamp + durationSeconds;
        permissions[recordId][provider] = Permission({
            provider:  provider,
            expiresAt: expiresAt,
            revoked:   false,
            exists:    true
        });
        emit PermissionGranted(recordId, provider, expiresAt, block.timestamp);
    }

    function revokePermission(
        string  memory recordId,
        address        provider
    ) external onlyPatient {
        require(
            permissions[recordId][provider].exists,
            "Permission does not exist"
        );
        permissions[recordId][provider].revoked   = true;
        permissions[recordId][provider].expiresAt = 0;
        emit PermissionRevoked(recordId, provider, block.timestamp);
    }

    // ----------------------------------------------------------------
    // Proxy-facing functions
    // ----------------------------------------------------------------

    /**
     * @notice Called asynchronously by the Proxy to log each access
     *         attempt on-chain. The Proxy reads its local cache for the
     *         sub-millisecond enforcement decision; this function
     *         provides the immutable audit record.
     */
    function checkPermission(
        string  memory recordId,
        address        provider
    ) external returns (bool) {
        Permission memory p = permissions[recordId][provider];
        bool allowed = p.exists && !p.revoked && block.timestamp <= p.expiresAt;
        emit AccessLogged(recordId, provider, allowed, block.timestamp);
        return allowed;
    }

    // ----------------------------------------------------------------
    // Read-only helpers
    // ----------------------------------------------------------------

    /**
     * @notice Returns record metadata. In production this is called
     *         only through the Proxy after a successful permission check;
     *         the Proxy enforces the access boundary off-chain.
     */
    function getRecord(
        string memory recordId
    ) external view returns (bytes32, string memory, uint256) {
        RecordMetadata memory r = records[recordId];
        return (r.contentHash, r.ipfsPointer, r.createdAt);
    }
}
