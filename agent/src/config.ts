import 'dotenv/config'

function required(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`[config] Missing required env var: ${key}`)
  return val
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback
}

function optionalInt(key: string, fallback: number): number {
  const val = process.env[key]
  if (!val) return fallback
  const n = parseInt(val, 10)
  if (isNaN(n)) throw new Error(`[config] ${key} must be an integer, got: ${val}`)
  return n
}

export const config = {
  // WDK
  seedPhrase: required('WDK_SEED_PHRASE'),

  // Network
  network:    optional('NETWORK', 'sepolia'),
  rpcUrl:     required('RPC_URL'),
  chainId:    optionalInt('CHAIN_ID', 11155111),

  // Contracts
  vaultAddress:    required('VAULT_ADDRESS'),
  registryAddress: required('REGISTRY_ADDRESS'),
  usdtAddress:     required('USDT_ADDRESS'),

  // Agent behaviour
  epochPollInterval:   optionalInt('EPOCH_POLL_INTERVAL', 3600) * 1000, // convert to ms
  maxSignalsPerLoop:   optionalInt('MAX_SIGNALS_PER_LOOP', 50),
  minScoreThreshold:   optionalInt('MIN_SCORE_THRESHOLD', 5000),

  logLevel: optional('LOG_LEVEL', 'info') as 'trace' | 'debug' | 'info' | 'warn' | 'error',

  // Scoring weights (basis points, should sum to 10000)
  weights: {
    ONCHAIN_TRANSACTION:  optionalInt('WEIGHT_ONCHAIN_TRANSACTION', 3000),
    GOVERNANCE_VOTE:      optionalInt('WEIGHT_GOVERNANCE_VOTE', 3500),
    LIQUIDITY_PROVISION:  optionalInt('WEIGHT_LIQUIDITY_PROVISION', 2000),
    CONTRACT_DEPLOYMENT:  optionalInt('WEIGHT_CONTRACT_DEPLOYMENT', 1000),
    PROTOCOL_INTERACTION: optionalInt('WEIGHT_PROTOCOL_INTERACTION', 500),
    CUSTOM:               optionalInt('WEIGHT_CUSTOM', 0),
  },
} as const

export type Config = typeof config
