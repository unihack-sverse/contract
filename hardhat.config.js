require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");
require("solidity-coverage");

const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
const fujiAccounts = privateKey ? [privateKey] : [];

module.exports = {
  solidity: {
    version: "0.8.30",
    settings: {
      evmVersion: "cancun",
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    fuji: {
      url:
        process.env.FUJI_RPC_URL ||
        "https://api.avax-test.network/ext/bc/C/rpc",
      chainId: 43113,
      accounts: fujiAccounts,
    },
  },
  etherscan: {
    apiKey: {
      fuji: "snowtrace",
    },
    customChains: [
      {
        network: "fuji",
        chainId: 43113,
        urls: {
          apiURL: "https://api-testnet.snowtrace.io/api",
          browserURL: "https://subnets-test.avax.network/c-chain",
        },
      },
    ],
  },
};
