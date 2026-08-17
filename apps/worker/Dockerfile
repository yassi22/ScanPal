FROM node:22-alpine

RUN corepack enable

WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile

# Fase 3 draait hier meerdere workers (BullMQ); vandaag alleen de uptime-poller.
CMD ["pnpm", "--filter", "worker", "uptime:start"]
