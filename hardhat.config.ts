import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: "0.8.19",
  networks: {
    sepolia: {
      url: "https://sepolia.infura.io/v3/11144921bfe6409592437c77ce8d7256",
      accounts: ["0xdacf2ab294ff9f668f436868c24d7812ea9b52bcce692e3db558359e8a6afcaa"],
    },
  },
};

export default config;