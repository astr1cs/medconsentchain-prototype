require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");

// Load from .env — never hardcode private keys in source
const INFURA_URL           = process.env.INFURA_URL;
const PRIVATE_KEY          = process.env.PRIVATE_KEY;
const MEDCONSENT_ADDRESS   = "0xCa90Ec6366181f791f95873E849FB4561bee6fB4";
const NAIVEBASELINE_ADDRESS = "0xEc6BC1Cd2F8b5ba3BcB75a8070E58776D2b374a3";
const TRIALS = 10;

if (!INFURA_URL || !PRIVATE_KEY) {
  console.error("Missing INFURA_URL or PRIVATE_KEY in .env");
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

function stats(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mean   = arr.reduce((a, b) => a + b, 0) / arr.length;
  const p50    = sorted[Math.floor(arr.length * 0.5)];
  const p95    = sorted[Math.floor(arr.length * 0.95)];
  return { mean: Math.round(mean), p50, p95, min: sorted[0], max: sorted[sorted.length - 1] };
}

async function main() {
  const provider   = new ethers.JsonRpcProvider(INFURA_URL);
  const wallet     = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log("Wallet:", wallet.address);
  const balance = await provider.getBalance(wallet.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  const medConsent   = new ethers.Contract(MEDCONSENT_ADDRESS,    MEDCONSENT_ABI, wallet);
  const naiveBaseline = new ethers.Contract(NAIVEBASELINE_ADDRESS, NAIVE_ABI,      wallet);

  const results = {
    medconsent: { addRecord: [], grantPermission: [], revokePermission: [], checkPermission: [], blockTimes: [] },
    naive:      { addRecord: [], grantPermission: [], revokePermission: [] },
  };

  console.log("\nRunning", TRIALS, "trials on MedConsent...");

  for (let i = 0; i < TRIALS; i++) {
    console.log(`\nTrial ${i + 1}/${TRIALS}`);
    const recordId       = `rec${i}x${Date.now()}`;
    const providerWallet = ethers.Wallet.createRandom();
    const contentHash    = ethers.keccak256(ethers.toUtf8Bytes(`content${i}`));

    process.stdout.write("  addRecord... ");
    let tx      = await medConsent.addRecord(recordId, contentHash, `ipfs://Qm${i}`, `key${i}`);
    let receipt = await provider.waitForTransaction(tx.hash, 1, 120000);
    results.medconsent.addRecord.push(Number(receipt.gasUsed));
    const block1 = await provider.getBlock(receipt.blockNumber);
    console.log(`gas=${receipt.gasUsed}`);

    process.stdout.write("  grantPermission... ");
    tx      = await medConsent.grantPermission(recordId, providerWallet.address, 3600);
    receipt = await provider.waitForTransaction(tx.hash, 1, 120000);
    results.medconsent.grantPermission.push(Number(receipt.gasUsed));
    console.log(`gas=${receipt.gasUsed}`);

    process.stdout.write("  checkPermission... ");
    tx      = await medConsent.checkPermission(recordId, providerWallet.address);
    receipt = await provider.waitForTransaction(tx.hash, 1, 120000);
    results.medconsent.checkPermission.push(Number(receipt.gasUsed));
    console.log(`gas=${receipt.gasUsed}`);

    process.stdout.write("  revokePermission... ");
    tx      = await medConsent.revokePermission(recordId, providerWallet.address);
    receipt = await provider.waitForTransaction(tx.hash, 1, 120000);
    const block2 = await provider.getBlock(receipt.blockNumber);
    results.medconsent.revokePermission.push(Number(receipt.gasUsed));
    results.medconsent.blockTimes.push(block2.timestamp - block1.timestamp);
    console.log(`gas=${receipt.gasUsed} blockDelta=${block2.timestamp - block1.timestamp}s`);
  }

  console.log("\nRunning", TRIALS, "trials on NaiveBaseline...");

  for (let i = 0; i < TRIALS; i++) {
    console.log(`\nNaive Trial ${i + 1}/${TRIALS}`);
    const recordId       = `nai${i}x${Date.now()}`;
    const providerWallet = ethers.Wallet.createRandom();
    const contentHash    = ethers.keccak256(ethers.toUtf8Bytes(`naive${i}`));

    process.stdout.write("  addRecord... ");
    let tx      = await naiveBaseline.addRecord(recordId, contentHash, `ipfs://Qm${i}`, `key${i}`);
    let receipt = await provider.waitForTransaction(tx.hash, 1, 120000);
    results.naive.addRecord.push(Number(receipt.gasUsed));
    console.log(`gas=${receipt.gasUsed}`);

    process.stdout.write("  grantPermission... ");
    tx      = await naiveBaseline.grantPermission(recordId, providerWallet.address, 3600);
    receipt = await provider.waitForTransaction(tx.hash, 1, 120000);
    results.naive.grantPermission.push(Number(receipt.gasUsed));
    console.log(`gas=${receipt.gasUsed}`);

    process.stdout.write("  revokePermission... ");
    tx      = await naiveBaseline.revokePermission(recordId, providerWallet.address);
    receipt = await provider.waitForTransaction(tx.hash, 1, 120000);
    results.naive.revokePermission.push(Number(receipt.gasUsed));
    console.log(`gas=${receipt.gasUsed}`);
  }

  const report = {
    medconsent: {
      addRecord:              stats(results.medconsent.addRecord),
      grantPermission:        stats(results.medconsent.grantPermission),
      revokePermission:       stats(results.medconsent.revokePermission),
      checkPermission:        stats(results.medconsent.checkPermission),
      blockConfirmationSeconds: stats(results.medconsent.blockTimes),
    },
    naive: {
      addRecord:        stats(results.naive.addRecord),
      grantPermission:  stats(results.naive.grantPermission),
      revokePermission: stats(results.naive.revokePermission),
    },
    raw: results,
  };

  console.log("\n===== FINAL RESULTS =====");
  console.log(JSON.stringify(report, null, 2));

  fs.mkdirSync("results", { recursive: true });
  fs.writeFileSync("results/trial_results.json", JSON.stringify(report, null, 2));
  console.log("\nSaved to results/trial_results.json");
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
