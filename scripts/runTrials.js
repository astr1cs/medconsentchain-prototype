const hre = require("hardhat");
const ethers = hre.ethers;

const MEDCONSENT_ADDRESS = "0xCa90Ec6366181f791f95873E849FB4561bee6fB4";
const NAIVEBASELINE_ADDRESS = "0xEc6BC1Cd2F8b5ba3BcB75a8070E58776D2b374a3";
const TRIALS = 10;

function stats(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const p50 = sorted[Math.floor(arr.length * 0.5)];
  const p95 = sorted[Math.floor(arr.length * 0.95)];
  return { mean: Math.round(mean), p50, p95, min: sorted[0], max: sorted[sorted.length - 1] };
}

async function main() {
  console.log("Connecting to contracts...");
  const [patient] = await ethers.getSigners();
  console.log("Wallet:", patient.address);

  const medConsent = await ethers.getContractAt("MedConsent", MEDCONSENT_ADDRESS);
  const naiveBaseline = await ethers.getContractAt("NaiveBaseline", NAIVEBASELINE_ADDRESS);

  const results = {
    medconsent: { addRecord: [], grantPermission: [], revokePermission: [], checkPermission: [], blockTimes: [] },
    naive: { addRecord: [], grantPermission: [], revokePermission: [] },
  };

  console.log("Running", TRIALS, "trials on MedConsent...");

  for (let i = 0; i < TRIALS; i++) {
    console.log(`Starting trial ${i + 1}...`);
    const recordId = `rec${i}${Date.now()}`;
    const providerWallet = ethers.Wallet.createRandom();
    const contentHash = ethers.keccak256(ethers.toUtf8Bytes(`content${i}`));

    console.log(`  addRecord...`);
    let tx = await medConsent.addRecord(recordId, contentHash, `ipfs://Qm${i}`, `key${i}`);
    let receipt = await tx.wait();
    results.medconsent.addRecord.push(Number(receipt.gasUsed));
    const block1 = await ethers.provider.getBlock(receipt.blockNumber);
    console.log(`  addRecord gas: ${receipt.gasUsed}`);

    console.log(`  grantPermission...`);
    tx = await medConsent.grantPermission(recordId, providerWallet.address, 3600);
    receipt = await tx.wait();
    results.medconsent.grantPermission.push(Number(receipt.gasUsed));
    console.log(`  grantPermission gas: ${receipt.gasUsed}`);

    console.log(`  checkPermission...`);
    tx = await medConsent.checkPermission(recordId, providerWallet.address);
    receipt = await tx.wait();
    results.medconsent.checkPermission.push(Number(receipt.gasUsed));
    console.log(`  checkPermission gas: ${receipt.gasUsed}`);

    console.log(`  revokePermission...`);
    tx = await medConsent.revokePermission(recordId, providerWallet.address);
    receipt = await tx.wait();
    const block2 = await ethers.provider.getBlock(receipt.blockNumber);
    results.medconsent.revokePermission.push(Number(receipt.gasUsed));
    results.medconsent.blockTimes.push(block2.timestamp - block1.timestamp);
    console.log(`  revokePermission gas: ${receipt.gasUsed}, blockDelta: ${block2.timestamp - block1.timestamp}s`);

    console.log(`Trial ${i + 1}/${TRIALS} complete.`);
  }

  console.log("\nRunning", TRIALS, "trials on NaiveBaseline...");

  for (let i = 0; i < TRIALS; i++) {
    console.log(`Starting naive trial ${i + 1}...`);
    const recordId = `nai${i}${Date.now()}`;
    const providerWallet = ethers.Wallet.createRandom();
    const contentHash = ethers.keccak256(ethers.toUtf8Bytes(`naive${i}`));

    let tx = await naiveBaseline.addRecord(recordId, contentHash, `ipfs://Qm${i}`, `key${i}`);
    let receipt = await tx.wait();
    results.naive.addRecord.push(Number(receipt.gasUsed));

    tx = await naiveBaseline.grantPermission(recordId, providerWallet.address, 3600);
    receipt = await tx.wait();
    results.naive.grantPermission.push(Number(receipt.gasUsed));

    tx = await naiveBaseline.revokePermission(recordId, providerWallet.address);
    receipt = await tx.wait();
    results.naive.revokePermission.push(Number(receipt.gasUsed));

    console.log(`Naive trial ${i + 1}/${TRIALS} complete. Revoke gas: ${receipt.gasUsed}`);
  }

  const report = {
    medconsent: {
      addRecord: stats(results.medconsent.addRecord),
      grantPermission: stats(results.medconsent.grantPermission),
      revokePermission: stats(results.medconsent.revokePermission),
      checkPermission: stats(results.medconsent.checkPermission),
      blockConfirmationSeconds: stats(results.medconsent.blockTimes),
    },
    naive: {
      addRecord: stats(results.naive.addRecord),
      grantPermission: stats(results.naive.grantPermission),
      revokePermission: stats(results.naive.revokePermission),
    },
    raw: results,
  };

  console.log("\n===== FINAL RESULTS =====");
  console.log(JSON.stringify(report, null, 2));

  const fs = require("fs");
  fs.mkdirSync("results", { recursive: true });
  fs.writeFileSync("results/trial_results.json", JSON.stringify(report, null, 2));
  console.log("\nSaved to results/trial_results.json");
}

main().catch((error) => {
  console.error("Error:", error.message);
  console.error(error);
  process.exit(1);
});