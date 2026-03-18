import { describe, it, expect, beforeEach } from 'vitest'
import { ScoringEngine } from '../src/scoring/ScoringEngine.js'
import { SignalType, ContributionSignal, VaultState } from '../src/agent/types.js'

const USDT = (n: number) => BigInt(Math.round(n * 1_000_000))

const mockVault = (balance = 1000, budget = 100): VaultState => ({
  balance:               USDT(balance),
  budgetRemaining:       USDT(budget),
  epochSecondsRemaining: 3600n,
  totalDistributed:      0n,
  tipCount:              0n,
  isPaused:              false,
})

const makeSignal = (
  id:         number,
  contributor: string,
  type:       SignalType,
  weight:     number,
  ageSeconds  = 0
): ContributionSignal => ({
  signalId:    BigInt(id),
  contributor,
  signalType:  type,
  weight:      BigInt(weight),
  dataHash:    '0x' + id.toString(16).padStart(64, '0'),
  source:      '0x0000000000000000000000000000000000000001',
  timestamp:   BigInt(Math.floor(Date.now() / 1000) - ageSeconds),
  processed:   false,
})

describe('ScoringEngine', () => {
  let engine: ScoringEngine

  beforeEach(() => {
    engine = new ScoringEngine()
  })

  it('returns empty array for zero signals', () => {
    expect(engine.scoreSignals([], mockVault())).toEqual([])
  })

  it('scores a single high-weight governance signal', () => {
    const signals = [
      makeSignal(1, '0xAlice', SignalType.GOVERNANCE_VOTE, 10000),
      makeSignal(2, '0xAlice', SignalType.ONCHAIN_TRANSACTION, 10000),
      makeSignal(3, '0xAlice', SignalType.LIQUIDITY_PROVISION, 10000),
    ]
    const results = engine.scoreSignals(signals, mockVault())
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].finalScore).toBeGreaterThan(0)
    expect(results[0].address).toBe('0xalice')
  })

  it('contributor with more signals scores higher than one with fewer', () => {
    const alice = [
      makeSignal(1, '0xAlice', SignalType.GOVERNANCE_VOTE,      8000),
      makeSignal(2, '0xAlice', SignalType.ONCHAIN_TRANSACTION,  7000),
      makeSignal(3, '0xAlice', SignalType.LIQUIDITY_PROVISION,  9000),
    ]
    const bob = [
      makeSignal(4, '0xBob', SignalType.CUSTOM, 3000),
    ]
    const results = engine.scoreSignals([...alice, ...bob], mockVault())
    const aliceResult = results.find(r => r.address === '0xalice')
    const bobResult   = results.find(r => r.address === '0xbob')

    expect(aliceResult?.finalScore).toBeGreaterThan(bobResult?.finalScore ?? 0)
  })

  it('applies recency decay for old signals', () => {
    const freshSignals = [
      makeSignal(1, '0xFresh', SignalType.GOVERNANCE_VOTE, 10000, 0),
      makeSignal(2, '0xFresh', SignalType.ONCHAIN_TRANSACTION, 10000, 0),
      makeSignal(3, '0xFresh', SignalType.LIQUIDITY_PROVISION, 10000, 0),
    ]
    const staleSignals = [
      makeSignal(4, '0xStale', SignalType.GOVERNANCE_VOTE, 10000, 8 * 24 * 3600),
      makeSignal(5, '0xStale', SignalType.ONCHAIN_TRANSACTION, 10000, 8 * 24 * 3600),
      makeSignal(6, '0xStale', SignalType.LIQUIDITY_PROVISION, 10000, 8 * 24 * 3600),
    ]
    const freshResult = engine.scoreSignals(freshSignals, mockVault())
    const staleResult = engine.scoreSignals(staleSignals, mockVault())
    const freshScore = freshResult[0]?.finalScore ?? 0
    const staleScore = staleResult[0]?.finalScore ?? 0
    expect(freshScore).toBeGreaterThan(staleScore)
  })

  it('returns no tip for score below threshold', () => {
    const signals = [makeSignal(1, '0xLow', SignalType.CUSTOM, 100)]
    const results = engine.scoreSignals(signals, mockVault())
    // Either filtered out or has tipAmount = 0
    const hasResult = results.find(r => r.address === '0xlow')
    if (hasResult) {
      expect(hasResult.tipAmount).toBe(0n)
    }
  })

  it('caps tip amount when epoch budget is low', () => {
    const signals = [makeSignal(1, '0xAlice', SignalType.GOVERNANCE_VOTE, 10000)]
    // Only 5 USDT budget remaining — 20% = 1 USDT cap
    const results = engine.scoreSignals(signals, mockVault(1000, 5))
    const alice = results.find(r => r.address === '0xalice')
    if (alice && alice.tipAmount > 0n) {
      // Should be ≤ 20% of 5 USDT = 1 USDT
      expect(alice.tipAmount).toBeLessThanOrEqual(USDT(1))
    }
  })

  it('applies diminishing returns for repeated signal types', () => {
    const oneSignal = [
      makeSignal(1, '0xAlice', SignalType.GOVERNANCE_VOTE, 10000),
      makeSignal(2, '0xAlice', SignalType.ONCHAIN_TRANSACTION, 10000),
    ]
    const manySignals = Array.from({ length: 10 }, (_, i) =>
      makeSignal(i + 1, '0xBob', SignalType.GOVERNANCE_VOTE, 10000)
    )
    const single = engine.scoreSignals(oneSignal, mockVault())
    const many   = engine.scoreSignals(manySignals, mockVault())
    const singleScore = single[0]?.finalScore ?? 0
    const manyScore   = many[0]?.finalScore ?? 0
    // 10 identical signals should not be 10x a 2-signal contributor
    expect(manyScore).toBeLessThan(singleScore * 10)
  })

  it('buildDecisionLog has all required fields', () => {
    const signals = [
      makeSignal(1, '0xAlice', SignalType.GOVERNANCE_VOTE, 10000),
      makeSignal(2, '0xAlice', SignalType.ONCHAIN_TRANSACTION, 10000),
      makeSignal(3, '0xAlice', SignalType.LIQUIDITY_PROVISION, 10000),
    ]
    const results = engine.scoreSignals(signals, mockVault())
    expect(results.length).toBeGreaterThan(0)
    const log = results[0].decisionLog
    expect(log).toHaveProperty('agentVersion')
    expect(log).toHaveProperty('timestamp')
    expect(log).toHaveProperty('contributor')
    expect(log).toHaveProperty('finalScore')
    expect(log).toHaveProperty('signals')
    expect(log).toHaveProperty('vaultStateAtDecision')
    expect(log.vaultStateAtDecision).toHaveProperty('balance')
    expect(log.vaultStateAtDecision).toHaveProperty('budgetRemaining')
  })

  it('computeReasoningHash produces consistent bytes32', () => {
    const log = {
      agentVersion: '1.0.0',
      timestamp: 1700000000,
      contributor: '0xAlice',
      finalScore: 7500,
      signalCount: 1,
      signals: [],
      tipAmount: '5.00',
      tipAmountRaw: '5000000',
      vaultStateAtDecision: { balance: '1000.00', budgetRemaining: '100.00', epochSecondsLeft: '3600' },
      reasoning: 'test',
    }

    const hash1 = ScoringEngine.computeReasoningHash(log)
    const hash2 = ScoringEngine.computeReasoningHash(log)

    expect(hash1).toBe(hash2)
    expect(hash1).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('sorts contributors by score descending', () => {
    const signals = [
      makeSignal(1, '0xLow',  SignalType.CUSTOM,           3000),
      makeSignal(2, '0xHigh', SignalType.GOVERNANCE_VOTE, 10000),
      makeSignal(3, '0xMid',  SignalType.ONCHAIN_TRANSACTION, 6000),
    ]
    const results = engine.scoreSignals(signals, mockVault())
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].finalScore).toBeGreaterThanOrEqual(results[i].finalScore)
    }
  })
})