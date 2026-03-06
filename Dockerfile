# Multi-stage build
FROM node:22-alpine AS builder
WORKDIR /app

# Install build tools for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Copy package files first for caching
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/backend/package.json packages/backend/
COPY packages/frontend/package.json packages/frontend/
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# ── Production image ──
FROM node:22-alpine AS runner
WORKDIR /app

# better-sqlite3 needs libstdc++
RUN apk add --no-cache libstdc++

# Only copy production dependencies
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/backend/package.json packages/backend/
RUN npm ci --omit=dev --workspace=packages/backend --workspace=packages/shared

# Copy build artifacts
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=builder /app/packages/backend/drizzle ./packages/backend/drizzle
COPY --from=builder /app/packages/frontend/dist ./public

# Copy source-packs (for seed)
COPY source-packs ./source-packs

RUN mkdir -p /data

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_URL=file:/data/arclight.db
EXPOSE 3000

# Start from packages/backend directory
WORKDIR /app/packages/backend
CMD ["node", "dist/index.js"]
