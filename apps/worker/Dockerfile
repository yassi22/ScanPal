# Playwright-image (jammy) in plaats van node:22-alpine: de browser-worker
# (features 41-45) draait headless Chromium — die werkt niet op alpine.
# TODO: pin op digest i.p.v. tag voor reproduceerbaarheid (docker pull --quiet).
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

# corepack in deze image heeft verlopen signing-keys en probeert de laatste
# pnpm op te halen + te verifiëren → "Cannot find matching keyid". Daarom pnpm
# direct op de gepinde versie installeren (matcht `packageManager` in de root
# package.json) i.p.v. via corepack.
RUN npm install -g pnpm@10.27.0

WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile

# Draai niet als root: de worker navigeert Chromium naar willekeurige URLs;
# een non-root user beperkt de blast-radius bij een browser-exploit.
# pwuser (UID 1000) is ingebouwd in het Playwright-image.
RUN chown -R pwuser:pwuser /app
USER pwuser

# Fase 3 draait hier meerdere workers (BullMQ); vandaag alleen de uptime-poller.
CMD ["pnpm", "--filter", "worker", "uptime:start"]
