// ─── Signal Types (mirrors ContributionRegistry.sol enum) ───────────────────
export enum SignalType {
  ONCHAIN_TRANSACTION   = 0,
  GOVERNANCE_VOTE       = 1,
  LIQUIDITY_PROVISION   = 2,
  CONTRACT_DEPLOYMENT   = 3,
  PROTOCOL_INTERACTION  = 4,
  CUSTOM                = 5,
}

export const SignalTypeLabel: Record<SignalType, string> = {
  [SignalType.ONCHAIN_TRANSACTION]:  'On-chain Transaction',
  [SignalType.GOVERNANCE_VOTE]:      'Governance Vote',
  [SignalType.LIQUIDITY_PROVISION]:  'Liquidity Provision',
  [SignalType.CONTRACT_DEPLOYMENT]:  'Contract Deployment',
  [SignalType.PROTOCOL_INTERACTION]: 'Protocol Interaction',
  [SignalType.CUSTOM]:               'Custom Signal',
}

// ─── Raw signal from ContributionRegistry ────────────────────────────────────
export interface ContributionSignal {
  signalId:    bigint
  contributor: string    // checksummed address
  signalType:  SignalType
  weight:      bigint    // 0–10000 (raw from contract)
  dataHash:    string    // bytes32 hex
  source:      string    // who registered it
  timestamp:   bigint
  processed:   boolean
}

// ─── Scored contributor produced by the scoring engine ───────────────────────
export interface ScoredContributor {
  address:          string
  finalScore:       number   // 0–10000 after all weighting
  signals:          ContributionSignal[]
  rawWeightSum:     number
  signalTypeBreakdown: Record<SignalType, number>
  tipAmount:        bigint   // USDT base units (6 dec) — 0 if below threshold
  decisionLog:      DecisionLog
}

// ─── Off-chain reasoning log anchored on-chain via keccak256 ─────────────────
export interface DecisionLog {
  agentVersion:     string
  timestamp:        number   // unix seconds
  contributor:      string
  finalScore:       number
  signalCount:      number
  signals:          Array<{
    signalId:   string
    signalType: string
    weight:     number
    dataHash:   string
  }>
  tipAmount:        string   // USDT formatted (e.g. "5.00")
  tipAmountRaw:     string   // base units string
  vaultStateAtDecision: {
    balance:          string
    budgetRemaining:  string
    epochSecondsLeft: string
  }
  reasoning:        string   // human-readable summary for transparency dashboard
}

// ─── Vault state snapshot ─────────────────────────────────────────────────────
export interface VaultState {
  balance:               bigint
  budgetRemaining:       bigint
  epochSecondsRemaining: bigint
  totalDistributed:      bigint
  tipCount:              bigint
  isPaused:              boolean
}

// ─── Tip execution result ─────────────────────────────────────────────────────
export interface TipResult {
  success:       boolean
  txHash?:       string
  tipId?:        bigint
  recipient:     string
  amount:        bigint
  reasoningHash: string
  error?:        string
}

// ─── Agent loop result (one full iteration) ───────────────────────────────────
export interface LoopResult {
  epochTimestamp:     number
  signalsProcessed:   number
  contributorsScored: number
  tipsAttempted:      number
  tipsSucceeded:      number
  tipsFailed:         number
  totalAmountSent:    bigint
  vaultState:         VaultState
  errors:             string[]
}