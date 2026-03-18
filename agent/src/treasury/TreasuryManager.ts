import { config } from '../config.js'
import { treasuryLogger as log } from '../agent/logger.js'
import { VaultState } from '../agent/types.js'
import { ValorWallet } from '../wallet/ValorWallet.js'

export type TreasuryHealth = 'HEALTHY' | 'LOW' | 'CRITICAL' | 'PAUSED'

export interface TreasuryStatus {
  health:               TreasuryHealth
  balanceUsdt:          string
  budgetRemainingUsdt:  string
  epochSecondsLeft:     number
  shouldTip:            boolean
  reason:               string
}

const USDT_DEC = 1_000_000n

/**
 * TreasuryManager provides the agent with a health assessment of the vault
 * before each tip decision. It implements a conservative policy:
 *
 *   HEALTHY  → tip normally
 *   LOW      → tip at 50% of normal amount (scale-back mode)
 *   CRITICAL → no tips until refunded
 *   PAUSED   → contract is paused, no tips possible
 *
 * Thresholds (in USDT):
 *   balance > 200 USDT → HEALTHY
 *   balance > 100 USDT → LOW
 *   balance ≤ 100 USDT → CRITICAL
 */
export class TreasuryManager {
  private readonly HEALTHY_THRESHOLD  = 200n * USDT_DEC
  private readonly LOW_THRESHOLD      = 100n * USDT_DEC

  async getStatus(wallet: ValorWallet): Promise<TreasuryStatus> {
    const state = await wallet.getVaultState()
    return this._assess(state)
  }

  /**
   * Adjust a proposed tip amount based on treasury health.
   * Returns 0n if tipping should be skipped entirely.
   */
  adjustTipAmount(proposed: bigint, health: TreasuryHealth): bigint {
    switch (health) {
      case 'HEALTHY':  return proposed
      case 'LOW':      return proposed / 2n  // scale back 50%
      case 'CRITICAL': return 0n             // no tips
      case 'PAUSED':   return 0n             // no tips
    }
  }

  private _assess(state: VaultState): TreasuryStatus {
    const { balance, budgetRemaining, epochSecondsRemaining, isPaused } = state

    const balanceUsdt         = this._fmt(balance)
    const budgetRemainingUsdt = this._fmt(budgetRemaining)
    const epochSecondsLeft    = Number(epochSecondsRemaining)

    if (isPaused) {
      log.warn('TipVault is paused — skipping all tips this loop')
      return {
        health: 'PAUSED',
        balanceUsdt,
        budgetRemainingUsdt,
        epochSecondsLeft,
        shouldTip: false,
        reason: 'Vault is paused',
      }
    }

    if (budgetRemaining === 0n) {
      log.info('Epoch budget exhausted — no tips until epoch rolls')
      return {
        health: 'HEALTHY',
        balanceUsdt,
        budgetRemainingUsdt,
        epochSecondsLeft,
        shouldTip: false,
        reason: `Epoch budget exhausted. Resets in ${epochSecondsLeft}s`,
      }
    }

    if (balance <= this.LOW_THRESHOLD) {
      log.warn({ balanceUsdt }, 'Treasury CRITICAL — suspending tips')
      return {
        health: 'CRITICAL',
        balanceUsdt,
        budgetRemainingUsdt,
        epochSecondsLeft,
        shouldTip: false,
        reason: `Balance ${balanceUsdt} USDT is critically low. Please refund vault.`,
      }
    }

    if (balance <= this.HEALTHY_THRESHOLD) {
      log.warn({ balanceUsdt }, 'Treasury LOW — scaling back tip amounts 50%')
      return {
        health: 'LOW',
        balanceUsdt,
        budgetRemainingUsdt,
        epochSecondsLeft,
        shouldTip: true,
        reason: `Balance ${balanceUsdt} USDT is low. Tips scaled to 50%.`,
      }
    }

    log.debug({ balanceUsdt, budgetRemainingUsdt }, 'Treasury HEALTHY')
    return {
      health: 'HEALTHY',
      balanceUsdt,
      budgetRemainingUsdt,
      epochSecondsLeft,
      shouldTip: true,
      reason: 'ok',
    }
  }

  private _fmt(baseUnits: bigint): string {
    return (Number(baseUnits) / 1e6).toFixed(2)
  }
}
