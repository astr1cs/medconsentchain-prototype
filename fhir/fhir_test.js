/**
 * MedConsentChain — FHIR Adapter Test Script
 *
 * Runs 10 test cases against the mock FHIR server:
 *   Cases 1-5:  Granted providers  → expect 200 OK
 *   Cases 6-10: Revoked providers  → expect 403 Forbidden
 *
 * Prerequisites:
 *   1. fhir_server.js must be running: node fhir/fhir_server.js
 *   2. npm install node-fetch (or Node 18+ has fetch built-in)
 *
 * Run:
 *   node fhir/fhir_test.js
 *
 * Output: prints results table + paste block for paper
 */

'use strict';

require('dotenv').config();
const { ethers } = require('ethers');

const BASE_URL         = 'http://localhost:3847';
const CONTRACT_ADDRESS = '0xCa90Ec6366181f791f95873E849FB4561bee6fB4';
const INFURA_URL       = process.env.INFURA_URL;
const PRIVATE_KEY      = process.env.PRIVATE_KEY;

const CONTRACT_ABI = [
  'function addRecord(string recordId, bytes32 contentHash, string ipfsPointer, string wrappedKey) external',
  'function grantPermission(string recordId, address provider, uint256 durationSeconds) external',
  'function revokePermission(string recordId, address provider) external',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function seedCache(recordId, provider, granted, expiresAt) {
  const res = await fetch(`${BASE_URL}/test/seed`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ recordId, provider, granted, expiresAt }),
  });
  return res.json();
}

async function requestFHIR(patientId, recordId, providerAddress) {
  const t0  = performance.now();
  const res = await fetch(
    `${BASE_URL}/fhir/Patient/${patientId}/DocumentReference/${recordId}`,
    { headers: { 'X-Provider': providerAddress } }
  );
  const ms   = performance.now() - t0;
  const body = await res.json();
  return { status: res.status, ms, body };
}

function pad(str, n) { return String(str).padEnd(n); }

// ─── Test Cases ───────────────────────────────────────────────────────────────

async function main() {
  console.log('═'.repeat(70));
  console.log('  MedConsentChain — FHIR Adapter Evaluation (10 Test Cases)');
  console.log('═'.repeat(70));

  // Check server is up
  try {
    const health = await fetch(`${BASE_URL}/health`);
    const hj     = await health.json();
    console.log(`\n  Server: ${hj.status} | Contract: ${hj.contract}`);
  } catch (e) {
    console.error('\n  ✗ Server not running. Start it first: node fhir/fhir_server.js');
    process.exit(1);
  }

  // Generate 10 provider wallets
  const providers = Array.from({ length: 10 }, () => ethers.Wallet.createRandom());
  const PATIENT_ID = 'patient_001';
  const expiresAt  = Math.floor(Date.now() / 1000) + 86400; // 24h

  console.log('\n  Setting up test permissions in CGP cache...');

  // Cases 1-5: Grant permission
  for (let i = 0; i < 5; i++) {
    const recordId = `fhir_record_${i + 1}`;
    await seedCache(recordId, providers[i].address, true, expiresAt);
    console.log(`  ✓ Granted  case ${i + 1}: record=${recordId} provider=${providers[i].address.slice(0, 10)}...`);
  }

  // Cases 6-10: Revoked permission
  for (let i = 5; i < 10; i++) {
    const recordId = `fhir_record_${i + 1}`;
    await seedCache(recordId, providers[i].address, false, 0);
    console.log(`  ✓ Revoked  case ${i + 1}: record=${recordId} provider=${providers[i].address.slice(0, 10)}...`);
  }

  // ── Run all 10 test cases ──────────────────────────────────────────────────
  console.log('\n  Running test cases...\n');

  const results = [];

  for (let i = 0; i < 10; i++) {
    const recordId  = `fhir_record_${i + 1}`;
    const caseLabel = `TC-${String(i + 1).padStart(2, '0')}`;
    const expected  = i < 5 ? 200 : 403;
    const expectedLabel = i < 5 ? 'Granted' : 'Revoked';

    const { status, ms, body } = await requestFHIR(
      PATIENT_ID, recordId, providers[i].address
    );

    const pass       = status === expected;
    const cacheMs    = body._cgp?.cacheDecisionMs?.toFixed(4) || 'N/A';
    const statusLabel = status === 200 ? '200 OK ' : '403 Denied';

    results.push({ caseLabel, recordId, expectedLabel, status, statusLabel, pass, ms, cacheMs });

    console.log(
      `  ${pass ? '✓' : '✗'} ${caseLabel} | ${pad(expectedLabel, 8)} | ` +
      `HTTP ${statusLabel} | cache=${cacheMs}ms | total=${ms.toFixed(1)}ms | ${pass ? 'PASS' : 'FAIL'}`
    );
  }

  // ── Results Table ──────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(70));
  console.log('  RESULTS TABLE');
  console.log('═'.repeat(70));
  console.log(
    pad('Case', 8),
    pad('Permission', 11),
    pad('Expected', 10),
    pad('Actual', 12),
    pad('Cache (ms)', 12),
    pad('Result', 6)
  );
  console.log('─'.repeat(70));

  let passed = 0;
  for (const r of results) {
    if (r.pass) passed++;
    console.log(
      pad(r.caseLabel, 8),
      pad(r.expectedLabel, 11),
      pad(r.status === 200 ? '200 OK' : '403 Denied', 10),
      pad(r.statusLabel, 12),
      pad(r.cacheMs, 12),
      r.pass ? 'PASS' : 'FAIL'
    );
  }

  console.log('─'.repeat(70));
  console.log(`  Total: ${passed}/10 passed | ${passed === 10 ? 'ALL PASS ✓' : 'SOME FAILED ✗'}`);

  // ── Summary for paper ──────────────────────────────────────────────────────
  const cacheTimes = results.map(r => parseFloat(r.cacheMs)).filter(v => !isNaN(v));
  const meanCache  = cacheTimes.reduce((a, b) => a + b, 0) / cacheTimes.length;
  const maxCache   = Math.max(...cacheTimes);

  console.log('\n' + '═'.repeat(70));
  console.log('  ── PASTE THIS INTO CLAUDE (FHIR Test Summary) ──');
  console.log('  ' + '─'.repeat(50));
  console.log(`  Passed: ${passed}/10`);
  console.log(`  Cases 1-5 (Granted): all 200 OK = ${results.slice(0,5).every(r=>r.pass) ? 'YES ✓' : 'NO ✗'}`);
  console.log(`  Cases 6-10 (Revoked): all 403 Forbidden = ${results.slice(5).every(r=>r.pass) ? 'YES ✓' : 'NO ✗'}`);
  console.log(`  Mean cache decision: ${meanCache.toFixed(4)}ms`);
  console.log(`  Max cache decision:  ${maxCache.toFixed(4)}ms`);
  console.log(`  All sub-millisecond: ${maxCache < 1.0 ? 'YES ✓' : 'NO ✗'}`);
  for (const r of results) {
    console.log(`  ${r.caseLabel}: perm=${r.expectedLabel} http=${r.status} cache=${r.cacheMs}ms ${r.pass?'PASS':'FAIL'}`);
  }
  console.log('  ' + '─'.repeat(50));
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});