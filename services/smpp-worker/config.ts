// ---------------------------------------------------------------------------
// SMPP 워커 환경변수 로더 — 누락/잘못된 값은 즉시 fail-fast (배포 사고 방지)
// ---------------------------------------------------------------------------

export interface SmppWorkerConfig {
  host: string;
  port: number;
  systemId: string;
  password: string;
  windowSize: number;
  submitTimeoutMs: number;
  enquireLinkMs: number;
  pollIntervalMs: number;
  batchSize: number;
}

function getRequired(key: string): string {
  const value = process.env[key];
  if (!value || !value.trim()) {
    throw new Error(
      `[smpp-worker] 환경변수 ${key} 가 설정되지 않았습니다. .env 확인 필요.`,
    );
  }
  return value.trim();
}

function getInt(key: string, fallback: number, min: number, max: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(
      `[smpp-worker] ${key}=${raw} 가 유효 범위 [${min}, ${max}]를 벗어납니다.`,
    );
  }
  return parsed;
}

export function loadConfig(): SmppWorkerConfig {
  return {
    host: getRequired("TXG_SMPP_HOST"),
    port: getInt("TXG_SMPP_PORT", 20002, 1, 65535),
    systemId: getRequired("TXG_SMPP_SYSTEM_ID"),
    password: getRequired("TXG_SMPP_PASSWORD"),
    windowSize: getInt("TXG_SMPP_WINDOW", 50, 1, 1000),
    submitTimeoutMs: getInt("TXG_SMPP_SUBMIT_TIMEOUT_MS", 60_000, 5_000, 300_000),
    enquireLinkMs: getInt("TXG_SMPP_ENQUIRE_LINK_MS", 30_000, 5_000, 300_000),
    pollIntervalMs: getInt("TXG_SMPP_POLL_INTERVAL_MS", 2_000, 500, 60_000),
    batchSize: getInt("TXG_SMPP_BATCH_SIZE", 200, 1, 5_000),
  };
}
