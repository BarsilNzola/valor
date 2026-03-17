import { ethers } from 'hardhat'
import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'

dotenv.config()

// ─── Network USDT Addresses ───────────────────────────────────────────────────
const USDT_ADDRESSES: Record<string, string> = {
  mainnet:        '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  sepolia:        '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06', // Pimlico test USDT
  arbitrumSepolia: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
  localhost:      '', // Set after MockUSDT deploy
}

async function main() {
  const [deployer] = await ethers.getSigners()
  const network    = (await ethers.provider.getNetwork()).name
  const chainId    = Number((await ethers.provider.getNetwork()).chainId)

  console.log('\n━━━ VALOR Deployment ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`Network:    ${network} (chainId: ${chainId})`)
  console.log(`Deployer:   ${deployer.address}`)
  console.log(`Balance:    ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`)

  // ─── Agent wallet (from env or deployer for local testing) ─────────────────
  const agentWallet = process.env.AGENT_WALLET_ADDRESS || deployer.address
  const admin       = deployer.address

  console.log(`Agent:      ${agentWallet}`)
  console.log(`Admin:      ${admin}`)

  // ─── USDT token address ────────────────────────────────────────────────────
  let usdtAddress = USDT_ADDRESSES[network]

  if (!usdtAddress || network === 'localhost') {
    console.log('\nDeploying MockUSDT for local/testnet...')
    const MockUSDT = await ethers.getContractFactory('MockUSDT')
    const mockUsdt = await MockUSDT.deploy(deployer.address)
    await mockUsdt.waitForDeployment()
    usdtAddress = await mockUsdt.getAddress()
    console.log(`MockUSDT:   ${usdtAddress}`)
  }

  // ─── TipVault config ───────────────────────────────────────────────────────
  //
  //  USDT has 6 decimals. 1 USDT = 1_000_000 units.
  //
  //  Defaults (all tunable via updateLimits after deploy):
  //    maxTipAmount       = 10 USDT   (single tip ceiling)
  //    epochBudget        = 100 USDT  (daily spend ceiling)
  //    epochDuration      = 24 hours
  //    minTreasuryReserve = 50 USDT   (vault keeps this as buffer)
  //    recipientCooldown  = 1 hour    (same address can receive tip once/hour)
  //
  const USDT_DECIMALS   = 1_000_000n  // 10^6
  const maxTipAmount    = 10n  * USDT_DECIMALS
  const epochBudget     = 100n * USDT_DECIMALS
  const epochDuration   = 24n * 60n * 60n  // 86400 seconds
  const minReserve      = 50n  * USDT_DECIMALS
  const cooldown        = 1n   * 60n * 60n  // 3600 seconds

  // ─── Deploy TipVault ───────────────────────────────────────────────────────
  console.log('\nDeploying TipVault...')
  const TipVault = await ethers.getContractFactory('TipVault')
  const tipVault = await TipVault.deploy(
    usdtAddress,
    agentWallet,
    admin,
    maxTipAmount,
    epochBudget,
    epochDuration,
    minReserve,
    cooldown
  )
  await tipVault.waitForDeployment()
  const tipVaultAddress = await tipVault.getAddress()
  console.log(`TipVault:   ${tipVaultAddress}`)

  // ─── Deploy ContributionRegistry ──────────────────────────────────────────
  console.log('\nDeploying ContributionRegistry...')
  const ContributionRegistry = await ethers.getContractFactory('ContributionRegistry')
  const registry = await ContributionRegistry.deploy(admin)
  await registry.waitForDeployment()
  const registryAddress = await registry.getAddress()
  console.log(`Registry:   ${registryAddress}`)

  // ─── Grant agent SIGNAL_SOURCE_ROLE on registry ───────────────────────────
  const SIGNAL_SOURCE_ROLE = ethers.keccak256(ethers.toUtf8Bytes('SIGNAL_SOURCE_ROLE'))
  const tx = await registry.grantRole(SIGNAL_SOURCE_ROLE, agentWallet)
  await tx.wait()
  console.log(`\nGranted SIGNAL_SOURCE_ROLE to agent: ${agentWallet}`)

  // ─── Save deployment addresses ────────────────────────────────────────────
  const deployment = {
    network,
    chainId,
    timestamp:            new Date().toISOString(),
    deployer:             deployer.address,
    agentWallet,
    contracts: {
      TipVault:               tipVaultAddress,
      ContributionRegistry:   registryAddress,
      USDTToken:              usdtAddress,
    },
    config: {
      maxTipAmount:      maxTipAmount.toString(),
      epochBudget:       epochBudget.toString(),
      epochDuration:     epochDuration.toString(),
      minReserve:        minReserve.toString(),
      cooldown:          cooldown.toString(),
    }
  }

  const deploymentsDir = path.join(__dirname, '..', 'deployments')
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true })

  const outPath = path.join(deploymentsDir, `${network}.json`)
  fs.writeFileSync(outPath, JSON.stringify(deployment, null, 2))
  console.log(`\nDeployment saved to: ${outPath}`)

  // ─── Also write to shared/addresses.json for agent + dashboard ────────────
  const sharedDir = path.join(__dirname, '..', '..', 'shared')
  if (!fs.existsSync(sharedDir)) fs.mkdirSync(sharedDir, { recursive: true })
  fs.writeFileSync(
    path.join(sharedDir, 'addresses.json'),
    JSON.stringify(deployment.contracts, null, 2)
  )
  console.log('Contract addresses written to shared/addresses.json')

  console.log('\n━━━ Deployment Complete ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`\nNext steps:`)
  console.log(`  1. Fund TipVault with USDT: approve + deposit to ${tipVaultAddress}`)
  console.log(`  2. Set VAULT_ADDRESS=${tipVaultAddress} in agent/.env`)
  console.log(`  3. Set REGISTRY_ADDRESS=${registryAddress} in agent/.env`)
  console.log(`  4. Run: cd agent && npm run start`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
})