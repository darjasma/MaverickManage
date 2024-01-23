require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config()
/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 100
      },
      viaIR: true
    }
  },
  networks:{
    hardhat: {
      forking: {
        // port: 8080,
        url: process.env.FORKING_URL,
        timeout: 600000
      },
    },
    // timeout: '100000000',
    goerli:{
      url:process.env.GOERLI_RPC_URL,
      accounts: [process.env.GOERLI_PRIVATE_KEY]
    },
    mainnet:{
      url: process.env.ETH_RPC_URL,
      accounts: [process.env.MAIN_NET_PRIVATE_KEY]
    },
    localhost: {
      url: "http://127.0.0.1:8080",
      timeout: 600000
    },
  },

  etherscan:{
    apiKey:{
      goerli: process.env.ETHER_SCAN_API_KEY
    }
  },

  mocha: {
    timeout: 200000
  }
}