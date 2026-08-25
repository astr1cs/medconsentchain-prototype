// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// Naive baseline: permission checks scattered inside functions
// No Proxy layer, no single audit point, no access logging
contract NaiveBaseline {

    struct RecordMetadata {
        bytes32 contentHash;
        string ipfsPointer;
        string wrappedKey;
        uint256 createdAt;
        uint256 updatedAt;
    }

    struct Permission {
        address provider;
        uint256 expiresAt;
        bool revoked;
        bool exists;
    }

    address public patient;

    mapping(string => RecordMetadata) private records;
    mapping(string => mapping(address => Permission)) private permissions;

    event RecordAdded(string recordId, bytes32 contentHash, uint256 timestamp);
    event PermissionGranted(string recordId, address provider, uint256 expiresAt, uint256 timestamp);
    event PermissionRevoked(string recordId, address provider, uint256 timestamp);
    // NOTE: No AccessLogged event — this is the gap vs MedConsent

    modifier onlyPatient() {
        require(msg.sender == patient, "Only patient can call this");
        _;
    }

    constructor() {
        patient = msg.sender;
    }

    function addRecord(
        string memory recordId,
        bytes32 contentHash,
        string memory ipfsPointer,
        string memory wrappedKey
    ) external onlyPatient {
        records[recordId] = RecordMetadata({
            contentHash: contentHash,
            ipfsPointer: ipfsPointer,
            wrappedKey: wrappedKey,
            createdAt: block.timestamp,
            updatedAt: block.timestamp
        });
        emit RecordAdded(recordId, contentHash, block.timestamp);
    }

    function grantPermission(
        string memory recordId,
        address provider,
        uint256 durationSeconds
    ) external onlyPatient {
        uint256 expiresAt = block.timestamp + durationSeconds;
        permissions[recordId][provider] = Permission({
            provider: provider,
            expiresAt: expiresAt,
            revoked: false,
            exists: true
        });
        emit PermissionGranted(recordId, provider, expiresAt, block.timestamp);
    }

    function revokePermission(
        string memory recordId,
        address provider
    ) external onlyPatient {
        require(permissions[recordId][provider].exists, "Permission does not exist");
        permissions[recordId][provider].revoked = true;
        permissions[recordId][provider].expiresAt = 0;
        emit PermissionRevoked(recordId, provider, block.timestamp);
    }

    // Naive: permission check embedded directly inside retrieval
    // No logging, no single audit point
    function getRecord(
        string memory recordId,
        address provider
    ) external view returns (bytes32, string memory, uint256) {
        // Check scattered inside function — this is the architectural weakness
        Permission memory p = permissions[recordId][provider];
        require(p.exists && !p.revoked && block.timestamp <= p.expiresAt, "Access denied");
        
        RecordMetadata memory r = records[recordId];
        return (r.contentHash, r.ipfsPointer, r.createdAt);
    }

    // Second retrieval function — developer forgot to add permission check
    // This is the security gap the paper describes
    function getRecordEmergency(
        string memory recordId
    ) external view returns (bytes32, string memory) {
        // No permission check at all — exactly the risk of scattered enforcement
        RecordMetadata memory r = records[recordId];
        return (r.contentHash, r.ipfsPointer);
    }
}