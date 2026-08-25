const hre = require("hardhat");
const ethers = hre.ethers;

async function main() {
  const [wallet] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(wallet.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");
  
  const block = await ethers.provider.getBlockNumber();
  console.log("Current block:", block);
  
  const network = await ethers.provider.getNetwork();
  console.log("Network:", network.name, "chainId:", network.chainId.toString());
}

main().catch(console.error);