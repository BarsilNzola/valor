FROM node:20-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY agent/package.json ./agent/
COPY contracts/package.json ./contracts/
COPY dashboard/package.json ./dashboard/

RUN npm install

COPY agent/ ./agent/
COPY dashboard/ ./dashboard/

# Build args passed at build time from Render env vars
ARG VITE_VAULT_ADDRESS
ARG VITE_RPC_URL
ENV VITE_VAULT_ADDRESS=$VITE_VAULT_ADDRESS
ENV VITE_RPC_URL=$VITE_RPC_URL

RUN npm run build --workspace=dashboard

FROM node:20-slim AS production

WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/agent ./agent
COPY --from=builder /app/dashboard ./dashboard

ENV NODE_ENV=production

EXPOSE 3000

CMD ["npm", "run", "start"]