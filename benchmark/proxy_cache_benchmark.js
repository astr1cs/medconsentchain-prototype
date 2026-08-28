/**
 * MedConsentChain — Proxy Cache Latency Benchmark
 *
 * Measures how fast the Proxy cache resolves an access decision
 * (grant or deny) in memory, without hitting Ethereum.
 *
 * Run: node proxy_cache_benchmark.js
 * Requires: Node.js 16+, no npm install needed (no dependencies)
 */

'use strict';

const ITERATIONS = 1000;

// ─── Simulated Proxy Cache ────────────────────────────────────────────────────
// This mirrors exactly what your real Proxy does:
// a Map keyed by "recordId:provider" storing { granted, revokedAt }
// It is populated/invalidated by on-chain PermissionGranted/Revoked events.

class ProxyCache {
  constructor() {
    this.cache = new Map();
  }

  // Called when PermissionGranted event arrives from Ethereum
  grant(recordId, provider) {
    this.cache.set(`${recordId}:${provider}`, {
      granted: true,
      revokedAt: null,
    });
  }

  // Called when PermissionRevoked event arrives from Ethereum
  revoke(recordId, provider) {
    this.cache.set(`${recordId}:${provider}`, {
      granted: false,
      revokedAt: Date.now(),
    });
  }

  // The enforcement check — this is what we are benchmarking
  checkPermission(recordId, provider) {
    const entry = this.cache.get(`${recordId}:${provider}`);
    if (!entry) return false;
    return entry.granted;
  }
}

// ─── Benchmark Helpers ────────────────────────────────────────────────────────

function percentile(sortedArr, p) {
  const idx = Math.ceil((p / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, idx)];
}

function runBenchmark(label, fn, iterations) {
  const timings = [];

  // Warm-up: 100 iterations not counted
  for (let i = 0; i < 100; i++) fn();

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    const end = performance.now();
    timings.push(end - start);
  }

  timings.sort((a, b) => a - b);

  const mean = timings.reduce((s, v) => s + v, 0) / timings.length;
  const p50  = percentile(timings, 50);
  const p99  = percentile(timings, 99);
  const min  = timings[0];
  const max  = timings[timings.length - 1];

  console.log(`\n[${label}]`);
  console.log(`  Iterations : ${iterations}`);
  console.log(`  Mean       : ${mean.toFixed(6)} ms`);
  console.log(`  p50        : ${p50.toFixed(6)} ms`);
  console.log(`  p99        : ${p99.toFixed(6)} ms`);
  console.log(`  Min        : ${min.toFixed(6)} ms`);
  console.log(`  Max        : ${max.toFixed(6)} ms`);
  console.log(`  Sub-ms?    : ${p99 < 1.0 ? 'YES ✓' : 'NO ✗'}`);

  return { mean, p50, p99, min, max };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log('='.repeat(55));
console.log('  MedConsentChain — Proxy Cache Latency Benchmark');
console.log('='.repeat(55));
console.log(`  Node.js : ${process.version}`);
console.log(`  Runs    : ${ITERATIONS} per scenario (+ 100 warm-up)`);

const cache = new ProxyCache();

// Seed cache with test data
const RECORD_ID  = 'record_001';
const PROVIDER_A = '0xProviderGranted';
const PROVIDER_B = '0xProviderRevoked';

cache.grant(RECORD_ID, PROVIDER_A);   // granted provider
cache.revoke(RECORD_ID, PROVIDER_B);  // revoked provider

// Scenario 1: Cache HIT — permission granted, should return true
const hitResults = runBenchmark(
  'Cache HIT (permission granted)',
  () => cache.checkPermission(RECORD_ID, PROVIDER_A),
  ITERATIONS
);

// Scenario 2: Cache DENIAL — permission revoked, should return false
const denyResults = runBenchmark(
  'Cache DENIAL (permission revoked)',
  () => cache.checkPermission(RECORD_ID, PROVIDER_B),
  ITERATIONS
);

// Scenario 3: Cache MISS — unknown provider, should return false
const missResults = runBenchmark(
  'Cache MISS (unknown provider)',
  () => cache.checkPermission(RECORD_ID, '0xUnknownProvider'),
  ITERATIONS
);

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(55));
console.log('  SUMMARY (paste this output back to Claude)');
console.log('='.repeat(55));
console.log(`  Hit   — mean: ${hitResults.mean.toFixed(6)} ms | p99: ${hitResults.p99.toFixed(6)} ms`);
console.log(`  Deny  — mean: ${denyResults.mean.toFixed(6)} ms | p99: ${denyResults.p99.toFixed(6)} ms`);
console.log(`  Miss  — mean: ${missResults.mean.toFixed(6)} ms | p99: ${missResults.p99.toFixed(6)} ms`);

const worstP99 = Math.max(hitResults.p99, denyResults.p99, missResults.p99);
console.log(`\n  Worst-case p99 across all scenarios: ${worstP99.toFixed(6)} ms`);
console.log(`  Claim "sub-millisecond" supported: ${worstP99 < 1.0 ? 'YES ✓' : 'NO — review cache impl ✗'}`);
console.log('='.repeat(55));