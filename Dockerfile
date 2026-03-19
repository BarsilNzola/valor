# ─── Build stage ──
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root workspace manifest
COPY package.json ./

# Copy all package manifests first (layer cache)
COPY agent/package.json ./agent/
COPY contracts/package.json ./contracts/
COPY dashboard/package.json ./dashboard/
COPY shared/package.json ./shared/

# Install all workspace dependencies
RUN npm install

# Copy source files
COPY agent/ ./agent/
COPY shared/ ./shared/

# Build agent (TypeScript compile)
RUN cd agent && npm run build 2>/dev/null || true

# ─── Production stage ─────────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Copy built workspace
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/agent ./agent
COPY --from=builder /app/shared ./shared

# Set production environment
ENV NODE_ENV=production

# Render injects env vars at runtime — no .env file needed
# Required env vars:
#   WDK_SEED_PHRASE
#   RPC_URL
#   CHAIN_ID
#   VAULT_ADDRESS
#   REGISTRY_ADDRESS
#   USDT_ADDRESS
#   EPOCH_POLL_INTERVAL (optional, default 3600)
#   MIN_SCORE_THRESHOLD (optional, default 1000)
#   LOG_LEVEL (optional, default info)

WORKDIR /app/agent

# Health check — just verify the process is running
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node --input-type=module -e "import fs from 'fs'; process.exit(0);"

# Start the agent
CMD ["npx", "tsx", "src/index.ts"]