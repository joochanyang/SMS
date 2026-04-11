FROM node:22-alpine AS base

# 의존성 설치 — 부모 프로젝트 의존성도 함께 설치
FROM base AS deps
WORKDIR /app
# 부모 package.json (prisma, pg 등 공유 의존성)
COPY package.json package-lock.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./
RUN npm ci --ignore-scripts
RUN npx prisma generate

# admin 의존성
WORKDIR /app/admin
COPY admin/package.json admin/package-lock.json ./
RUN npm ci --ignore-scripts

# 빌드
FROM base AS builder
WORKDIR /app

# 부모 node_modules + 공유 라이브러리
COPY --from=deps /app/node_modules ./node_modules
COPY lib ./lib/
COPY prisma ./prisma/
COPY prisma.config.ts ./
COPY types ./types/

# admin 소스 + node_modules
WORKDIR /app/admin
COPY --from=deps /app/admin/node_modules ./node_modules
COPY admin/ .
COPY --from=deps /app/prisma ../prisma/

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

# 프로덕션
FROM base AS runner
WORKDIR /app/admin
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/admin/.next/standalone /app
COPY --from=builder --chown=nextjs:nodejs /app/admin/.next/static /app/admin/.next/static

USER nextjs
EXPOSE 3001
ENV PORT=3001
ENV HOSTNAME="0.0.0.0"
WORKDIR /app/admin
CMD ["node", "server.js"]
