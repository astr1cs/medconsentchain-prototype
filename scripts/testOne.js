const hre = require("hardhat");
const ethers = hre.ethers;

const MEDCONSENT_ADDRESS = "0xCa90Ec6366181f791f95873E849FB4561bee6fB4";

async function main() {
  const [patient] = await ethers.getSigners();
  console.log("Wallet:", patient.address);

  const medConsent = await ethers.getContractAt("MedConsent", MEDCONSENT_ADDRESS);
  console.log("Contract connected.");

  const contentHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
  console.log("Sending addRecord transaction...");

  const tx = await medConsent.addRecord("testrecord1", contentHash, "ipfs://QmTest", "wrappedkey", {
    gasLimit: 300000,
  });

  console.log("Transaction hash:", tx.hash);
  console.log("Waiting for confirmation...");

  const receipt = await tx.wait(1);
  console.log("Confirmed! Gas used:", receipt.gasUsed.toString());
  console.log("Block number:", receipt.blockNumber);
}

main().catch((e) => {
  console.error("Error:", e.message);
});