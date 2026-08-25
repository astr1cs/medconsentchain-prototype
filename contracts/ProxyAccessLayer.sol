// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title ProxyAccessLayer
 * @notice On-chain representation of the Proxy pattern (GoF) for
 *         MedConsentChain. This contract acts as the single named
 *         enforcement boundary that every record retrieval must pass
 *         through on-chain.
 *
 * Architecture note:
 *   In the full MedConsentChain system the Proxy runs off-chain
 *   (Node.js middleware), maintains a local permission cache
 *   invalidated by on-chain events, and enforces access decisions
 *   in sub-millisecond. This Solidity contract provides an on-chain
 *   reference implementation of the same logic for transparency and
 *   auditability, and is used by the evaluation trial script to
 *   demonstrate the single-boundary property.
 *
 * Pattern implemented: Proxy (GoF) -- shares the IConsentGateway
 * interface with MedConsent, intercepts every request, delegates
 * to the real subject only after an on-chain permission check.
 */

interface IConsentGateway {
    function checkPermission(string memory recordId, address provider)
        external returns (bool);
    function getRecord(string memory recordId)
        external view returns (bytes32, string memory, uint256);
}

contract ProxyAccessLayer {

    IConsentGateway public immutable consentContract;
    address         public immutable proxyOwner;

    event ProxyAccessAttempt(
        string  recordId,
        address provider,
        bool    granted,
        uint256 timestamp
    );
    event ProxyDenied(
        string  recordId,
        address provider,
        uint256 timestamp
    );

    modifier onlyOwner() {
        require(msg.sender == proxyOwner, "Proxy: not owner");
        _;
    }

    constructor(address _consentContract) {
        consentContract = IConsentGateway(_consentContract);
        proxyOwner      = msg.sender;
    }

    /**
     * @notice Single enforcement point for all record retrievals.
     *         Calls checkPermission on the MedConsent contract (which
     *         emits AccessLogged), then returns the record only if
     *         permission is valid.
     * @return contentHash  SHA-256 of the plaintext record
     * @return ipfsPointer  CID of the encrypted blob on IPFS
     * @return createdAt    Record creation timestamp
     */
    function requestRecord(
        string  memory recordId,
        address        provider
    ) external returns (
        bytes32 contentHash,
        string memory ipfsPointer,
        uint256 createdAt
    ) {
        bool allowed = consentContract.checkPermission(recordId, provider);

        emit ProxyAccessAttempt(recordId, provider, allowed, block.timestamp);

        if (!allowed) {
            emit ProxyDenied(recordId, provider, block.timestamp);
            revert("ProxyAccessLayer: access denied");
        }

        (contentHash, ipfsPointer, createdAt) =
            consentContract.getRecord(recordId);
    }
}
