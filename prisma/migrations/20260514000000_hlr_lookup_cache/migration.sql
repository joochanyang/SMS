-- HLR Lookup 캐시 도입: 발송 후 실제 가입 통신사 보강용 스키마

-- AlterTable: SmsLog 에 HLR 보강 완료 시각 컬럼 추가 (재조회 방지)
ALTER TABLE "SmsLog" ADD COLUMN "hlrCheckedAt" TIMESTAMP(3);

-- CreateTable: HlrLookup (번호별 30일 TTL 캐시)
CREATE TABLE "HlrLookup" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "mccMnc" TEXT,
    "carrierName" TEXT,
    "countryCode" TEXT,
    "ported" BOOLEAN NOT NULL DEFAULT false,
    "reachable" TEXT,
    "rawResponse" JSONB,
    "lookedUpAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HlrLookup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HlrLookup_phone_key" ON "HlrLookup"("phone");

-- CreateIndex
CREATE INDEX "HlrLookup_lookedUpAt_idx" ON "HlrLookup"("lookedUpAt");
