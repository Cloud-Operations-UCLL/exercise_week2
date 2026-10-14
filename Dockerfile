# Pinned to an exact Node.js version (docs/application.md: Node 24 LTS).
ARG NODE_IMAGE=node:24.21.0-alpine3.23

# Stage 1: install production dependencies. Only re-runs when the lock file changes.
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Stage 2: the runtime image. No npm cache, no build tools.
FROM ${NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public

# Declared late on purpose: a new SHA must not invalidate the layers above.
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}

# The official image ships a non-root user "node" (uid 1000).
USER node
EXPOSE 8080

# Exec form, no npm, no shell: node is PID 1 and receives SIGTERM directly.
CMD ["node", "src/index.js"]
