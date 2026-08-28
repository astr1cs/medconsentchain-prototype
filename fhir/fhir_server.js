/**
 * MedConsentChain — Mock FHIR R4 Hospital Adapter
 *
 * Implements one FHIR R4 endpoint:
 *   GET /fhir/Patient/:patientId/DocumentReference/:recordId
 *
 * Flow:
 *   1. Hospital calls the endpoint with provider wallet in X-Provider header
 *   2. Proxy cache checks local permission state
 *   3. If granted  → 200 OK  + mock EHR document
 *   4. If denied   → 403 Forbidden
 *   5. Every outcome logged asynchronously on-chain via checkPermission()
 *
 * Run:
 *   npm install express
 *   node fhir/fhir_server.js
 *
 * Then run the test script:
 *   node fhir/fhir_test.js
 */

'use strict';

require('dotenv').config();
const express  = require('express');
const { ethers } = require('ethers');

// ─── Config ──────────────────────────────────────────────────────────────────

const PORT             = 3847;
const CONTRACT_ADDRESS = '0xCa90Ec6366181f791f95873E849FB4561bee6fB4';
const INFURA_URL       = process.env.INFURA_URL;
const PRIVATE_KEY      = process.env.PRIVATE_KEY;

// Must match runTrialsDirect.js — string recordId, durationSeconds
const CONTRACT_ABI = [
  'function addRecord(string recordId, bytes32 contentHash, string ipfsPointer, string wrappedKey) external',
  'function grantPermission(string recordId, address provider, uint256 durationSeconds) external',
  'function revokePermission(string recordId, address provider) external',
  'function checkPermission(string recordId, address provider) external returns (bool)',
  'function getRecord(string recordId) external view returns (bytes32, string, uint256)',
  'event PermissionGranted(string recordId, address provider, uint256 expiresAt, uint256 timestamp)',
  'event PermissionRevoked(string recordId, address provider, uint256 timestamp)',
  'event AccessLogged(string recordId, address provider, bool allowed, uint256 timestamp)',
];

// ─── Proxy Cache (CGP pattern — mirrors contract state) ───────────────────────

class ConsentGatedProxy {
  constructor(contract, provider) {
    this.contract = contract;
    this.provider = provider;
    // cache: Map<"recordId:provider" → { granted: bool, expiresAt: number }>
    this.cache = new Map();
    this._subscribeToEvents();
  }

  _cacheKey(recordId, provider) {
    return `${recordId}:${provider.toLowerCase()}`;
  }

  // Called when PermissionGranted event arrives from Ethereum
  _onGranted(recordId, provider, expiresAt) {
    const key = this._cacheKey(recordId, provider);
    this.cache.set(key, {
      granted:   true,
      expiresAt: Number(expiresAt),
    });
    console.log(`[CGP] Cache GRANT  ${key} expires=${new Date(Number(expiresAt) * 1000).toISOString()}`);
  }

  // Called when PermissionRevoked event arrives from Ethereum
  _onRevoked(recordId, provider) {
    const key = this._cacheKey(recordId, provider);
    this.cache.set(key, { granted: false, expiresAt: 0 });
    console.log(`[CGP] Cache REVOKE ${key}`);
  }

  // Subscribe to on-chain events for cache invalidation
  _subscribeToEvents() {
    this.contract.on('PermissionGranted', (recordId, provider, expiresAt) => {
      this._onGranted(recordId, provider, expiresAt);
    });
    this.contract.on('PermissionRevoked', (recordId, provider) => {
      this._onRevoked(recordId, provider);
    });
    console.log('[CGP] Subscribed to on-chain consent events');
  }

  // Seed cache from a known grant (for test setup)
  seedGrant(recordId, provider, expiresAt) {
    this._onGranted(recordId, provider, expiresAt);
  }

  // Seed cache from a known revocation
  seedRevoke(recordId, provider) {
    this._onRevoked(recordId, provider);
  }

  // Sub-millisecond enforcement decision from cache
  checkCache(recordId, provider) {
    const key   = this._cacheKey(recordId, provider);
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (!entry.granted) return false;
    if (entry.expiresAt > 0 && Math.floor(Date.now() / 1000) > entry.expiresAt) return false;
    return true;
  }

  // Async on-chain audit log — fires and forgets (non-blocking)
  async logAccessOnChain(recordId, provider) {
    try {
      const tx = await this.contract.checkPermission(recordId, provider);
      console.log(`[CGP] AccessLogged tx=${tx.hash}`);
    } catch (e) {
      console.warn(`[CGP] AccessLogged failed (non-fatal): ${e.message}`);
    }
  }
}

// ─── Mock EHR Document (FHIR R4 DocumentReference) ───────────────────────────

function mockFhirDocument(patientId, recordId) {
  return {
    resourceType: 'DocumentReference',
    id:           recordId,
    status:       'current',
    type: {
      coding: [{
        system:  'http://loinc.org',
        code:    '34133-9',
        display: 'Summary of episode note',
      }],
    },
    subject: {
      reference: `Patient/${patientId}`,
    },
    content: [{
      attachment: {
        contentType: 'application/pdf',
        url:         `ipfs://QmMockHash${recordId}`,
        title:       `EHR Record ${recordId}`,
      },
    }],
    meta: {
      tag: [{
        system:  'https://medconsentchain.io',
        code:    'consent-gated',
        display: 'Access controlled by MedConsentChain CGP',
      }],
    },
  };
}

// ─── Server Setup ─────────────────────────────────────────────────────────────

async function startServer() {
  if (!INFURA_URL || !PRIVATE_KEY) {
    console.error('Missing INFURA_URL or PRIVATE_KEY in .env');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(INFURA_URL);
  const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, wallet);
  const cgp      = new ConsentGatedProxy(contract, provider);

  console.log(`[Server] Patient wallet : ${wallet.address}`);
  console.log(`[Server] Contract       : ${CONTRACT_ADDRESS}`);
  console.log(`[Server] CGP cache ready`);

  const app = express();
  app.use(express.json());

  // ── Health check ────────────────────────────────────────────────────────────
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', contract: CONTRACT_ADDRESS, cacheSize: cgp.cache.size });
  });

  // ── Seed endpoint (test setup only — not part of FHIR spec) ─────────────────
  // POST /test/seed  { recordId, provider, granted: bool, expiresAt: unix }
  app.post('/test/seed', (req, res) => {
    const { recordId, provider, granted, expiresAt } = req.body;
    if (!recordId || !provider) {
      return res.status(400).json({ error: 'recordId and provider required' });
    }
    if (granted) {
      cgp.seedGrant(recordId, provider, expiresAt || Math.floor(Date.now() / 1000) + 86400);
    } else {
      cgp.seedRevoke(recordId, provider);
    }
    res.json({ seeded: true, recordId, provider, granted });
  });

  // ── FHIR R4 DocumentReference endpoint ─────────────────────────────────────
  // GET /fhir/Patient/:patientId/DocumentReference/:recordId
  // Header: X-Provider: <provider_wallet_address>
  app.get('/fhir/Patient/:patientId/DocumentReference/:recordId', async (req, res) => {
    const { patientId, recordId } = req.params;
    const provider = req.headers['x-provider'];
    const t0 = Date.now();

    if (!provider) {
      return res.status(400).json({
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'error', code: 'required', diagnostics: 'X-Provider header required' }],
      });
    }

    // Sub-millisecond cache check (CGP enforcement)
    const cacheStart  = performance.now();
    const allowed     = cgp.checkCache(recordId, provider);
    const cacheTimeMs = performance.now() - cacheStart;

    console.log(`[FHIR] ${allowed ? 'GRANT' : 'DENY '} patient=${patientId} record=${recordId} provider=${provider.slice(0,10)}... cache=${cacheTimeMs.toFixed(4)}ms`);

    // Async on-chain audit log — non-blocking
    cgp.logAccessOnChain(recordId, provider);

    if (!allowed) {
      return res.status(403).json({
        resourceType: 'OperationOutcome',
        issue: [{
          severity:    'error',
          code:        'forbidden',
          diagnostics: 'Access denied by MedConsentChain CGP. Permission not granted or revoked.',
        }],
        _cgp: { cacheDecisionMs: cacheTimeMs, allowed: false },
      });
    }

    const totalMs = Date.now() - t0;
    return res.status(200).json({
      ...mockFhirDocument(patientId, recordId),
      _cgp: { cacheDecisionMs: cacheTimeMs, totalMs, allowed: true },
    });
  });

  app.listen(PORT, () => {
    console.log(`\n[Server] Mock FHIR R4 server running on http://localhost:${PORT}`);
    console.log(`[Server] Endpoint: GET /fhir/Patient/:patientId/DocumentReference/:recordId`);
    console.log(`[Server] Header:   X-Provider: <wallet_address>`);
    console.log(`[Server] Seed:     POST /test/seed`);
    console.log(`\n[Server] Ready. Run: node fhir/fhir_test.js\n`);
  });

  return { app, cgp, wallet };
}

startServer().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});