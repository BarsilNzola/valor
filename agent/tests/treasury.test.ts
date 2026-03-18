import { describe, it, expect } from 'vitest'
import { TreasuryManager } from '../src/treasury/TreasuryManager.js'
import { VaultState } from '../src/agent/types.js'

const USDT = (n: number) => BigInt(Math.round(n * 1_000_000))

const mockVault = (overrides: Partial<VaultState> = {}): VaultState => ({
  balance:               USDT(500),
  budgetRemaining:       USDT(100),
  epochSecondsRemaining: 3600n,
  totalDistributed:      USDT(0),
  tipCount:              0n,
  isPaused:              false,
  ...overrides,
})

// Minimal wallet mock for getStatus
const mockWallet = (state: VaultState) => ({
  getVaultState: async () => state,
}) as any

describe('TreasuryManager', () => {
  const manager = new TreasuryManager()

  it('returns HEALTHY for well-funded vault', async () => {
    const status = await manager.getStatus(mockWallet(mockVault({ balance: USDT(500) })))
    expect(status.health).toBe('HEALTHY')
    expect(status.shouldTip).toBe(true)
  })

  it('returns LOW for balance between 100-200 USDT', async () => {
    const status = await manager.getStatus(mockWallet(mockVault({ balance: USDT(150) })))
    expect(status.health).toBe('LOW')
    expect(status.shouldTip).toBe(true)
  })

  it('returns CRITICAL for balance ≤ 100 USDT', async () => {
    const status = await manager.getStatus(mockWallet(mockVault({ balance: USDT(50) })))
    expect(status.health).toBe('CRITICAL')
    expect(status.shouldTip).toBe(false)
  })

  it('returns PAUSED when vault is paused', async () => {
    const status = await manager.getStatus(mockWallet(mockVault({ isPaused: true })))
    expect(status.health).toBe('PAUSED')
    expect(status.shouldTip).toBe(false)
  })

  it('returns shouldTip=false when epoch budget is exhausted', async () => {
    const status = await manager.getStatus(mockWallet(mockVault({ budgetRemaining: 0n })))
    expect(status.shouldTip).toBe(false)
    expect(status.reason).toContain('Epoch budget exhausted')
  })

  describe('adjustTipAmount', () => {
    it('returns full amount when HEALTHY', () => {
      expect(manager.adjustTipAmount(USDT(10), 'HEALTHY')).toBe(USDT(10))
    })

    it('returns 50% when LOW', () => {
      expect(manager.adjustTipAmount(USDT(10), 'LOW')).toBe(USDT(5))
    })

    it('returns 0 when CRITICAL', () => {
      expect(manager.adjustTipAmount(USDT(10), 'CRITICAL')).toBe(0n)
    })

    it('returns 0 when PAUSED', () => {
      expect(manager.adjustTipAmount(USDT(10), 'PAUSED')).toBe(0n)
    })
  })
})