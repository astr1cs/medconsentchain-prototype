const { ethers } = require("hardhat");

async function main() {
  console.log("Deploying contracts to Sepolia...");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH");

  try {
    console.log("Deploying MedConsent...");
    const MedConsent = await ethers.getContractFactory("MedConsent");
    const medConsent = await MedConsent.deploy();
    console.log("Waiting for MedConsent deployment...");
    await medConsent.waitForDeployment();
    const medConsentAddress = await medConsent.getAddress();
    console.log("MedConsent deployed to:", medConsentAddress);

    console.log("Deploying NaiveBaseline...");
    const NaiveBaseline = await ethers.getContractFactory("NaiveBaseline");
    const naiveBaseline = await NaiveBaseline.deploy();
    console.log("Waiting for NaiveBaseline deployment...");
    await naiveBaseline.waitForDeployment();
    const naiveBaselineAddress = await naiveBaseline.getAddress();
    console.log("NaiveBaseline deployed to:", naiveBaselineAddress);

    console.log("\n--- SAVE THESE ADDRESSES ---");
    console.log("MEDCONSENT_ADDRESS=" + medConsentAddress);
    console.log("NAIVEBASELINE_ADDRESS=" + naiveBaselineAddress);
  } catch (err) {
    console.error("Deployment error:", err.message);
    console.error(err);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});