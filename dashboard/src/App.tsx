import { useState, useEffect } from 'react'
import { useVaultData } from './hooks/useVaultData.js'

const RPC_URL    = import.meta.env.VITE_RPC_URL    ?? ''
const VAULT_ADDR = import.meta.env.VITE_VAULT_ADDRESS ?? '0x'

function fmtUsdt(base: bigint) { return (Number(base) / 1e6).toFixed(2) }
function fmtAddr(a: string) { return a ? `${a.slice(0,6)}…${a.slice(-4)}` : '—' }
function fmtDate(ts: bigint) {
  return new Date(Number(ts) * 1000).toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
}
function timeAgo(ts: bigint) {
  const sec = Math.floor(Date.now()/1000) - Number(ts)
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec/60)}m ago`
  if (sec < 86400) return `${Math.floor(sec/3600)}h ago`
  return `${Math.floor(sec/86400)}d ago`
}

function AnimatedNumber({ value }: { value: string }) {
  const [display, setDisplay] = useState('0.00')
  useEffect(() => {
    const target = parseFloat(value)
    const start  = parseFloat(display) || 0
    const diff   = target - start
    const steps  = 40
    let i = 0
    const t = setInterval(() => {
      i++
      const eased = 1 - Math.pow(1 - i/steps, 3)
      setDisplay((start + diff * eased).toFixed(2))
      if (i >= steps) { setDisplay(value); clearInterval(t) }
    }, 16)
    return () => clearInterval(t)
  }, [value])
  return <>{display}</>
}

function PulsingDot({ color = '#4ade80' }: { color?: string }) {
  return (
    <span style={{ position:'relative', display:'inline-flex', width:8, height:8, flexShrink:0 }}>
      <span style={{ position:'absolute', inset:0, borderRadius:'50%', background:color, animation:'ping 1.5s ease infinite', opacity:0.5 }}/>
      <span style={{ position:'absolute', inset:0, borderRadius:'50%', background:color }}/>
    </span>
  )
}

function ScoreBar({ score }: { score: bigint }) {
  const pct = Number(score) / 100
  const color = pct >= 90 ? '#e8ff6b' : pct >= 70 ? '#4ade80' : pct >= 50 ? '#60a5fa' : '#666'
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
      <div style={{ flex:1, height:2, background:'#1c1c1c', borderRadius:1, overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${pct}%`, background:color, transition:'width 0.8s ease', boxShadow:`0 0 6px ${color}88` }}/>
      </div>
      <span style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color, minWidth:24, textAlign:'right' }}>{Math.round(pct)}</span>
    </div>
  )
}

function TipRow({ tip, index }: { tip: ReturnType<typeof useVaultData>['tipRecords'][0]; index: number }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ borderBottom:'1px solid #141414', animation:`fadeUp 0.4s ease both`, animationDelay:`${index*0.035}s` }}>
      <div
        onClick={() => setOpen(!open)}
        style={{ display:'grid', gridTemplateColumns:'48px 1fr 120px 140px 70px', gap:12, padding:'13px 24px', cursor:'pointer', alignItems:'center', transition:'background 0.1s' }}
        onMouseEnter={e => (e.currentTarget.style.background='#0c0c0c')}
        onMouseLeave={e => (e.currentTarget.style.background='transparent')}
      >
        <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:'#3a3a3a' }}>#{String(tip.tipId).padStart(3,'0')}</span>
        <span style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color:'#aaa' }}>{fmtAddr(tip.recipient)}</span>
        <span style={{ fontFamily:"'DM Mono',monospace", fontSize:13, color:'#e8ff6b', fontWeight:500 }}>+{fmtUsdt(tip.amount)}</span>
        <ScoreBar score={tip.contributionScore} />
        <span style={{ fontSize:10, color:'#444', textAlign:'right', fontFamily:"'DM Mono',monospace" }}>{timeAgo(tip.timestamp)}</span>
      </div>
      {open && (
        <div style={{ padding:'0 24px 16px', background:'#070707' }}>
          <div style={{ fontSize:9, color:'#444', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }}>On-chain reasoning proof</div>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:'#4ade80', wordBreak:'break-all', padding:'10px 14px', background:'#0d0d0d', borderRadius:6, border:'1px solid #1a1a1a', lineHeight:1.7 }}>
            {tip.reasoningHash}
          </div>
          <div style={{ display:'flex', gap:20, marginTop:8, fontSize:10, color:'#444', fontFamily:"'DM Mono',monospace" }}>
            <span>epoch #{String(tip.epochNumber)}</span>
            <span>{tip.recipient}</span>
            <span>{fmtDate(tip.timestamp)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default function App() {
  const { vaultState, vaultConfig, tipRecords, loading, error, refresh, lastUpdated } = useVaultData(RPC_URL, VAULT_ADDR)

  const health = !vaultState ? 'UNKNOWN'
    : vaultState.isPaused ? 'PAUSED'
    : Number(vaultState.balance)/1e6 <= 100 ? 'CRITICAL'
    : Number(vaultState.balance)/1e6 <= 200 ? 'LOW'
    : 'HEALTHY'

  const healthColor = { HEALTHY:'#4ade80', LOW:'#facc15', CRITICAL:'#f87171', PAUSED:'#f87171', UNKNOWN:'#555' }[health]

  const budgetPct = vaultConfig && vaultState
    ? Math.min(100, Math.round((1 - Number(vaultState.budgetRemaining)/Number(vaultConfig.epochBudget)) * 100))
    : 0

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@400;500;700;800&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        html,body{background:#050505;color:#ddd;font-family:'Syne',sans-serif;min-height:100vh;}
        ::-webkit-scrollbar{width:3px;}::-webkit-scrollbar-track{background:#0a0a0a;}::-webkit-scrollbar-thumb{background:#1e1e1e;}
        @keyframes ping{75%,100%{transform:scale(2.2);opacity:0;}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:none;}}
        @keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.3;}}
        @keyframes shimmer{0%{background-position:200% 0;}100%{background-position:-200% 0;}}
      `}</style>

      {/* Grid texture */}
      <div style={{ position:'fixed', inset:0, pointerEvents:'none', zIndex:0,
        backgroundImage:'linear-gradient(#ffffff04 1px,transparent 1px),linear-gradient(90deg,#ffffff04 1px,transparent 1px)',
        backgroundSize:'40px 40px' }}/>

      <div style={{ position:'relative', zIndex:1, maxWidth:1080, margin:'0 auto', padding:'44px 24px' }}>

        {/* Header */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:52, animation:'fadeUp 0.5s ease both' }}>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:10 }}>
              <h1 style={{ fontSize:48, fontWeight:800, letterSpacing:'-3px', color:'#fff', lineHeight:1 }}>VALOR</h1>
              <div style={{ display:'flex', alignItems:'center', gap:7, background:'#0d0d0d', border:`1px solid ${healthColor}44`, borderRadius:20, padding:'5px 14px' }}>
                <PulsingDot color={healthColor} />
                <span style={{ fontSize:10, letterSpacing:'0.14em', color:healthColor, textTransform:'uppercase', fontFamily:"'DM Mono',monospace" }}>{health}</span>
              </div>
            </div>
            <p style={{ fontSize:12, color:'#444', letterSpacing:'0.06em', textTransform:'uppercase' }}>
              Autonomous Value Allocation & Reward Oracle
            </p>
          </div>
          <div style={{ textAlign:'right' }}>
            <button onClick={refresh} style={{ background:'transparent', border:'1px solid #1e1e1e', borderRadius:8, padding:'8px 18px', fontSize:11, cursor:'pointer', color:'#666', letterSpacing:'0.08em', textTransform:'uppercase', transition:'all 0.15s' }}
              onMouseEnter={e=>{e.currentTarget.style.borderColor='#333';e.currentTarget.style.color='#aaa';}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor='#1e1e1e';e.currentTarget.style.color='#666';}}
            >Refresh</button>
            {lastUpdated && <div style={{ fontSize:10, color:'#2a2a2a', marginTop:5, fontFamily:"'DM Mono',monospace" }}>{lastUpdated.toLocaleTimeString()}</div>}
          </div>
        </div>

        {error && <div style={{ background:'#1a0808', border:'1px solid #f8717133', borderRadius:10, padding:'12px 18px', marginBottom:20, fontSize:12, color:'#f87171', fontFamily:"'DM Mono',monospace" }}>{error}</div>}

        {loading && !vaultState ? (
          <div style={{ textAlign:'center', padding:100, color:'#2a2a2a', animation:'pulse 2s infinite' }}>
            <div style={{ fontSize:11, letterSpacing:'0.2em', textTransform:'uppercase' }}>Connecting to vault...</div>
          </div>
        ) : vaultState ? (
          <>
            {/* 4 stat cards */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:1, marginBottom:1, borderRadius:14, overflow:'hidden' }}>
              {[
                { val: fmtUsdt(vaultState.balance), label:'Treasury', unit:'USDT', accent:'#e8ff6b' },
                { val: fmtUsdt(vaultState.totalDistributed), label:'Distributed', unit:'USDT', accent:'#4ade80' },
                { val: fmtUsdt(vaultState.budgetRemaining), label:'Budget Left', unit:'USDT', accent:'#60a5fa' },
                { val: vaultState.tipCount.toString(), label:'Tips Sent', unit:'total', accent:'#c084fc' },
              ].map((s,i) => (
                <div key={i} style={{ background:'#0a0a0a', padding:'28px 24px 24px', animation:`fadeUp 0.5s ease both`, animationDelay:`${i*0.07}s` }}>
                  <div style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'0.12em', color:'#3a3a3a', marginBottom:14 }}>{s.label}</div>
                  <div style={{ fontFamily:"'DM Mono',monospace", fontSize:34, fontWeight:500, color:s.accent, letterSpacing:'-1.5px', lineHeight:1 }}>
                    <AnimatedNumber value={s.val} />
                  </div>
                  <div style={{ fontSize:10, color:'#2e2e2e', marginTop:6, fontFamily:"'DM Mono',monospace", textTransform:'uppercase' }}>{s.unit}</div>
                </div>
              ))}
            </div>

            {/* Epoch bar */}
            {vaultConfig && (
              <div style={{ background:'#0a0a0a', padding:'18px 24px', marginTop:1, marginBottom:1, animation:`fadeUp 0.5s ease both`, animationDelay:'0.3s' }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10 }}>
                  <span style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'0.1em', color:'#3a3a3a' }}>Epoch Budget</span>
                  <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color: budgetPct>80?'#f87171':'#e8ff6b' }}>{budgetPct}% consumed</span>
                </div>
                <div style={{ height:3, background:'#111', borderRadius:2, overflow:'hidden' }}>
                  <div style={{ height:'100%', width:`${budgetPct}%`, background: budgetPct>80?'#f87171':budgetPct>50?'#e8ff6b':'#4ade80', transition:'width 1.2s ease', boxShadow:`0 0 10px ${budgetPct>80?'#f8717155':'#4ade8055'}` }}/>
                </div>
                <div style={{ display:'flex', justifyContent:'space-between', marginTop:8, fontSize:10, color:'#333', fontFamily:"'DM Mono',monospace" }}>
                  <span>{fmtUsdt(vaultConfig.epochBudget - vaultState.budgetRemaining)} USDT spent</span>
                  <span>{Math.floor(Number(vaultState.epochSecondsRemaining)/3600)}h {Math.floor((Number(vaultState.epochSecondsRemaining)%3600)/60)}m until reset</span>
                  <span>{fmtUsdt(vaultState.budgetRemaining)} USDT remaining</span>
                </div>
              </div>
            )}

            {/* Agent meta bar */}
            {vaultConfig && (
              <div style={{ background:'#0a0a0a', padding:'12px 24px', marginBottom:16, borderRadius:'0 0 14px 14px', display:'flex', flexWrap:'wrap', gap:24, alignItems:'center', animation:`fadeUp 0.5s ease both`, animationDelay:'0.35s' }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <PulsingDot color="#4ade80"/>
                  <span style={{ fontSize:10, color:'#3a3a3a', textTransform:'uppercase', letterSpacing:'0.08em' }}>Agent</span>
                  <span style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:'#666' }}>{fmtAddr(vaultConfig.agentWallet)}</span>
                </div>
                <div style={{ fontSize:10, color:'#3a3a3a' }}>Max tip <span style={{ fontFamily:"'DM Mono',monospace", color:'#666' }}>{fmtUsdt(vaultConfig.maxTipAmount)} USDT</span></div>
                <div style={{ fontSize:10, color:'#3a3a3a' }}>Vault <span style={{ fontFamily:"'DM Mono',monospace", color:'#666' }}>{fmtAddr(VAULT_ADDR)}</span></div>
                <div style={{ fontSize:10, color:'#3a3a3a' }}>Network <span style={{ color:'#60a5fa' }}>Sepolia</span></div>
              </div>
            )}

            {/* Tip feed */}
            <div style={{ background:'#0a0a0a', border:'1px solid #141414', borderRadius:14, overflow:'hidden', animation:`fadeUp 0.5s ease both`, animationDelay:'0.4s' }}>
              <div style={{ padding:'16px 24px', borderBottom:'1px solid #141414', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <span style={{ fontSize:14, fontWeight:700, letterSpacing:'-0.5px' }}>Tip Feed</span>
                  {tipRecords.length > 0 && (
                    <span style={{ background:'#e8ff6b18', color:'#e8ff6b', border:'1px solid #e8ff6b30', borderRadius:10, padding:'1px 9px', fontSize:10, fontFamily:"'DM Mono',monospace" }}>
                      {tipRecords.length}
                    </span>
                  )}
                </div>
                <span style={{ fontSize:9, color:'#333', letterSpacing:'0.1em', textTransform:'uppercase' }}>Click row → view proof</span>
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'48px 1fr 120px 140px 70px', gap:12, padding:'7px 24px', fontSize:9, color:'#2a2a2a', textTransform:'uppercase', letterSpacing:'0.1em', borderBottom:'1px solid #111' }}>
                <span>ID</span><span>Recipient</span><span>Amount</span><span>Score</span><span style={{textAlign:'right'}}>When</span>
              </div>

              {tipRecords.length === 0 ? (
                <div style={{ textAlign:'center', padding:70, color:'#222' }}>
                  <div style={{ fontSize:28, marginBottom:14, animation:'pulse 2s infinite' }}>◎</div>
                  <div style={{ fontSize:11, letterSpacing:'0.12em', textTransform:'uppercase' }}>Awaiting contributions...</div>
                </div>
              ) : (
                tipRecords.map((tip,i) => <TipRow key={String(tip.tipId)} tip={tip} index={i} />)
              )}
            </div>
          </>
        ) : (
          <div style={{ textAlign:'center', padding:100, color:'#2a2a2a', fontSize:12, letterSpacing:'0.1em', textTransform:'uppercase' }}>
            Set VITE_VAULT_ADDRESS and VITE_RPC_URL in .env
          </div>
        )}
      </div>
    </>
  )
}