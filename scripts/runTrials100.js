/**
 * MedConsentChain — 100-Trial Evaluation Script
 * Run: node scripts/runTrials100.js
 *
 * Requires .env with:
 *   INFURA_URL=https://sepolia.infura.io/v3/YOUR_KEY
 *   PRIVATE_KEY=0xYOUR_WALLET_PRIVATE_KEY
 *
 * Results saved to results/trial_results_100.json
 *
 * Estimated cost: ~0.06–0.10 ETH on Sepolia (free from faucet)
 * Estimated time: ~90–120 minutes (block confirmation per tx)
 *
 * Contracts already deployed on Sepolia:
 *   MedConsent    : 0xCa90Ec6366181f791f95873E849FB4561bee6fB4
 *   NaiveBaseline : 0xEc6BC1Cd2F8b5ba3BcB75a8070E58776D2b374a3
 */

require("dotenv").config();
const { ethers } = require("ethers");
const fs          = require("fs");

// ── Config ────────────────────────────────────────────────────────
const INFURA_URL            = process.env.INFURA_URL;
const PRIVATE_KEY           = process.env.PRIVATE_KEY;
const MEDCONSENT_ADDRESS    = "0xCa90Ec6366181f791f95873E849FB4561bee6fB4";
const NAIVEBASELINE_ADDRESS = "0xEc6BC1Cd2F8b5ba3BcB75a8070E58776D2b374a3";
const TRIALS                = 100;
const OUT_PATH              = "results/trial_results_100.json";

if (!INFURA_URL || !PRIVATE_KEY) {
  console.error("ERROR: Set INFURA_URL and PRIVATE_KEY in your .env file");
  process.exit(1);
}

// ── ABIs ──────────────────────────────────────────────────────────
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

// ── Statistics ────────────────────────────────────────────────────
function stats(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const n      = arr.length;
  const mean   = arr.reduce((a, b) => a + b, 0) / n;
  const variance = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);
  return {
    n,
    mean:   Math.round(mean * 100) / 100,
    stddev: Math.round(stddev * 100) / 100,
    min:    sorted[0],
    p50:    sorted[Math.floor(n * 0.50)],
    p75:    sorted[Math.floor(n * 0.75)],
    p95:    sorted[Math.floor(n * 0.95)],
    max:    sorted[n - 1]
  };
}

// ── Progress bar ──────────────────────────────────────────────────
function progress(trial, total, op) {
  const pct = Math.round((trial / total) * 100);
  const bar = "=".repeat(Math.floor(pct / 5)).padEnd(20, " ");
  process.stdout.write(`\r  [${bar}] ${pct}%  Trial ${trial}/${total} — ${op}          `);
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  const provider = new ethers.JsonRpcProvider(INFURA_URL);
  const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log("=================================================");
  console.log("  MedConsentChain — 100-Trial Evaluation");
  console.log("=================================================");
  console.log("Wallet :", wallet.address);

  const balance = await provider.getBalance(wallet.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  // Cost estimate: 4 txs × ~77k avg gas × 100 trials × gas price
  const feeData  = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? ethers.parseUnits("2", "gwei");
  const avgGasPerTrial = BigInt(310000); // addRecord+grant+check+revoke
  const estCostMC   = gasPrice * avgGasPerTrial * BigInt(TRIALS);
  const estCostNaive = gasPrice * BigInt(230000) * BigInt(TRIALS); // no check
  console.log("Est. cost MedConsent  :", ethers.formatEther(estCostMC), "ETH");
  console.log("Est. cost NaiveBaseline:", ethers.formatEther(estCostNaive), "ETH");
  console.log("Est. total            :", ethers.formatEther(estCostMC + estCostNaive), "ETH");
  console.log("Est. time             : ~90–120 min (12 s/block)");
  console.log("-------------------------------------------------\n");

  if (ethers.parseEther("0.05") > balance) {
    console.error("WARNING: Balance may be too low. Top up from https://sepoliafaucet.com");
  }

  const medConsent    = new ethers.Contract(MEDCONSENT_ADDRESS,    MEDCONSENT_ABI, wallet);
  const naiveBaseline = new ethers.Contract(NAIVEBASELINE_ADDRESS, NAIVE_ABI,      wallet);

  const raw = {
    medconsent: {
      addRecord: [], grantPermission: [], revokePermission: [],
      checkPermission: [], blockTimes: [], auditEvents: []
    },
    naive: {
      addRecord: [], grantPermission: [], revokePermission: []
    }
  };

  // ── MedConsent 100 trials ─────────────────────────────────────
  console.log(`Running ${TRIALS} MedConsent trials...\n`);

  for (let i = 0; i < TRIALS; i++) {
    const recordId       = `rec${i}x${Date.now()}`;
    const providerWallet = ethers.Wallet.createRandom();
    const contentHash    = ethers.keccak256(ethers.toUtf8Bytes(`content_trial_${i}`));

    try {
      // addRecord
      progress(i + 1, TRIALS, "addRecord");
      let tx      = await medConsent.addRecord(recordId, contentHash, `ipfs://QmTrial${i}`, `wrappedkey${i}`);
      let receipt = await provider.waitForTransaction(tx.hash, 1, 180000);
      raw.medconsent.addRecord.push(Number(receipt.gasUsed));
      const block1 = await provider.getBlock(receipt.blockNumber);

      // grantPermission
      progress(i + 1, TRIALS, "grantPermission");
      tx      = await medConsent.grantPermission(recordId, providerWallet.address, 3600);
      receipt = await provider.waitForTransaction(tx.hash, 1, 180000);
      raw.medconsent.grantPermission.push(Number(receipt.gasUsed));

      // checkPermission (async audit log)
      progress(i + 1, TRIALS, "checkPermission");
      tx      = await medConsent.checkPermission(recordId, providerWallet.address);
      receipt = await provider.waitForTransaction(tx.hash, 1, 180000);
      raw.medconsent.checkPermission.push(Number(receipt.gasUsed));
      // Count AccessLogged events emitted (RQ2 audit completeness)
      raw.medconsent.auditEvents.push(receipt.logs.length > 0 ? 1 : 0);

      // revokePermission — measure block time delta here (RQ1)
      progress(i + 1, TRIALS, "revokePermission");
      tx      = await medConsent.revokePermission(recordId, providerWallet.address);
      receipt = await provider.waitForTransaction(tx.hash, 1, 180000);
      const block2 = await provider.getBlock(receipt.blockNumber);
      raw.medconsent.revokePermission.push(Number(receipt.gasUsed));
      raw.medconsent.blockTimes.push(block2.timestamp - block1.timestamp);

    } catch (err) {
      console.error(`\nTrial ${i + 1} failed: ${err.message}`);
      console.error("Continuing with remaining trials...");
    }
  }

  console.log("\n\nMedConsent trials complete.");

  // ── NaiveBaseline 100 trials ──────────────────────────────────
  console.log(`\nRunning ${TRIALS} NaiveBaseline trials...\n`);

  for (let i = 0; i < TRIALS; i++) {
    const recordId       = `nai${i}x${Date.now()}`;
    const providerWallet = ethers.Wallet.createRandom();
    const contentHash    = ethers.keccak256(ethers.toUtf8Bytes(`naive_trial_${i}`));

    try {
      progress(i + 1, TRIALS, "addRecord");
      let tx      = await naiveBaseline.addRecord(recordId, contentHash, `ipfs://QmNaive${i}`, `naivekey${i}`);
      let receipt = await provider.waitForTransaction(tx.hash, 1, 180000);
      raw.naive.addRecord.push(Number(receipt.gasUsed));

      progress(i + 1, TRIALS, "grantPermission");
      tx      = await naiveBaseline.grantPermission(recordId, providerWallet.address, 3600);
      receipt = await provider.waitForTransaction(tx.hash, 1, 180000);
      raw.naive.grantPermission.push(Number(receipt.gasUsed));

      progress(i + 1, TRIALS, "revokePermission");
      tx      = await naiveBaseline.revokePermission(recordId, providerWallet.address);
      receipt = await provider.waitForTransaction(tx.hash, 1, 180000);
      raw.naive.revokePermission.push(Number(receipt.gasUsed));

    } catch (err) {
      console.error(`\nNaive trial ${i + 1} failed: ${err.message}`);
      console.error("Continuing...");
    }
  }

  console.log("\n\nNaiveBaseline trials complete.\n");

  // ── Compute statistics ────────────────────────────────────────
  const totalAuditEvents  = raw.medconsent.auditEvents.reduce((a, b) => a + b, 0);
  const expectedAuditOps  = raw.medconsent.checkPermission.length; // actual completed trials
  const auditPct          = (totalAuditEvents / expectedAuditOps * 100).toFixed(1);
  const completedTrials   = raw.medconsent.addRecord.length;

  const report = {
    meta: {
      trials:              TRIALS,
      completedTrials,
      network:             "Ethereum Sepolia (chain 11155111)",
      medconsentAddress:   MEDCONSENT_ADDRESS,
      naiveBaselineAddress: NAIVEBASELINE_ADDRESS,
      timestamp:           new Date().toISOString()
    },
    medconsent: {
      addRecord:                stats(raw.medconsent.addRecord),
      grantPermission:          stats(raw.medconsent.grantPermission),
      revokePermission:         stats(raw.medconsent.revokePermission),
      checkPermission:          stats(raw.medconsent.checkPermission),
      blockConfirmationSeconds: stats(raw.medconsent.blockTimes),
      auditCompleteness: {
        total:    totalAuditEvents,
        expected: expectedAuditOps,
        percent:  auditPct + "%"
      }
    },
    naive: {
      addRecord:        stats(raw.naive.addRecord),
      grantPermission:  stats(raw.naive.grantPermission),
      revokePermission: stats(raw.naive.revokePermission)
    },
    raw
  };

  // ── Print summary ─────────────────────────────────────────────
  console.log("=================================================");
  console.log("  RESULTS SUMMARY — 100 Trials");
  console.log("=================================================");

  console.log("\nMedConsent Gas (mean ± σ, p95):");
  for (const op of ["addRecord", "grantPermission", "revokePermission", "checkPermission"]) {
    const s = report.medconsent[op];
    console.log(`  ${op.padEnd(22)} mean=${s.mean}  σ=${s.stddev}  p95=${s.p95}`);
  }

  const bc = report.medconsent.blockConfirmationSeconds;
  console.log(`\nBlock confirmation (s):   mean=${bc.mean}  p50=${bc.p50}  p95=${bc.p95}  max=${bc.max}`);
  console.log(`Audit completeness:       ${totalAuditEvents}/${expectedAuditOps} = ${auditPct}%`);

  console.log("\nNaiveBaseline Gas (mean ± σ):");
  for (const op of ["addRecord", "grantPermission", "revokePermission"]) {
    const s = report.naive[op];
    console.log(`  ${op.padEnd(22)} mean=${s.mean}  σ=${s.stddev}  p95=${s.p95}`);
  }

  if (completedTrials < TRIALS) {
    console.log(`\nWARNING: Only ${completedTrials}/${TRIALS} trials completed. Check errors above.`);
  }

  // ── Save ──────────────────────────────────────────────────────
  fs.mkdirSync("results", { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2));
  console.log(`\nResults saved to ${OUT_PATH}`);
  console.log("Share this file and we will update the paper with real numbers.\n");
}

main().catch(e => {
  console.error("\nFATAL:", e.message);
  process.exit(1);
});