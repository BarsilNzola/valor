import { ValorWallet } from '../wallet/ValorWallet'
import { ScoringEngine } from '../scoring/ScoringEngine'
import { TreasuryManager } from '../treasury/TreasuryManager'
import { config } from '../config.js'
import { agentLogger as log } from './logger.js'
import {
  ContributionSignal,
  LoopResult,
  TipResult,
  VaultState,
} from './types.js'

/**
 * ValorAgent — the autonomous agent loop.
 *
 * Every epoch it:
 *   1. Reads pending contribution signals from ContributionRegistry
 *   2. Checks treasury health via TreasuryManager
 *   3. Scores each contributor via ScoringEngine
 *   4. Executes tips via TipVault through the WDK wallet
 *   5. Marks signals as processed on-chain
 *   6. Logs full reasoning for each decision
 *
 * The agent never requires human input between loops.
 * All decisions are deterministic given the on-chain state.
 */
export class ValorAgent {
  private wallet:   ValorWallet
  private scoring:  ScoringEngine
  private treasury: TreasuryManager
  private running   = false
  private loopTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    this.wallet   = new ValorWallet()
    this.scoring  = new ScoringEngine()
    this.treasury = new TreasuryManager()
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running) {
      log.warn('Agent already running')
      return
    }

    log.info('Starting VALOR agent...')

    const walletInfo = await this.wallet.init()
    log.info({
      address: walletInfo.address,
      chainId: walletInfo.chainId,
      network: config.network,
      vault:   config.vaultAddress,
    }, '━━━ VALOR Agent Started ━━━')

    this.running = true
    await this._runLoop()
  }

  stop(): void {
    log.info('Stopping VALOR agent...')
    this.running = false
    if (this.loopTimer) {
      clearTimeout(this.loopTimer)
      this.loopTimer = null
    }
  }

  // ─── Main Loop ────────────────────────────────────────────────────────────

  /**
   * Execute one full scoring + tipping iteration.
   * This is the heart of the autonomous agent.
   */
  async runOnce(): Promise<LoopResult> {
    const epochTimestamp = Math.floor(Date.now() / 1000)

    log.info({ epoch: new Date(epochTimestamp * 1000).toISOString() }, '── Agent loop start ──')

    const result: LoopResult = {
      epochTimestamp,
      signalsProcessed:   0,
      contributorsScored: 0,
      tipsAttempted:      0,
      tipsSucceeded:      0,
      tipsFailed:         0,
      totalAmountSent:    0n,
      vaultState: {
        balance: 0n, budgetRemaining: 0n,
        epochSecondsRemaining: 0n, totalDistributed: 0n,
        tipCount: 0n, isPaused: false,
      },
      errors: [],
    }

    try {
      // ── Step 1: Vault health check ────────────────────────────────────────
      const vaultState     = await this.wallet.getVaultState()
      result.vaultState    = vaultState
      const treasuryStatus = await this.treasury.getStatus(this.wallet)

      log.info({
        balance:    treasuryStatus.balanceUsdt,
        budget:     treasuryStatus.budgetRemainingUsdt,
        health:     treasuryStatus.health,
        epochLeft:  `${treasuryStatus.epochSecondsLeft}s`,
      }, 'Vault state')

      if (!treasuryStatus.shouldTip) {
        log.info({ reason: treasuryStatus.reason }, 'Skipping tips this loop')
        return result
      }

      // ── Step 2: Fetch pending signals ─────────────────────────────────────
      const rawSignals = await this.wallet.getPendingSignals(config.maxSignalsPerLoop)
      const signals: ContributionSignal[] = this._mapSignals(rawSignals)

      log.info({ count: signals.length }, 'Fetched pending signals')

      if (signals.length === 0) {
        log.info('No pending signals — loop complete')
        return result
      }

      result.signalsProcessed = signals.length

      // ── Step 3: Score contributors ────────────────────────────────────────
      const scored = this.scoring.scoreSignals(signals, vaultState)
      result.contributorsScored = scored.length

      log.info({ eligible: scored.length }, 'Contributors eligible for tips')

      if (scored.length === 0) {
        await this._markAllProcessed(signals)
        return result
      }

      // ── Step 4: Execute tips ──────────────────────────────────────────────
      const processedSignalIds: bigint[] = []

      for (const contributor of scored) {
        // Apply treasury health adjustment
        const adjustedAmount = this.treasury.adjustTipAmount(
          contributor.tipAmount,
          treasuryStatus.health
        )

        if (adjustedAmount === 0n) {
          log.debug({ address: contributor.address }, 'Tip amount zeroed by treasury policy — skipping')
          continue
        }

        // Pre-flight canTip check
        const { ok, reason } = await this.wallet.canTip(contributor.address, adjustedAmount)
        if (!ok) {
          log.warn({ address: contributor.address, reason }, 'canTip returned false — skipping')
          result.errors.push(`${contributor.address}: ${reason}`)
          continue
        }

        result.tipsAttempted++

        const tipResult = await this._executeTipSafely(
          contributor.address,
          adjustedAmount,
          contributor.finalScore,
          contributor.decisionLog
        )

        if (tipResult.success) {
          result.tipsSucceeded++
          result.totalAmountSent += adjustedAmount
          // Mark this contributor's signals as processed
          contributor.signals.forEach(s => processedSignalIds.push(s.signalId))
        } else {
          result.tipsFailed++
          result.errors.push(`${contributor.address}: ${tipResult.error}`)
        }
      }

      // ── Step 5: Mark all signals processed ───────────────────────────────
      // Mark both tipped and non-tipped (below threshold) signals as processed
      const allSignalIds = signals.map(s => s.signalId)
      await this._markAllProcessed(signals, processedSignalIds)

      log.info({
        tipsSucceeded:  result.tipsSucceeded,
        tipsFailed:     result.tipsFailed,
        totalSentUsdt:  (Number(result.totalAmountSent) / 1e6).toFixed(2),
        errors:         result.errors.length,
      }, '── Agent loop complete ──')

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error({ err: msg }, 'Unhandled error in agent loop')
      result.errors.push(msg)
    }

    return result
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  private async _runLoop(): Promise<void> {
    if (!this.running) return

    await this.runOnce()

    if (this.running) {
      log.debug({ nextRunMs: config.epochPollInterval }, `Next loop in ${config.epochPollInterval / 1000}s`)
      this.loopTimer = setTimeout(() => this._runLoop(), config.epochPollInterval)
    }
  }

  private async _executeTipSafely(
    recipient:    string,
    amount:       bigint,
    score:        number,
    decisionLog:  object
  ): Promise<TipResult> {
    try {
      const reasoningHash = ScoringEngine.computeReasoningHash(decisionLog as any)

      log.info({
        recipient,
        amountUsdt: (Number(amount) / 1e6).toFixed(2),
        score,
        reasoningHash,
      }, 'Executing tip...')

      const { txHash, tipId } = await this.wallet.executeTip(
        recipient,
        amount,
        reasoningHash,
        BigInt(score)
      )

      return {
        success:       true,
        txHash,
        tipId,
        recipient,
        amount,
        reasoningHash,
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      log.error({ recipient, error }, 'Tip execution failed')
      return {
        success: false,
        recipient,
        amount,
        reasoningHash: '',
        error,
      }
    }
  }

  private async _markAllProcessed(
    signals:          ContributionSignal[],
    alreadyMarked:    bigint[] = []
  ): Promise<void> {
    const alreadySet   = new Set(alreadyMarked.map(id => id.toString()))
    const toMark       = signals
      .map(s => s.signalId)
      .filter(id => !alreadySet.has(id.toString()))

    const allToMark = [...alreadyMarked, ...toMark]
    if (allToMark.length === 0) return

    try {
      await this.wallet.markSignalsProcessed(allToMark)
    } catch (err) {
      log.error({ err }, 'Failed to mark signals processed — they will be re-processed next loop')
    }
  }

  /** Map raw ethers tuple array from contract call to typed ContributionSignal[] */
  private _mapSignals(raw: any[]): ContributionSignal[] {
    if (!Array.isArray(raw)) return []
    return raw.map(r => ({
      signalId:    BigInt(r.signalId),
      contributor: r.contributor as string,
      signalType:  Number(r.signalType),
      weight:      BigInt(r.weight),
      dataHash:    r.dataHash as string,
      source:      r.source as string,
      timestamp:   BigInt(r.timestamp),
      processed:   r.processed as boolean,
    }))
  }
}