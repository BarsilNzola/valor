import 'dotenv/config'
import http from 'http'
import { ValorAgent } from './agent/ValorAgent.js'
import { logger } from './agent/logger.js'

// ─── Graceful shutdown ──
let agent: ValorAgent | null = null

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutdown signal received')
  agent?.stop()
  process.exit(0)
}

process.on('SIGINT',  () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection')
})

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception — shutting down')
  agent?.stop()
  process.exit(1)
})

// ─── Health server (required for Render web service) ─────────────────────────
// Render needs an HTTP server listening on PORT to keep the service alive.
// This minimal server also exposes agent status for monitoring.
const PORT = parseInt(process.env.PORT ?? '3000', 10)

let agentStartTime = Date.now()
let loopCount = 0

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      status:    'ok',
      agent:     'VALOR',
      network:   process.env.NETWORK ?? 'sepolia',
      vault:     process.env.VAULT_ADDRESS,
      uptime:    Math.floor((Date.now() - agentStartTime) / 1000),
      loopCount,
      timestamp: new Date().toISOString(),
    }))
  } else {
    res.writeHead(404)
    res.end('Not found')
  }
})

server.listen(PORT, () => {
  logger.info({ port: PORT }, 'Health server listening')
})

// ─── Boot ──
logger.info('━━━ VALOR — Autonomous Value Allocation & Reward Oracle ━━━')
logger.info('Hackathon Galáctica: WDK Edition 1 | Tipping Bot Track')
logger.info('')

agent = new ValorAgent()
agent.start().catch(err => {
  logger.error({ err }, 'Agent failed to start')
  process.exit(1)
})