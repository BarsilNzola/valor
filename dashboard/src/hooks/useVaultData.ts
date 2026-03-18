import { useState, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'

const TIP_VAULT_ABI = [
  'function getVaultState() external view returns (uint256 balance, uint256 budgetRemaining, uint256 epochSecondsRemaining, uint256 totalDistributed, uint256 tipCount, bool isPaused)',
  'function getTipRecords(uint256 offset, uint256 limit) external view returns (tuple(uint256 tipId, address recipient, uint256 amount, bytes32 reasoningHash, uint256 contributionScore, uint256 timestamp, uint256 epochNumber)[])',
  'function totalTipCount() external view returns (uint256)',
  'function maxTipAmount() external view returns (uint256)',
  'function epochBudget() external view returns (uint256)',
  'function epochDuration() external view returns (uint256)',
  'function epochBudgetRemaining() external view returns (uint256)',
  'function agentWallet() external view returns (address)',
]

export interface TipRecord {
  tipId:             bigint
  recipient:         string
  amount:            bigint
  reasoningHash:     string
  contributionScore: bigint
  timestamp:         bigint
  epochNumber:       bigint
}

export interface VaultState {
  balance:               bigint
  budgetRemaining:       bigint
  epochSecondsRemaining: bigint
  totalDistributed:      bigint
  tipCount:              bigint
  isPaused:              boolean
}

export interface VaultConfig {
  maxTipAmount:  bigint
  epochBudget:   bigint
  epochDuration: bigint
  agentWallet:   string
}

export interface UseVaultData {
  vaultState:   VaultState | null
  vaultConfig:  VaultConfig | null
  tipRecords:   TipRecord[]
  loading:      boolean
  error:        string | null
  refresh:      () => void
  lastUpdated:  Date | null
}

const POLL_INTERVAL_MS = 30_000  // refresh every 30 seconds

export function useVaultData(
  rpcUrl:       string,
  vaultAddress: string
): UseVaultData {
  const [vaultState,  setVaultState]  = useState<VaultState | null>(null)
  const [vaultConfig, setVaultConfig] = useState<VaultConfig | null>(null)
  const [tipRecords,  setTipRecords]  = useState<TipRecord[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const fetchData = useCallback(async () => {
    if (!rpcUrl || !vaultAddress || vaultAddress === '0x') {
      setLoading(false)
      return
    }

    try {
      setError(null)
      const provider = new ethers.JsonRpcProvider(rpcUrl)
      const vault    = new ethers.Contract(vaultAddress, TIP_VAULT_ABI, provider)

      // Parallel reads
      const [stateRaw, maxTip, budget, duration, agentWallet, tipCount] = await Promise.all([
        vault.getVaultState(),
        vault.maxTipAmount(),
        vault.epochBudget(),
        vault.epochDuration(),
        vault.agentWallet(),
        vault.totalTipCount(),
      ])

      setVaultState({
        balance:               stateRaw[0],
        budgetRemaining:       stateRaw[1],
        epochSecondsRemaining: stateRaw[2],
        totalDistributed:      stateRaw[3],
        tipCount:              stateRaw[4],
        isPaused:              stateRaw[5],
      })

      setVaultConfig({
        maxTipAmount:  maxTip,
        epochBudget:   budget,
        epochDuration: duration,
        agentWallet,
      })

      // Fetch last 50 tips
      const total = Number(tipCount)
      if (total > 0) {
        const offset = Math.max(0, total - 50)
        const limit  = Math.min(50, total)
        const records = await vault.getTipRecords(offset, limit)
        const mapped: TipRecord[] = [...records].reverse().map((r: any) => ({
          tipId:             BigInt(r.tipId),
          recipient:         r.recipient,
          amount:            BigInt(r.amount),
          reasoningHash:     r.reasoningHash,
          contributionScore: BigInt(r.contributionScore),
          timestamp:         BigInt(r.timestamp),
          epochNumber:       BigInt(r.epochNumber),
        }))
        setTipRecords(mapped)
      }

      setLastUpdated(new Date())
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [rpcUrl, vaultAddress])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [fetchData])

  return {
    vaultState,
    vaultConfig,
    tipRecords,
    loading,
    error,
    refresh: fetchData,
    lastUpdated,
  }
}
