import 'dotenv/config'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { ValorAgent } from './agent/ValorAgent.js'
import { logger } from './agent/logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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

// ─── Static file server + health endpoint ────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? '3000', 10)
const DASHBOARD_DIST = path.resolve('/app/dashboard/dist')

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.json': 'application/json',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
  '.ttf':  'font/ttf',
}

const agentStartTime = Date.now()

const server = http.createServer((req, res) => {
  const url = req.url ?? '/'

  // Health endpoint
  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      status:    'ok',
      agent:     'VALOR',
      network:   process.env.NETWORK ?? 'sepolia',
      vault:     process.env.VAULT_ADDRESS,
      uptime:    Math.floor((Date.now() - agentStartTime) / 1000),
      timestamp: new Date().toISOString(),
    }))
    return
  }

  // Serve static dashboard files
  let filePath = path.join(DASHBOARD_DIST, url === '/' ? 'index.html' : url)

  // SPA fallback — unknown routes serve index.html
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DASHBOARD_DIST, 'index.html')
  }

  const ext  = path.extname(filePath)
  const mime = MIME[ext] ?? 'application/octet-stream'

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404)
      res.end('Not found')
      return
    }
    res.writeHead(200, { 'Content-Type': mime })
    res.end(data)
  })
})

server.listen(PORT, '0.0.0.0', () => {
  logger.info({ port: PORT }, `Health + dashboard server listening`)
})

// ─── Boot agent ───────────────────────────────────────────────────────────────
logger.info('━━━ VALOR — Autonomous Value Allocation & Reward Oracle ━━━')
logger.info('Hackathon Galáctica: WDK Edition 1 | Tipping Bot Track')
logger.info('')

agent = new ValorAgent()
agent.start().catch(err => {
  logger.error({ err }, 'Agent failed to start')
  process.exit(1)
})