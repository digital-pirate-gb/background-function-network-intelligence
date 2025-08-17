# Build stage
FROM node:20-alpine AS builder

# Build-time arguments (can be passed during docker build)
ARG NODE_ENV=production
ARG BUILD_VERSION

# Set working directory
WORKDIR /app

# Copy package files for better layer caching
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci

# Copy source code
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine AS production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user early
RUN addgroup -g 1001 -S nodejs && \
    adduser -S worker -u 1001 -G nodejs

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Copy built application from builder stage
COPY --from=builder --chown=worker:nodejs /app/dist ./dist

# Runtime environment variables (with sensible defaults)
ENV NODE_ENV=production
ENV PORT=3000
ENV HEALTH_CHECK_PORT=3001
ENV LOG_LEVEL=info
ENV MAX_RETRIES=3
ENV TIMEOUT_MS=30000

# Switch to non-root user
USER worker

# Expose health check port
EXPOSE 3001

# Health check with proper endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${HEALTH_CHECK_PORT}/health || exit 1

# Use dumb-init as entrypoint for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Start the worker
CMD ["node", "dist/index.js"]
