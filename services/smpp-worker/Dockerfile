# ---------------------------------------------------------------------------
# SMPP Worker — TXG 메인 발송 라인 (단일 인스턴스 daemon)
# ---------------------------------------------------------------------------
#
# 실행: tsx 런타임으로 services/smpp-worker/index.ts 직접 실행.
# Prisma 클라이언트는 prisma generate 산출물을 그대로 사용.
#
# ⚠️ 단일 인스턴스만 실행. docker-compose deploy.replicas: 1 강제.
# ---------------------------------------------------------------------------

FROM node:22-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma/
RUN npm ci --ignore-scripts
RUN npx prisma generate

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

# 필수 코드만 복사 — 워커는 Next.js 산출물 불필요
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY tsconfig.json ./
COPY prisma ./prisma/
COPY lib ./lib/
COPY services/smpp-worker ./services/smpp-worker/

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 worker

USER worker

# 헬스 체크는 SMPP 워커 특성상 외부에서 잔액/송신 추세로 모니터링.
# 컨테이너 자체는 SIGTERM 처리 + restart 정책으로 회복.

CMD ["npx", "tsx", "services/smpp-worker/index.ts"]
