import { ethers } from 'ethers'
import { config } from '../config.js'
import { scoringLogger as log } from '../agent/logger.js'
import {
  SignalType,
  SignalTypeLabel,
  ContributionSignal,
  ScoredContributor,
  DecisionLog,
  VaultState,
} from '../agent/types.js'

const USDT_DECIMALS = 6
const MAX_SCORE     = 10_000  // basis points

/**
 * ScoringEngine:
 *   1. Groups raw signals by contributor
 *   2. Calculates a weighted composite score (0–10000)
 *   3. Maps score → tip amount using treasury-aware dynamic sizing
 *   4. Produces a DecisionLog (JSON) whose keccak256 is stored on-chain
 *
 * Scoring formula:
 *   - Each signal contributes: signalWeight × typeMultiplier
 *   - Type multiplier comes from config.weights (basis points)
 *   - Recency decay: signals older than 7 days get 50% weight
 *   - Deduplication: same contributor × signalType has diminishing returns (log scale)
 *   - Final score is normalized to 0–10000
 */
export class ScoringEngine {
  private readonly RECENCY_WINDOW_SECONDS = 7 * 24 * 3600   // 7 days
  private readonly RECENCY_DECAY          = 0.5              // 50% for old signals
  private readonly AGENT_VERSION          = '1.0.0'

  /**
   * Score a batch of signals and return ranked, tip-ready contributors.
   */
  scoreSignals(
    signals: ContributionSignal[],
    vaultState: VaultState
  ): ScoredContributor[] {
    if (signals.length === 0) return []

    log.debug({ signalCount: signals.length }, 'Scoring signals...')

    // Group by contributor
    const byContributor = this._groupByContributor(signals)

    const now = Math.floor(Date.now() / 1000)

    const scored: ScoredContributor[] = []

    for (const [address, contributorSignals] of byContributor) {
      const result = this._scoreContributor(address, contributorSignals, now, vaultState)
      scored.push(result)
    }

    // Sort descending by score
    scored.sort((a, b) => b.finalScore - a.finalScore)

    const eligible = scored.filter(s => s.finalScore >= config.minScoreThreshold && s.tipAmount > 0n)

    log.info({
      total:    scored.length,
      eligible: eligible.length,
      top:      eligible[0]
        ? { address: eligible[0].address, score: eligible[0].finalScore, tipUsdt: this._formatUsdt(eligible[0].tipAmount) }
        : null
    }, 'Scoring complete')

    return eligible
  }

  // ─── Private: Scoring Logic ───────────────────────────────────────────────

  private _scoreContributor(
    address:   string,
    signals:   ContributionSignal[],
    nowSecs:   number,
    vault:     VaultState
  ): ScoredContributor {
    const breakdown: Record<SignalType, number> = {
      [SignalType.ONCHAIN_TRANSACTION]:  0,
      [SignalType.GOVERNANCE_VOTE]:      0,
      [SignalType.LIQUIDITY_PROVISION]:  0,
      [SignalType.CONTRACT_DEPLOYMENT]:  0,
      [SignalType.PROTOCOL_INTERACTION]: 0,
      [SignalType.CUSTOM]:               0,
    }

    let rawWeightSum = 0
    const typeCount: Record<number, number> = {}

    for (const signal of signals) {
      const typeMultiplier = this._getTypeMultiplier(signal.signalType)
      const recencyFactor  = this._getRecencyFactor(Number(signal.timestamp), nowSecs)

      // Diminishing returns for repeated signals of same type (log scale)
      typeCount[signal.signalType] = (typeCount[signal.signalType] ?? 0) + 1
      const diminishingFactor = 1 / Math.log2(typeCount[signal.signalType] + 1)

      const contribution = (Number(signal.weight) / MAX_SCORE)
        * (typeMultiplier / MAX_SCORE)
        * recencyFactor
        * diminishingFactor
        * MAX_SCORE

      breakdown[signal.signalType] += contribution
      rawWeightSum += Number(signal.weight)
    }

    // Sum all type contributions
    const rawScore = Object.values(breakdown).reduce((a, b) => a + b, 0)

    // Normalize to 0–10000
    const finalScore = Math.min(MAX_SCORE, Math.round(rawScore))

    // Treasury-aware tip sizing
    const tipAmount = this._calculateTipAmount(finalScore, vault)

    const decisionLog = this._buildDecisionLog(address, finalScore, signals, tipAmount, vault)

    return {
      address,
      finalScore,
      signals,
      rawWeightSum,
      signalTypeBreakdown: breakdown,
      tipAmount,
      decisionLog,
    }
  }

  /**
   * Map a score to a USD₮ tip amount, bounded by vault state.
   *
   * Tiers:
   *   9000–10000 → 10 USDT (max single tip)
   *   7000–8999  → 7 USDT
   *   5000–6999  → 5 USDT (minScoreThreshold default)
   *   below 5000 → 0 (no tip)
   *
   * Then capped by:
   *   - maxTipAmount (from vault, but we use on-chain canTip to verify)
   *   - 20% of remaining epoch budget (agent is conservative)
   *   - If treasury is under 2× minReserve, scale down by 50%
   */
  private _calculateTipAmount(score: number, vault: VaultState): bigint {
    if (score < config.minScoreThreshold) return 0n

    // Base tier
    let baseUsdt: number
    if      (score >= 9000) baseUsdt = 10
    else if (score >= 7000) baseUsdt = 7
    else if (score >= 5000) baseUsdt = 5
    else                    return 0n

    // Dynamic budget cap: don't spend more than 20% of remaining epoch budget per tip
    const budgetCap   = Number(vault.budgetRemaining) * 0.20
    const capped      = Math.min(baseUsdt * 1_000_000, budgetCap)

    // If capped is zero or negative, skip
    if (capped < 1_000_000) return 0n  // < 1 USDT after capping

    return BigInt(Math.floor(capped))
  }

  private _getTypeMultiplier(signalType: SignalType): number {
    const w = config.weights
    switch (signalType) {
      case SignalType.ONCHAIN_TRANSACTION:  return w.ONCHAIN_TRANSACTION
      case SignalType.GOVERNANCE_VOTE:      return w.GOVERNANCE_VOTE
      case SignalType.LIQUIDITY_PROVISION:  return w.LIQUIDITY_PROVISION
      case SignalType.CONTRACT_DEPLOYMENT:  return w.CONTRACT_DEPLOYMENT
      case SignalType.PROTOCOL_INTERACTION: return w.PROTOCOL_INTERACTION
      case SignalType.CUSTOM:               return w.CUSTOM
      default: return 0
    }
  }

  private _getRecencyFactor(signalTimeSecs: number, nowSecs: number): number {
    const age = nowSecs - signalTimeSecs
    if (age < 0)                              return 1.0  // future-dated (clock skew): treat as fresh
    if (age <= this.RECENCY_WINDOW_SECONDS)   return 1.0  // within 7 days: full weight
    return this.RECENCY_DECAY                             // older: 50% weight
  }

  private _buildDecisionLog(
    address:   string,
    score:     number,
    signals:   ContributionSignal[],
    tipAmount: bigint,
    vault:     VaultState
  ): DecisionLog {
    const tipUsdt = this._formatUsdt(tipAmount)

    return {
      agentVersion: this.AGENT_VERSION,
      timestamp:    Math.floor(Date.now() / 1000),
      contributor:  address,
      finalScore:   score,
      signalCount:  signals.length,
      signals: signals.map(s => ({
        signalId:   s.signalId.toString(),
        signalType: SignalTypeLabel[s.signalType],
        weight:     Number(s.weight),
        dataHash:   s.dataHash,
      })),
      tipAmount:    tipUsdt,
      tipAmountRaw: tipAmount.toString(),
      vaultStateAtDecision: {
        balance:          this._formatUsdt(vault.balance),
        budgetRemaining:  this._formatUsdt(vault.budgetRemaining),
        epochSecondsLeft: vault.epochSecondsRemaining.toString(),
      },
      reasoning: this._buildReasoning(address, score, signals, tipUsdt, vault),
    }
  }

  private _buildReasoning(
    address:   string,
    score:     number,
    signals:   ContributionSignal[],
    tipUsdt:   string,
    vault:     VaultState
  ): string {
    const types = [...new Set(signals.map(s => SignalTypeLabel[s.signalType]))].join(', ')
    return (
      `Contributor ${address} achieved a score of ${score}/10000 ` +
      `based on ${signals.length} signal(s) across: ${types}. ` +
      `Vault balance: ${this._formatUsdt(vault.balance)} USDT, ` +
      `epoch budget remaining: ${this._formatUsdt(vault.budgetRemaining)} USDT. ` +
      `Tip issued: ${tipUsdt} USDT.`
    )
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  private _groupByContributor(signals: ContributionSignal[]): Map<string, ContributionSignal[]> {
    const map = new Map<string, ContributionSignal[]>()
    for (const signal of signals) {
      const addr = signal.contributor.toLowerCase()
      if (!map.has(addr)) map.set(addr, [])
      map.get(addr)!.push(signal)
    }
    return map
  }

  private _formatUsdt(baseUnits: bigint): string {
    return (Number(baseUnits) / 10 ** USDT_DECIMALS).toFixed(2)
  }

  /**
   * Compute the reasoning hash to store on-chain.
   * keccak256 of the canonical JSON string of the DecisionLog.
   */
  static computeReasoningHash(log: DecisionLog): string {
    const canonical = JSON.stringify(log, Object.keys(log).sort())
    return ethers.keccak256(ethers.toUtf8Bytes(canonical))
  }
}