/**
 * MedConsentChain — Step 3: Multi-Wallet Trial
 *
 * Each of the 20 patient wallets:
 *   1. Deploys its own fresh MedConsent contract
 *   2. Runs: addRecord → grantPermission → revokePermission → checkPermission
 *   3. Records gas and block confirmation time
 *
 * Run: node multi_wallet/step3_multi_wallet_trial.js
 *
 * Prerequisites:
 *   - step1 and step2 must have run successfully
 *   - All 20 wallets must be funded
 *
 * Takes: ~60-90 minutes (20 wallets × ~4 Sepolia transactions each)
 * Output: results/multi_wallet_results.json
 */

'use strict';

require('dotenv').config();
const { ethers } = require('ethers');
const fs         = require('fs');
const path       = require('path');

const WALLETS_FILE  = path.join(__dirname, '..', 'wallets', 'patient_wallets.json');
const RESULTS_FILE  = path.join(__dirname, '..', 'results', 'multi_wallet_results.json');
const INFURA_URL    = process.env.INFURA_URL;

// MedConsent bytecode — compiled from contracts/MedConsent.sol
// We deploy fresh for each patient wallet
const MEDCONSENT_ABI = [
  'function addRecord(string recordId, bytes32 contentHash, string ipfsPointer, string wrappedKey) external',
  'function grantPermission(string recordId, address provider, uint256 durationSeconds) external',
  'function revokePermission(string recordId, address provider) external',
  'function checkPermission(string recordId, address provider) external returns (bool)',
  'event RecordAdded(string recordId, bytes32 contentHash, uint256 timestamp)',
  'event PermissionGranted(string recordId, address provider, uint256 expiresAt, uint256 timestamp)',
  'event PermissionRevoked(string recordId, address provider, uint256 timestamp)',
  'event AccessLogged(string recordId, address provider, bool allowed, uint256 timestamp)',
];

// We need the bytecode to deploy — get it from Hardhat artifacts
function loadBytecode() {
  const artifactPath = path.join(__dirname, '..', 'artifacts', 'contracts',
    'MedConsent.sol', 'MedConsent.json');

  if (!fs.existsSync(artifactPath)) {
    console.error('  ✗ Artifact not found. Run: npx hardhat compile');
    process.exit(1);
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  return artifact.bytecode;
}

function stats(arr) {
  if (arr.length === 0) return { mean: 0, min: 0, max: 0, p95: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const mean   = arr.reduce((s, v) => s + v, 0) / arr.length;
  const p95    = sorted[Math.floor(arr.length * 0.95)] ?? sorted[sorted.length - 1];
  return {
    mean: Math.round(mean * 100) / 100,
    min:  sorted[0],
    max:  sorted[sorted.length - 1],
    p95,
  };
}

async function runSingleWalletTrial(walletData, bytecode, provider) {
  const patientWallet = new ethers.Wallet(walletData.privateKey, provider);
  const factory       = new ethers.ContractFactory(MEDCONSENT_ABI, bytecode, patientWallet);

  const trialResult = {
    walletIndex:  walletData.index,
    address:      walletData.address,
    contractAddr: null,
    gas: {
      deploy:           null,
      addRecord:        null,
      grantPermission:  null,
      revokePermission: null,
      checkPermission:  null,
    },
    blockDeltaSeconds: null,
    error: null,
  };

  try {
    // Deploy fresh contract
    process.stdout.write(`    deploy... `);
    const contract   = await factory.deploy();
    const deployReceipt = await contract.deploymentTransaction().wait();
    trialResult.contractAddr       = await contract.getAddress();
    trialResult.gas.deploy         = Number(deployReceipt.gasUsed);
    const block1 = await provider.getBlock(deployReceipt.blockNumber);
    console.log(`gas=${deployReceipt.gasUsed} addr=${trialResult.contractAddr.slice(0,12)}...`);

    // Generate a fresh random provider wallet for this trial
    const providerWallet = ethers.Wallet.createRandom();
    const recordId       = `mw_rec_${walletData.index}_${Date.now()}`;
    const contentHash    = ethers.keccak256(ethers.toUtf8Bytes(`mw_content_${walletData.index}`));

    // addRecord
    process.stdout.write(`    addRecord... `);
    let tx      = await contract.addRecord(recordId, contentHash, `ipfs://QmMW${walletData.index}`, `key_mw_${walletData.index}`);
    let receipt = await tx.wait();
    trialResult.gas.addRecord = Number(receipt.gasUsed);
    console.log(`gas=${receipt.gasUsed}`);

    // grantPermission
    process.stdout.write(`    grantPermission... `);
    tx      = await contract.grantPermission(recordId, providerWallet.address, 3600);
    receipt = await tx.wait();
    trialResult.gas.grantPermission = Number(receipt.gasUsed);
    console.log(`gas=${receipt.gasUsed}`);

    // revokePermission
    process.stdout.write(`    revokePermission... `);
    tx      = await contract.revokePermission(recordId, providerWallet.address);
    receipt = await tx.wait();
    const block2 = await provider.getBlock(receipt.blockNumber);
    trialResult.gas.revokePermission  = Number(receipt.gasUsed);
    trialResult.blockDeltaSeconds     = block2.timestamp - block1.timestamp;
    console.log(`gas=${receipt.gasUsed} blockDelta=${trialResult.blockDeltaSeconds}s`);

    // checkPermission (post-revocation — must return false)
    process.stdout.write(`    checkPermission... `);
    tx      = await contract.checkPermission(recordId, providerWallet.address);
    receipt = await tx.wait();
    trialResult.gas.checkPermission = Number(receipt.gasUsed);

    // Verify INV-01: post-revocation access must be denied
    const accessLog = receipt.logs.find(l => {
      try { return contract.interface.parseLog(l)?.name === 'AccessLogged'; }
      catch { return false; }
    });
    const allowed = accessLog
      ? contract.interface.parseLog(accessLog).args.allowed
      : null;
    trialResult.postRevokeAllowed = allowed;

    console.log(`gas=${receipt.gasUsed} postRevoke=${allowed === false ? 'denied ✓' : 'ALLOWED ✗'}`);

  } catch (e) {
    console.log(`\n    ✗ ERROR: ${e.message}`);
    trialResult.error = e.message;
  }

  return trialResult;
}

async function main() {
  console.log('═'.repeat(60));
  console.log('  MedConsentChain — Step 3: Multi-Wallet Trial');
  console.log('═'.repeat(60));

  if (!INFURA_URL) {
    console.error('  ✗ Missing INFURA_URL in .env');
    process.exit(1);
  }

  if (!fs.existsSync(WALLETS_FILE)) {
    console.error('  ✗ wallets/patient_wallets.json not found. Run step1 and step2 first.');
    process.exit(1);
  }

  const wallets  = JSON.parse(fs.readFileSync(WALLETS_FILE, 'utf8'));
  const bytecode = loadBytecode();
  const provider = new ethers.JsonRpcProvider(INFURA_URL);

  // Check all wallets are funded
  const unfunded = wallets.filter(w => !w.funded);
  if (unfunded.length > 0) {
    console.error(`  ✗ ${unfunded.length} wallets not funded. Run step2 first.`);
    process.exit(1);
  }

  console.log(`\n  Wallets : ${wallets.length}`);
  console.log(`  Network : Sepolia`);
  console.log(`  Each wallet deploys its own MedConsent contract\n`);

  // Load existing results if re-running
  let allResults = [];
  if (fs.existsSync(RESULTS_FILE)) {
    const existing = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
    allResults = existing.trials || [];
    console.log(`  Resuming: ${allResults.filter(r=>!r.error).length} trials already done\n`);
  }

  const completedIndices = new Set(allResults.filter(r => !r.error).map(r => r.walletIndex));

  for (const w of wallets) {
    if (completedIndices.has(w.index)) {
      console.log(`\n  [${String(w.index).padStart(2,'0')}/${wallets.length}] Already done — skip`);
      continue;
    }

    console.log(`\n  [${String(w.index).padStart(2,'0')}/${wallets.length}] Patient: ${w.address}`);
    const result = await runSingleWalletTrial(w, bytecode, provider);
    allResults.push(result);

    // Save progress after each wallet
    fs.mkdirSync(path.dirname(RESULTS_FILE), { recursive: true });
    fs.writeFileSync(RESULTS_FILE, JSON.stringify({ trials: allResults }, null, 2));

    if (!result.error) {
      console.log(`    ✓ Wallet ${w.index} complete`);
    }
  }

  // ── Aggregate Statistics ────────────────────────────────────────────────────
  const successful = allResults.filter(r => !r.error);
  console.log('\n' + '═'.repeat(60));
  console.log(`  RESULTS: ${successful.length}/${wallets.length} wallets succeeded`);
  console.log('═'.repeat(60));

  if (successful.length > 0) {
    const deployGas   = stats(successful.map(r => r.gas.deploy));
    const addGas      = stats(successful.map(r => r.gas.addRecord));
    const grantGas    = stats(successful.map(r => r.gas.grantPermission));
    const revokeGas   = stats(successful.map(r => r.gas.revokePermission));
    const checkGas    = stats(successful.map(r => r.gas.checkPermission));
    const blockDeltas = stats(successful.map(r => r.blockDeltaSeconds).filter(Boolean));
    const inv01Pass   = successful.filter(r => r.postRevokeAllowed === false).length;

    console.log(`\n  Gas Statistics (${successful.length} wallets):`);
    console.log(`    deploy          : mean=${deployGas.mean}  min=${deployGas.min}  max=${deployGas.max}`);
    console.log(`    addRecord       : mean=${addGas.mean}  min=${addGas.min}  max=${addGas.max}`);
    console.log(`    grantPermission : mean=${grantGas.mean}  min=${grantGas.min}  max=${grantGas.max}`);
    console.log(`    revokePermission: mean=${revokeGas.mean}  min=${revokeGas.min}  max=${revokeGas.max}`);
    console.log(`    checkPermission : mean=${checkGas.mean}  min=${checkGas.min}  max=${checkGas.max}`);
    console.log(`\n  Block delta      : mean=${blockDeltas.mean}s  p95=${blockDeltas.p95}s`);
    console.log(`  INV-01 (post-revoke denied): ${inv01Pass}/${successful.length} ✓`);

    // Save full report
    const report = {
      summary: {
        totalWallets:    wallets.length,
        successful:      successful.length,
        failed:          wallets.length - successful.length,
        inv01Pass,
        gas: { deployGas, addGas, grantGas, revokeGas, checkGas },
        blockDeltas,
      },
      trials: allResults,
    };
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(report, null, 2));


    console.log('  ' + '─'.repeat(50));
    console.log(`  Successful wallets: ${successful.length}/${wallets.length}`);
    console.log(`  deploy gas    : mean=${deployGas.mean} min=${deployGas.min} max=${deployGas.max}`);
    console.log(`  addRecord     : mean=${addGas.mean} min=${addGas.min} max=${addGas.max}`);
    console.log(`  grantPerm     : mean=${grantGas.mean} min=${grantGas.min} max=${grantGas.max}`);
    console.log(`  revokePerm    : mean=${revokeGas.mean} min=${revokeGas.min} max=${revokeGas.max}`);
    console.log(`  checkPerm     : mean=${checkGas.mean} min=${checkGas.min} max=${checkGas.max}`);
    console.log(`  blockDelta    : mean=${blockDeltas.mean}s p95=${blockDeltas.p95}s`);
    console.log(`  INV-01 pass   : ${inv01Pass}/${successful.length}`);
    console.log('  ' + '─'.repeat(50));
  }

  console.log('═'.repeat(60));
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});