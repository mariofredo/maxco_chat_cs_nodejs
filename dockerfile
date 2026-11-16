# syntax=docker/dockerfile:1
# Maxco Chat CS - image production (multi-stage).
#
# Build (server x86_64, sesuai mayoritas server client):
#   docker buildx build --platform linux/amd64 -t maxco-chat-cs:1.0.0 --load .
# Build multi-arch + push ke registry:
#   docker buildx build --platform linux/amd64,linux/arm64 -t <registry>/maxco-chat-cs:1.0.0 --push .
# Detail serah terima ke client: deploy/DEPLOYMENT.md

# ---- Build stage ----
FROM node:24-alpine AS builder

WORKDIR /app

# Copy dependency manifests first for layer caching
COPY package*.json ./

# Install ALL deps (including devDependencies like typescript, ts-node)
RUN npm ci

# Copy source and config needed for build
COPY tsconfig.json ./
COPY src ./src

# Compile TypeScript -> dist/
RUN npm run build


# ---- Production stage ----
FROM node:24-alpine AS production

ARG APP_VERSION=1.0.0
LABEL org.opencontainers.image.title="maxco-chat-cs" \
      org.opencontainers.image.description="Maxco Chat CS API + Socket.IO" \
      org.opencontainers.image.version="${APP_VERSION}"

WORKDIR /app

ENV NODE_ENV=production

# Copy only package files, install only prod deps
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output from builder stage
COPY --from=builder /app/dist ./dist

# Folder uploads WAJIB ada dan writable oleh user non-root "node".
# Tanpa ini endpoint upload (POST /api/chats/crm/chat/upload) gagal EACCES.
RUN mkdir -p /app/uploads/chat && chown -R node:node /app/uploads
VOLUME ["/app/uploads"]

# Port aplikasi (3000 default, ubah lewat env PORT)
EXPOSE 3000

# Run as non-root for security
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/healthz" >/dev/null || exit 1

# Langsung ke node (bukan via npm) supaya SIGTERM dari `docker stop` diteruskan ke proses app
CMD ["node", "dist/app.js"]
