import { useState } from 'react'
import { useVaultData } from './hooks/useVaultData.js'

// ─── Config — override with your deployed addresses ───────────────────────────
const RPC_URL      = import.meta.env.VITE_RPC_URL      ?? 'https://eth-sepolia.g.alchemy.com/v2/demo'
const VAULT_ADDR   = import.meta.env.VITE_VAULT_ADDRESS ?? '0x'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtUsdt(base: bigint): string {
  return (Number(base) / 1e6).toFixed(2)
}
function fmtAddr(addr: string): string {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '—'
}
function fmtDate(ts: bigint): string {
  return new Date(Number(ts) * 1000).toLocaleString()
}
function fmtScore(score: bigint): string {
  return `${(Number(score) / 100).toFixed(0)}%`
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: {
  label: string; value: string; sub?: string; accent?: string
}) {
  return (
    <div style={{ background: 'var(--color-background-secondary)', borderRadius: 12, padding: '20px 24px', border: '1px solid var(--color-border-tertiary)' }}>
      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 500, color: accent ?? 'var(--color-text-primary)', lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function HealthBadge({ isPaused, health }: { isPaused: boolean; health: string }) {
  const color = isPaused ? '#e24b4a' : health === 'HEALTHY' ? '#639922' : health === 'LOW' ? '#ba7517' : '#e24b4a'
  const label = isPaused ? 'PAUSED' : health
  return (
    <span style={{
      background: color + '22', color, border: `1px solid ${color}66`,
      borderRadius: 6, padding: '2px 10px', fontSize: 12, fontWeight: 500,
    }}>
      {label}
    </span>
  )
}

function EpochBar({ remaining, total }: { remaining: bigint; total: bigint }) {
  const pct = total === 0n ? 0 : Math.round(100 - Number(remaining) * 100 / Number(total))
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
        <span>Epoch budget used</span>
        <span>{pct}%</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--color-border-tertiary)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: pct > 80 ? '#e24b4a' : '#1d9e75', borderRadius: 3, transition: 'width 0.5s' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
        <span>{fmtUsdt(total - remaining)} USDT spent</span>
        <span>{fmtUsdt(remaining)} USDT remaining</span>
      </div>
    </div>
  )
}

function TipRow({ tip }: { tip: ReturnType<typeof useVaultData>['tipRecords'][0] }) {
  const [expanded, setExpanded] = useState(false)
  const score = Number(tip.contributionScore)
  const scoreColor = score >= 9000 ? '#639922' : score >= 7000 ? '#1d9e75' : score >= 5000 ? '#ba7517' : '#888'

  return (
    <div style={{ borderBottom: '1px solid var(--color-border-tertiary)' }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'grid',
          gridTemplateColumns: '60px 1fr 100px 80px 80px',
          gap: 12,
          padding: '12px 16px',
          cursor: 'pointer',
          alignItems: 'center',
          fontSize: 13,
        }}
      >
        <span style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>#{tip.tipId.toString()}</span>
        <span style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>{fmtAddr(tip.recipient)}</span>
        <span style={{ color: '#1d9e75', fontWeight: 500 }}>{fmtUsdt(tip.amount)} USDT</span>
        <span style={{ color: scoreColor, fontWeight: 500 }}>{fmtScore(tip.contributionScore)}</span>
        <span style={{ color: 'var(--color-text-tertiary)', fontSize: 11 }}>{fmtDate(tip.timestamp)}</span>
      </div>
      {expanded && (
        <div style={{ padding: '0 16px 12px', background: 'var(--color-background-tertiary)' }}>
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Reasoning hash (on-chain proof)</div>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 11,
            color: 'var(--color-text-primary)',
            wordBreak: 'break-all',
            padding: '8px 10px',
            background: 'var(--color-background-secondary)',
            borderRadius: 6,
          }}>
            {tip.reasoningHash}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 6 }}>
            Epoch #{tip.epochNumber.toString()} · Full recipient: {tip.recipient}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const { vaultState, vaultConfig, tipRecords, loading, error, refresh, lastUpdated } =
    useVaultData(RPC_URL, VAULT_ADDR)

  const treasuryHealth = (() => {
    if (!vaultState) return 'UNKNOWN'
    if (vaultState.isPaused) return 'PAUSED'
    const bal = Number(vaultState.balance) / 1e6
    if (bal <= 100) return 'CRITICAL'
    if (bal <= 200) return 'LOW'
    return 'HEALTHY'
  })()

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px', fontFamily: 'var(--font-sans)', color: 'var(--color-text-primary)' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ fontSize: 22, fontWeight: 500, margin: 0 }}>VALOR</h1>
            {vaultState && <HealthBadge isPaused={vaultState.isPaused} health={treasuryHealth} />}
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Autonomous Value Allocation & Reward Oracle
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <button
            onClick={refresh}
            style={{
              background: 'var(--color-background-secondary)',
              border: '1px solid var(--color-border-secondary)',
              borderRadius: 8,
              padding: '6px 14px',
              fontSize: 13,
              cursor: 'pointer',
              color: 'var(--color-text-primary)',
            }}
          >
            Refresh
          </button>
          {lastUpdated && (
            <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
              Updated {lastUpdated.toLocaleTimeString()}
            </div>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: 'var(--color-background-danger)', border: '1px solid var(--color-border-danger)', borderRadius: 8, padding: '12px 16px', marginBottom: 24, fontSize: 13, color: 'var(--color-text-danger)' }}>
          {error}
        </div>
      )}

      {loading && !vaultState ? (
        <div style={{ textAlign: 'center', padding: 64, color: 'var(--color-text-secondary)' }}>
          Loading vault data...
        </div>
      ) : vaultState ? (
        <>
          {/* Stats grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
            <StatCard
              label="Treasury Balance"
              value={`${fmtUsdt(vaultState.balance)} USDT`}
              sub="Available for tips"
              accent={Number(vaultState.balance) / 1e6 < 100 ? '#e24b4a' : undefined}
            />
            <StatCard
              label="Total Distributed"
              value={`${fmtUsdt(vaultState.totalDistributed)} USDT`}
              sub={`${vaultState.tipCount.toString()} tips sent`}
              accent="#1d9e75"
            />
            <StatCard
              label="Epoch Budget Left"
              value={`${fmtUsdt(vaultState.budgetRemaining)} USDT`}
              sub={`${Math.floor(Number(vaultState.epochSecondsRemaining) / 60)} min remaining`}
            />
            <StatCard
              label="Epoch Resets In"
              value={`${Math.floor(Number(vaultState.epochSecondsRemaining) / 3600)}h ${Math.floor((Number(vaultState.epochSecondsRemaining) % 3600) / 60)}m`}
              sub={vaultConfig ? `Budget: ${fmtUsdt(vaultConfig.epochBudget)} USDT/epoch` : ''}
            />
          </div>

          {/* Budget bar */}
          {vaultConfig && (
            <div style={{ background: 'var(--color-background-secondary)', borderRadius: 12, padding: '16px 20px', marginBottom: 24, border: '1px solid var(--color-border-tertiary)' }}>
              <EpochBar remaining={vaultState.budgetRemaining} total={vaultConfig.epochBudget} />
            </div>
          )}

          {/* Agent info */}
          {vaultConfig && (
            <div style={{ background: 'var(--color-background-secondary)', borderRadius: 12, padding: '14px 20px', marginBottom: 24, border: '1px solid var(--color-border-tertiary)', display: 'flex', gap: 32, flexWrap: 'wrap', fontSize: 13 }}>
              <div>
                <span style={{ color: 'var(--color-text-secondary)' }}>Agent wallet: </span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-primary)' }}>{fmtAddr(vaultConfig.agentWallet)}</span>
              </div>
              <div>
                <span style={{ color: 'var(--color-text-secondary)' }}>Max tip: </span>
                <span style={{ fontWeight: 500 }}>{fmtUsdt(vaultConfig.maxTipAmount)} USDT</span>
              </div>
              <div>
                <span style={{ color: 'var(--color-text-secondary)' }}>Vault: </span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-primary)' }}>{fmtAddr(VAULT_ADDR)}</span>
              </div>
            </div>
          )}

          {/* Tip history */}
          <div style={{ background: 'var(--color-background-secondary)', borderRadius: 12, border: '1px solid var(--color-border-tertiary)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border-tertiary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 500, fontSize: 14 }}>Recent Tips</span>
              <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>Click to view reasoning hash</span>
            </div>
            {/* Column headers */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '60px 1fr 100px 80px 80px',
              gap: 12,
              padding: '8px 16px',
              fontSize: 11,
              color: 'var(--color-text-tertiary)',
              background: 'var(--color-background-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>
              <span>Tip ID</span>
              <span>Recipient</span>
              <span>Amount</span>
              <span>Score</span>
              <span>Time</span>
            </div>
            {tipRecords.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-tertiary)', fontSize: 13 }}>
                No tips sent yet
              </div>
            ) : (
              tipRecords.map(tip => <TipRow key={tip.tipId.toString()} tip={tip} />)
            )}
          </div>
        </>
      ) : (
        <div style={{ textAlign: 'center', padding: 64, color: 'var(--color-text-secondary)', fontSize: 13 }}>
          Set VITE_VAULT_ADDRESS and VITE_RPC_URL to connect to the vault.
        </div>
      )}
    </div>
  )
}
