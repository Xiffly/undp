FROM node:22-alpine AS builder

WORKDIR /repo/apps/api
COPY apps/api/package*.json ./
RUN npm ci

WORKDIR /repo
COPY shared ./shared
COPY apps/api ./apps/api
COPY apps/frontend/public/locales ./apps/frontend/public/locales

WORKDIR /repo/apps/api
RUN npm run build

FROM node:22-alpine AS runner

RUN apk add --no-cache curl

WORKDIR /repo/apps/api
COPY apps/api/package*.json ./
RUN npm ci --only=production

COPY --from=builder /repo/apps/api/dist ./dist
COPY --from=builder /repo/shared /repo/shared
COPY --from=builder /repo/apps/frontend/public/locales /repo/apps/frontend/public/locales

RUN mkdir -p /repo/uploads && chown -R node:node /repo

USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3001/api/health || exit 1

CMD ["node", "dist/index.js"]
