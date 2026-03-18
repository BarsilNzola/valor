import 'dotenv/config'
import { ValorAgent } from './agent/ValorAgent'
import { logger } from './agent/logger'

// ─── Graceful shutdown ────────────────────────────────────────────────────────
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

// ─── Boot ─────────────────────────────────────────────────────────────────────
logger.info('━━━ VALOR — Autonomous Value Allocation & Reward Oracle ━━━')
logger.info('Hackathon Galáctica: WDK Edition 1 | Tipping Bot Track')
logger.info('')

agent = new ValorAgent()
agent.start().catch(err => {
  logger.error({ err }, 'Agent failed to start')
  process.exit(1)
})