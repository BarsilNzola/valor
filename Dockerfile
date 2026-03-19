FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
COPY agent/package.json ./agent/
COPY contracts/package.json ./contracts/
COPY dashboard/package.json ./dashboard/

RUN npm install

COPY agent/ ./agent/
COPY dashboard/ ./dashboard/

RUN npm run build

FROM node:20-alpine AS production

WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/agent ./agent
COPY --from=builder /app/dashboard ./dashboard

ENV NODE_ENV=production

EXPOSE 3000

CMD ["npm", "run", "start"]