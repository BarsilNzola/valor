import { HardhatUserConfig } from 'hardhat/config'
import '@nomicfoundation/hardhat-toolbox'
import * as dotenv from 'dotenv'

dotenv.config()

const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || '0x' + '0'.repeat(64)
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || ''
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || ''
const ARBISCAN_API_KEY = process.env.ARBISCAN_API_KEY || ''

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      url: 'http://127.0.0.1:8545',
      chainId: 31337,
    },
    sepolia: {
      url: `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
      accounts: [PRIVATE_KEY],
      chainId: 11155111,
    },
    arbitrumSepolia: {
      url: `https://arb-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
      accounts: [PRIVATE_KEY],
      chainId: 421614,
    },
    mainnet: {
      url: `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
      accounts: [PRIVATE_KEY],
      chainId: 1,
    },
  },
  etherscan: {
    apiKey: {
      sepolia: ETHERSCAN_API_KEY,
      arbitrumSepolia: ARBISCAN_API_KEY,
      mainnet: ETHERSCAN_API_KEY,
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === 'true',
    currency: 'USD',
  },
  typechain: {
    outDir: 'typechain-types',
    target: 'ethers-v6',
  },
  paths: {
    sources: './src',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
}

export default config