# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build stage: install all dependencies and build the Vue application.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
# Runtime stage: Node + OpenCode CLI + the built app and API server.
# One container serves the UI, the JSON databases and the Submission API.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    SERVE_STATIC=true \
    STATIC_DIR=/app/dist \
    PORT=8787 \
    HOST=0.0.0.0 \
    OPENCODE_MODE=cli

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

# OpenCode ships platform binaries as optional dependencies, so this works
# even when npm install scripts are restricted.
RUN npm install -g opencode-ai@1.18.34 tsx@4 \
    && npm cache clean --force

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY api ./api
COPY data ./data
COPY .opencode ./.opencode
COPY prompts ./prompts
COPY --from=build /app/dist ./dist

RUN useradd --create-home --shell /usr/sbin/nologin appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["tsx", "server/index.ts"]
