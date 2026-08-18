# Playwright-image (jammy) in plaats van node:22-alpine: de browser-worker
# (features 41-45) draait headless Chromium — die werkt niet op alpine.
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

RUN corepack enable

WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile

# Fase 3 draait hier meerdere workers (BullMQ); vandaag alleen de uptime-poller.
CMD ["pnpm", "--filter", "worker", "uptime:start"]
