import pino from 'pino'
import { config } from '../config.js'

export const logger = pino({
  level: config.logLevel,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize:        true,
      translateTime:   'SYS:HH:MM:ss',
      ignore:          'pid,hostname',
      messageFormat:   '[VALOR] {msg}',
    },
  },
})

export const agentLogger    = logger.child({ module: 'agent' })
export const walletLogger   = logger.child({ module: 'wallet' })
export const scoringLogger  = logger.child({ module: 'scoring' })
export const treasuryLogger = logger.child({ module: 'treasury' })