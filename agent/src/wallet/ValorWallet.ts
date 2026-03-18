import WDK from '@tetherto/wdk'
import WalletManagerEvm from '@tetherto/wdk-wallet-evm'
import { ethers } from 'ethers'
import { config } from '../config.js'
import { walletLogger as log } from '../agent/logger.js'

// ABI fragments — only what the agent needs
const TIP_VAULT_ABI = [
  'function executeTip(address recipient, uint256 amount, bytes32 reasoningHash, uint256 contributionScore) external',
  'function executeBatchTips(address[] calldata recipients, uint256[] calldata amounts, bytes32[] calldata reasoningHashes, uint256[] calldata contributionScores) external',
  'function getVaultState() external view returns (uint256 balance, uint256 budgetRemaining, uint256 epochSecondsRemaining, uint256 totalDistributed, uint256 tipCount, bool isPaused)',
  'function canTip(address recipient, uint256 amount) external view returns (bool ok, string memory reason)',
  'function epochBudgetRemaining() external view returns (uint256)',
  'function treasuryBalance() external view returns (uint256)',
  'event TipExecuted(uint256 indexed tipId, address indexed recipient, uint256 amount, bytes32 reasoningHash, uint256 contributionScore, uint256 timestamp)',
]

const REGISTRY_ABI = [
  'function getPendingSignals(uint256 maxCount) external view returns (tuple(uint256 signalId, address contributor, uint8 signalType, uint256 weight, bytes32 dataHash, address source, uint256 timestamp, bool processed)[])',
  'function markProcessed(uint256[] calldata signalIds) external',
  'function signalCount() external view returns (uint256)',
]

export interface AgentWalletInfo {
  address: string
  chainId: number
}

/**
 * ValorWallet wraps WDK to give the agent:
 *   1. A self-custodial EVM wallet derived from the seed phrase
 *   2. Read/write access to TipVault
 *   3. Read/write access to ContributionRegistry
 */
export class ValorWallet {
  private wdk!: InstanceType<typeof WDK>
  private provider!: ethers.JsonRpcProvider
  private signer!: ethers.HDNodeWallet
  private vaultContract!: ethers.Contract
  private registryContract!: ethers.Contract
  private _address!: string
  private _initialized = false

  async init(): Promise<AgentWalletInfo> {
    if (this._initialized) return { address: this._address, chainId: config.chainId }

    log.info('Initializing WDK agent wallet...')

    // WDK initialization — self-custodial, stateless
    this.wdk = new WDK(config.seedPhrase)
      .registerWallet('ethereum', WalletManagerEvm, {
        provider: config.rpcUrl,
      })

    // Get the agent's EVM account (account index 0)
    const account  = await this.wdk.getAccount('ethereum', 0)
    this._address  = await account.getAddress()

    log.info({ address: this._address }, 'WDK wallet initialized')

    // Standard ethers provider + signer for contract interactions
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl)

    // Derive the private key from WDK for ethers signing
    // WDK uses BIP-44 derivation: m/44'/60'/0'/0/0 for Ethereum
    const hdNode  = ethers.HDNodeWallet.fromPhrase(config.seedPhrase)
    this.signer   = hdNode.connect(this.provider) as ethers.HDNodeWallet

    log.debug({ signerAddress: this.signer.address }, 'Ethers signer ready')

    // Instantiate contract interfaces
    this.vaultContract    = new ethers.Contract(config.vaultAddress,    TIP_VAULT_ABI, this.signer)
    this.registryContract = new ethers.Contract(config.registryAddress, REGISTRY_ABI,  this.signer)

    this._initialized = true

    return { address: this._address, chainId: config.chainId }
  }

  get address(): string {
    this._assertInitialized()
    return this._address
  }

  // ─── TipVault reads ──────────────────────────────────────────────────────

  async getVaultState() {
    this._assertInitialized()
    const [balance, budgetRemaining, epochSecondsRemaining, totalDistributed, tipCount, isPaused] =
      await this.vaultContract.getVaultState()
    return { balance, budgetRemaining, epochSecondsRemaining, totalDistributed, tipCount, isPaused }
  }

  async canTip(recipient: string, amount: bigint): Promise<{ ok: boolean; reason: string }> {
    this._assertInitialized()
    const [ok, reason] = await this.vaultContract.canTip(recipient, amount)
    return { ok, reason }
  }

  // ─── TipVault writes ─────────────────────────────────────────────────────

  async executeTip(
    recipient:         string,
    amount:            bigint,
    reasoningHash:     string,
    contributionScore: bigint
  ): Promise<{ txHash: string; tipId: bigint }> {
    this._assertInitialized()

    log.debug({ recipient, amount: amount.toString(), contributionScore: contributionScore.toString() }, 'Sending tip...')

    const tx = await this.vaultContract.executeTip(
      recipient,
      amount,
      reasoningHash,
      contributionScore
    )
    const receipt = await tx.wait(1)

    // Parse TipExecuted event to get tipId
    const iface = new ethers.Interface(TIP_VAULT_ABI)
    let tipId = 0n
    for (const log_ of receipt.logs) {
      try {
        const parsed = iface.parseLog(log_)
        if (parsed?.name === 'TipExecuted') {
          tipId = parsed.args.tipId
          break
        }
      } catch { /* skip non-matching logs */ }
    }

    log.info({ txHash: receipt.hash, tipId: tipId.toString(), recipient, amountUsdt: (Number(amount) / 1e6).toFixed(2) }, 'Tip executed ✓')

    return { txHash: receipt.hash, tipId }
  }

  async executeBatchTips(
    recipients:         string[],
    amounts:            bigint[],
    reasoningHashes:    string[],
    contributionScores: bigint[]
  ): Promise<{ txHash: string }> {
    this._assertInitialized()

    log.debug({ count: recipients.length }, 'Sending batch tips...')

    const tx      = await this.vaultContract.executeBatchTips(recipients, amounts, reasoningHashes, contributionScores)
    const receipt = await tx.wait(1)

    log.info({ txHash: receipt.hash, count: recipients.length }, 'Batch tips executed ✓')
    return { txHash: receipt.hash }
  }

  // ─── Registry reads ──────────────────────────────────────────────────────

  async getPendingSignals(maxCount: number) {
    this._assertInitialized()
    return this.registryContract.getPendingSignals(BigInt(maxCount))
  }

  // ─── Registry writes ─────────────────────────────────────────────────────

  async markSignalsProcessed(signalIds: bigint[]): Promise<void> {
    this._assertInitialized()
    if (signalIds.length === 0) return

    const tx      = await this.registryContract.markProcessed(signalIds)
    await tx.wait(1)

    log.debug({ count: signalIds.length }, 'Signals marked processed')
  }

  // ─── Utilities ───────────────────────────────────────────────────────────

  async getETHBalance(): Promise<string> {
    this._assertInitialized()
    const bal = await this.provider.getBalance(this._address)
    return ethers.formatEther(bal)
  }

  private _assertInitialized() {
    if (!this._initialized) throw new Error('ValorWallet not initialized — call init() first')
  }
}
