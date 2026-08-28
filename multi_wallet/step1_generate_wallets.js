/**
 * MedConsentChain — Step 1: Generate Patient Wallets
 *
 * Generates 20 fresh Ethereum wallets for multi-patient evaluation.
 * Saves private keys + addresses to wallets/patient_wallets.json
 *
 * Run: node multi_wallet/step1_generate_wallets.js
 *
 * Output: wallets/patient_wallets.json
 * IMPORTANT: Keep wallets.json private — never commit to GitHub.
 *            It is already in .gitignore via the wallets/ folder.
 */

'use strict';

const { ethers } = require('ethers');
const fs         = require('fs');
const path       = require('path');

const NUM_WALLETS  = 20;
const OUTPUT_DIR   = path.join(__dirname, '..', 'wallets');
const OUTPUT_FILE  = path.join(OUTPUT_DIR, 'patient_wallets.json');

console.log('═'.repeat(55));
console.log('  MedConsentChain — Step 1: Generate Patient Wallets');
console.log('═'.repeat(55));
console.log(`  Generating ${NUM_WALLETS} wallets...\n`);

// Create output directory
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Generate wallets
const wallets = [];
for (let i = 0; i < NUM_WALLETS; i++) {
  const w = ethers.Wallet.createRandom();
  wallets.push({
    index:      i + 1,
    address:    w.address,
    privateKey: w.privateKey,
    funded:     false,
    trialDone:  false,
  });
  console.log(`  Wallet ${String(i + 1).padStart(2, '0')}: ${w.address}`);
}

// Save to file
fs.writeFileSync(OUTPUT_FILE, JSON.stringify(wallets, null, 2));

console.log(`\n  ✓ Saved ${NUM_WALLETS} wallets to wallets/patient_wallets.json`);
console.log('  ⚠ KEEP THIS FILE PRIVATE — contains private keys');
console.log('  ⚠ wallets/ folder is gitignored\n');
console.log('  Next step: node multi_wallet/step2_fund_wallets.js');
console.log('═'.repeat(55));