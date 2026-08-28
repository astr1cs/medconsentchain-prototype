/**
 * MedConsentChain — Step 2: Fund Patient Wallets
 *
 * Sends 0.008 ETH from your main wallet to each of the 20
 * generated patient wallets sequentially.
 *
 * Run: node multi_wallet/step2_fund_wallets.js
 *
 * Prerequisites:
 *   - step1_generate_wallets.js must have run (wallets/patient_wallets.json exists)
 *   - .env with INFURA_URL and PRIVATE_KEY (your main wallet)
 *   - Main wallet needs ~0.165 ETH (0.008 × 20 + gas)
 *
 * Takes: ~5-8 minutes (20 sequential transactions)
 */

'use strict';

require('dotenv').config();
const { ethers } = require('ethers');
const fs         = require('fs');
const path       = require('path');

const WALLETS_FILE   = path.join(__dirname, '..', 'wallets', 'patient_wallets.json');
const FUND_AMOUNT    = ethers.parseEther('0.008'); // per wallet
const INFURA_URL     = process.env.INFURA_URL;
const PRIVATE_KEY    = process.env.PRIVATE_KEY;

async function main() {
  console.log('═'.repeat(55));
  console.log('  MedConsentChain — Step 2: Fund Patient Wallets');
  console.log('═'.repeat(55));

  if (!INFURA_URL || !PRIVATE_KEY) {
    console.error('  ✗ Missing INFURA_URL or PRIVATE_KEY in .env');
    process.exit(1);
  }

  if (!fs.existsSync(WALLETS_FILE)) {
    console.error('  ✗ wallets/patient_wallets.json not found');
    console.error('  Run step1 first: node multi_wallet/step1_generate_wallets.js');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(INFURA_URL);
  const funder   = new ethers.Wallet(PRIVATE_KEY, provider);
  const wallets  = JSON.parse(fs.readFileSync(WALLETS_FILE, 'utf8'));

  const balance = await provider.getBalance(funder.address);
  console.log(`\n  Funder : ${funder.address}`);
  console.log(`  Balance: ${ethers.formatEther(balance)} ETH`);

  const totalNeeded = FUND_AMOUNT * BigInt(wallets.length);
  console.log(`  Sending: ${ethers.formatEther(FUND_AMOUNT)} ETH × ${wallets.length} = ${ethers.formatEther(totalNeeded)} ETH`);

  if (balance < totalNeeded) {
    console.error(`\n  ✗ Insufficient balance. Need ${ethers.formatEther(totalNeeded)} ETH`);
    process.exit(1);
  }

  console.log('\n  Funding wallets...\n');

  let successCount = 0;

  for (const w of wallets) {
    if (w.funded) {
      console.log(`  [${String(w.index).padStart(2,'0')}] Already funded — skip`);
      successCount++;
      continue;
    }

    try {
      process.stdout.write(`  [${String(w.index).padStart(2,'0')}] Sending to ${w.address}... `);

      const tx = await funder.sendTransaction({
        to:    w.address,
        value: FUND_AMOUNT,
      });

      await tx.wait();
      w.funded   = true;
      w.fundTxHash = tx.hash;
      successCount++;

      console.log(`✓ tx=${tx.hash.slice(0, 18)}...`);
    } catch (e) {
      console.log(`✗ FAILED: ${e.message}`);
      w.fundError = e.message;
    }

    // Save progress after each wallet in case of interruption
    fs.writeFileSync(WALLETS_FILE, JSON.stringify(wallets, null, 2));
  }

  // Final balance check
  const balanceAfter = await provider.getBalance(funder.address);

  console.log('\n' + '═'.repeat(55));
  console.log(`  Funded: ${successCount}/${wallets.length} wallets`);
  console.log(`  Balance after: ${ethers.formatEther(balanceAfter)} ETH`);
  console.log(`  ETH spent: ${ethers.formatEther(balance - balanceAfter)} ETH`);

  if (successCount === wallets.length) {
    console.log('\n  ✓ All wallets funded successfully');
    console.log('  Next: node multi_wallet/step3_multi_wallet_trial.js');
  } else {
    console.log(`\n  ⚠ ${wallets.length - successCount} wallets failed — re-run to retry`);
  }
  console.log('═'.repeat(55));
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});