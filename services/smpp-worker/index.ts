// ---------------------------------------------------------------------------
// SMPP 워커 메인 엔트리 — TXG 단일 인스턴스 daemon
// ---------------------------------------------------------------------------
//
// 시작 절차:
//   1. .env 로드 + 환경변수 검증 (fail-fast)
//   2. SMPP 연결 + bind_transceiver
//   3. CampaignPoller 시작 — TXG 활성일 때만 PENDING 행 처리
//   4. SIGTERM/SIGINT 수신 시 graceful shutdown:
//      - 폴링 중지
//      - in-flight submit 완료 대기 (최대 10초)
//      - SMPP unbind + close
//
// 단일 인스턴스 강제: docker-compose.yml 에서 deploy.replicas: 1 + restart: on-failure
// (다중 바인드는 TXG 계정 정지 사유)
// ---------------------------------------------------------------------------

import "dotenv/config";
import { logger } from "@/lib/logger";
import { loadConfig } from "./config";
import { SmppConnection } from "./connection";
import { applyDlr, parseDeliverSm } from "./dlr";
import { CampaignPoller } from "./poller";

async function main(): Promise<void> {
  const config = loadConfig();
  logger.info(
    `[smpp-worker] 시작 — host=${config.host}:${config.port} system_id=${config.systemId} window=${config.windowSize}`,
  );

  const conn = new SmppConnection(config, async (pdu) => {
    const parsed = parseDeliverSm(pdu);
    if (!parsed) return;
    await applyDlr(parsed);
  });

  await conn.start();

  const poller = new CampaignPoller(conn, {
    pollIntervalMs: config.pollIntervalMs,
    batchSize: config.batchSize,
  });
  poller.start();

  // ─── graceful shutdown ───
  let shuttingDown = false;
  const onSignal = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`[smpp-worker] ${signal} 수신 — graceful shutdown 시작`);
    try {
      await poller.stop();
      await conn.shutdown();
    } finally {
      logger.info("[smpp-worker] 종료 완료");
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void onSignal("SIGTERM"));
  process.on("SIGINT", () => void onSignal("SIGINT"));
}

main().catch((err) => {
  logger.error(`[smpp-worker] 치명적 오류 — 프로세스 종료: ${err?.message ?? err}`);
  if (err?.stack) logger.error(err.stack);
  process.exit(1);
});
