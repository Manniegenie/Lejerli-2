# ─────────────────────────────────────────────────────────────────────────
#  Lejerli Technologies — Production Dockerfile
#  Multi-stage build: deps → build → production
# ─────────────────────────────────────────────────────────────────────────

# ── Stage 1: dependency cache ─────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Copy only package files first to leverage Docker layer cache
COPY package.json package-lock.json* ./

# Install ALL deps including devDependencies (needed if any build step)
RUN npm ci --prefer-offline

# ── Stage 2: production image ─────────────────────────────────────────────
FROM node:20-alpine AS production

# Install dumb-init for proper signal handling in containers
RUN apk add --no-cache dumb-init

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S lejerli && \
    adduser  -u 1001 -S lejerli -G lejerli

# Copy production node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY --chown=lejerli:lejerli . .

# Remove dev artifacts
RUN rm -rf tests/ .env* *.md

# Switch to non-root user
USER lejerli

# Expose API port
EXPOSE 4000

# Health check — ping the health endpoint every 30s
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:4000/health || exit 1

# Use dumb-init to handle PID 1 responsibilities + proper SIGTERM forwarding
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
