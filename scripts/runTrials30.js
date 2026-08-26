/**
 * MedConsentChain — 30-Trial Evaluation Script
 * Run locally: node scripts/runTrials30.js
 *
 * Requires .env with INFURA_URL and PRIVATE_KEY
 * Results saved to results/trial_results_30.json
 */

require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");

const INFURA_URL            = process.env.INFURA_URL;
const PRIVATE_KEY           = process.env.PRIVATE_KEY;
const MEDCONSENT_ADDRESS    = "0xCa90Ec6366181f791f95873E849FB4561bee6fB4";
const NAIVEBASELINE_ADDRESS = "0xEc6BC1Cd2F8b5ba3BcB75a8070E58776D2b374a3";
const TRIALS = 30;

if (!INFURA_URL || !PRIVATE_KEY) {
  console.error("ERROR: Missing INFURA_URL or PRIVATE_KEY in .env");
  process.exit(1);
}

const MEDCONSENT_ABI = [
  "function addRecord(string recordId, bytes32 contentHash, string ipfsPointer, string wrappedKey) external",
  "function grantPermission(string recordId, address provider, uint256 durationSeconds) external",
  "function revokePermission(string recordId, address provider) external",
  "function checkPermission(string recordId, address provider) external returns (bool)",
  "event RecordAdded(string recordId, bytes32 contentHash, uint256 timestamp)",
  "event PermissionGranted(string recordId, address provider, uint256 expiresAt, uint256 timestamp)",
  "event PermissionRevoked(string recordId, address provider, uint256 timestamp)",
  "event AccessLogged(string recordId, address provider, bool allowed, uint256 timestamp)"
];

const NAIVE_ABI = [
  "function addRecord(string recordId, bytes32 contentHash, string ipfsPointer, string wrappedKey) external",
  "function grantPermission(string recordId, address provider, uint256 durationSeconds) external",
  "function revokePermission(string recordId, address provider) external",
  "event RecordAdded(string recordId, bytes32 contentHash, uint256 timestamp)",
  "event PermissionGranted(string recordId, address provider, uint256 expiresAt, uint256 timestamp)",
  "event PermissionRevoked(string recordId, address provider, uint256 timestamp)"
];

// Full descriptive statistics
function stats(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const n      = arr.length;
  const mean   = arr.reduce((a, b) => a + b, 0) / n;
  const variance = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);
  const p50    = sorted[Math.floor(n * 0.50)];
  const p75    = sorted[Math.floor(n * 0.75)];
  const p95    = sorted[Math.floor(n * 0.95)];
  return {
    n,
    mean:   Math.round(mean * 100) / 100,
    stddev: Math.round(stddev * 100) / 100,
    min:    sorted[0],
    p50,
    p75,
    p95,
    max:    sorted[n - 1]
  };
}

// Progress bar helper
function progress(trial, total, op) {
  const pct  = Math.round((trial / total) * 100);
  const bar  = "=".repeat(Math.floor(pct / 5)).padEnd(20, " ");
  process.stdout.write(`\r  [${bar}] ${pct}% Trial ${trial}/${total} — ${op}   `);
}

async function main() {
  const provider = new ethers.JsonRpcProvider(INFURA_URL);
  const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log("=================================================");
  console.log("  MedConsentChain — 30-Trial Evaluation");
  console.log("=================================================");
  console.log("Wallet :", wallet.address);
  const balance = await provider.getBalance(wallet.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  // Rough estimate: ~310k gas per trial × 30 × current gas price
  const feeData  = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? ethers.parseUnits("2", "gwei");
  const estCost  = gasPrice * BigInt(310000) * BigInt(TRIALS);
  console.log("Est. cost (MedConsent only):", ethers.formatEther(estCost), "ETH");
  console.log("-------------------------------------------------\n");

  const medConsent    = new ethers.Contract(MEDCONSENT_ADDRESS,    MEDCONSENT_ABI, wallet);
  const naiveBaseline = new ethers.Contract(NAIVEBASELINE_ADDRESS, NAIVE_ABI,      wallet);

  const raw = {
    medconsent: {
      addRecord: [], grantPermission: [], revokePermission: [],
      checkPermission: [], blockTimes: [], auditEvents: []
    },
    naive: { addRecord: [], grantPermission: [], revokePermission: [] }
  };

  // ── MedConsent trials ──────────────────────────────────────────
  console.log(`Running ${TRIALS} MedConsent trials...\n`);

  for (let i = 0; i < TRIALS; i++) {
    const recordId       = `rec${i}x${Date.now()}`;
    const providerWallet = ethers.Wallet.createRandom();
    const contentHash    = ethers.keccak256(ethers.toUtf8Bytes(`content_trial_${i}`));

    progress(i + 1, TRIALS, "addRecord");
    let tx = await medConsent.addRecord(recordId, contentHash, `ipfs://QmTrial${i}`, `wrappedkey${i}`);
    let receipt = await provider.waitForTransaction(tx.hash, 1, 180000);
    raw.medconsent.addRecord.push(Number(receipt.gasUsed));
    const block1 = await provider.getBlock(receipt.blockNumber);

    progress(i + 1, TRIALS, "grantPermission");
    tx = await medConsent.grantPermission(recordId, providerWallet.address, 3600);
    receipt = await provider.waitForTransaction(tx.hash, 1, 180000);
    raw.medconsent.grantPermission.push(Number(receipt.gasUsed));

    progress(i + 1, TRIALS, "checkPermission");
    tx = await medConsent.checkPermission(recordId, providerWallet.address);
    receipt = await provider.waitForTransaction(tx.hash, 1, 180000);
    raw.medconsent.checkPermission.push(Number(receipt.gasUsed));
    // Count AccessLogged events for audit completeness (RQ2)
    raw.medconsent.auditEvents.push(receipt.logs.length);

    progress(i + 1, TRIALS, "revokePermission");
    tx = await medConsent.revokePermission(recordId, providerWallet.address);
    receipt = await provider.waitForTransaction(tx.hash, 1, 180000);
    const block2 = await provider.getBlock(receipt.blockNumber);
    raw.medconsent.revokePermission.push(Number(receipt.gasUsed));
    raw.medconsent.blockTimes.push(block2.timestamp - block1.timestamp);
  }

  console.log("\n\nMedConsent trials complete.");

  // ── NaiveBaseline trials ───────────────────────────────────────
  console.log(`\nRunning ${TRIALS} NaiveBaseline trials...\n`);

  for (let i = 0; i < TRIALS; i++) {
    const recordId       = `nai${i}x${Date.now()}`;
    const providerWallet = ethers.Wallet.createRandom();
    const contentHash    = ethers.keccak256(ethers.toUtf8Bytes(`naive_trial_${i}`));

    progress(i + 1, TRIALS, "addRecord");
    let tx = await naiveBaseline.addRecord(recordId, contentHash, `ipfs://QmNaive${i}`, `naivekey${i}`);
    let receipt = await provider.waitForTransaction(tx.hash, 1, 180000);
    raw.naive.addRecord.push(Number(receipt.gasUsed));

    progress(i + 1, TRIALS, "grantPermission");
    tx = await naiveBaseline.grantPermission(recordId, providerWallet.address, 3600);
    receipt = await provider.waitForTransaction(tx.hash, 1, 180000);
    raw.naive.grantPermission.push(Number(receipt.gasUsed));

    progress(i + 1, TRIALS, "revokePermission");
    tx = await naiveBaseline.revokePermission(recordId, providerWallet.address);
    receipt = await provider.waitForTransaction(tx.hash, 1, 180000);
    raw.naive.revokePermission.push(Number(receipt.gasUsed));
  }

  console.log("\n\nNaiveBaseline trials complete.\n");

  // ── Compute statistics ─────────────────────────────────────────
  const totalAuditOps   = raw.medconsent.auditEvents.reduce((a, b) => a + b, 0);
  const expectedAuditOps = TRIALS; // one AccessLogged per checkPermission call
  const auditCompleteness = (totalAuditOps / expectedAuditOps * 100).toFixed(1);

  const report = {
    meta: {
      trials: TRIALS,
      network: "Ethereum Sepolia (chain 11155111)",
      medconsentAddress: MEDCONSENT_ADDRESS,
      naiveBaselineAddress: NAIVEBASELINE_ADDRESS,
      timestamp: new Date().toISOString()
    },
    medconsent: {
      addRecord:               stats(raw.medconsent.addRecord),
      grantPermission:         stats(raw.medconsent.grantPermission),
      revokePermission:        stats(raw.medconsent.revokePermission),
      checkPermission:         stats(raw.medconsent.checkPermission),
      blockConfirmationSeconds: stats(raw.medconsent.blockTimes),
      auditCompleteness: {
        total:    totalAuditOps,
        expected: expectedAuditOps,
        percent:  auditCompleteness + "%"
      }
    },
    naive: {
      addRecord:        stats(raw.naive.addRecord),
      grantPermission:  stats(raw.naive.grantPermission),
      revokePermission: stats(raw.naive.revokePermission)
    },
    raw
  };

  // ── Print summary ──────────────────────────────────────────────
  console.log("=================================================");
  console.log("  RESULTS SUMMARY");
  console.log("=================================================");

  console.log("\nMedConsent Gas (mean ± stddev):");
  for (const op of ["addRecord","grantPermission","revokePermission","checkPermission"]) {
    const s = report.medconsent[op];
    console.log(`  ${op.padEnd(20)} mean=${s.mean}  stddev=${s.stddev}  p95=${s.p95}`);
  }

  const bc = report.medconsent.blockConfirmationSeconds;
  console.log(`\nBlock confirmation (s):  mean=${bc.mean}  p50=${bc.p50}  p95=${bc.p95}  max=${bc.max}`);
  console.log(`Audit completeness:      ${totalAuditOps}/${expectedAuditOps} = ${auditCompleteness}%`);

  console.log("\nNaiveBaseline Gas (mean ± stddev):");
  for (const op of ["addRecord","grantPermission","revokePermission"]) {
    const s = report.naive[op];
    console.log(`  ${op.padEnd(20)} mean=${s.mean}  stddev=${s.stddev}  p95=${s.p95}`);
  }

  // ── Save results ───────────────────────────────────────────────
  fs.mkdirSync("results", { recursive: true });
  const outPath = "results/trial_results_30.json";
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nSaved to ${outPath}`);
}

main().catch(e => {
  console.error("\nFATAL:", e.message);
  process.exit(1);
});