/**
 * Standalone balance checker — does NOT use Hardhat at all.
 * Run: node checkBalanceStandalone.js
 * Requires .env with INFURA_URL and PRIVATE_KEY
 */

require("dotenv").config();
const { ethers } = require("ethers");

async function main() {
  const { INFURA_URL, PRIVATE_KEY } = process.env;

  if (!INFURA_URL || !PRIVATE_KEY) {
    console.error("ERROR: Missing INFURA_URL or PRIVATE_KEY in .env");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(INFURA_URL);
  const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);

  const balance  = await provider.getBalance(wallet.address);
  const network  = await provider.getNetwork();
  const feeData  = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? ethers.parseUnits("2", "gwei");

  // 100 trials: MedConsent ~310k gas/trial + Naive ~230k gas/trial
  const totalGas = BigInt(310000 + 230000) * BigInt(100);
  const estCost  = gasPrice * totalGas;

  console.log("=================================================");
  console.log("  MedConsentChain — Balance & Cost Check");
  console.log("=================================================");
  console.log("Network  :", network.name, `(chainId ${network.chainId})`);
  console.log("Wallet   :", wallet.address);
  console.log("Balance  :", ethers.formatEther(balance), "ETH");
  console.log("-------------------------------------------------");
  console.log("Gas price:", ethers.formatUnits(gasPrice, "gwei"), "gwei");
  console.log("Est. cost for 100 trials:", ethers.formatEther(estCost), "ETH");
  console.log("-------------------------------------------------");

  if (balance < estCost) {
    const needed = ethers.formatEther(estCost - balance);
    console.log(`\nWARNING: Need ~${needed} more ETH.`);
    console.log("Get free Sepolia ETH at:");
    console.log("  https://sepoliafaucet.com");
    console.log("  https://faucet.quicknode.com/ethereum/sepolia");
    console.log("  https://www.alchemy.com/faucets/ethereum-sepolia");
  } else {
    console.log("\nBalance OK. Ready to run trials.");
    console.log("Run: node scripts/runTrials100.js");
  }
}

main().catch(e => {
  console.error("Error:", e.message);
  process.exit(1);
});