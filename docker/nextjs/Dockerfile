FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY nextjs/package*.json ./
RUN npm ci

# Copy application code
COPY nextjs/ .

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy built application
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/next.config.ts ./

# Install production dependencies only
RUN npm ci --production

EXPOSE 3000

CMD ["npm", "start"]