// ---------------------------------------------------------------------------
// TXG-TEL Provider — SMPP 전용 (HTTP 발송 경로 폐기됨)
// ---------------------------------------------------------------------------
//
// 발송은 services/smpp-worker 컨테이너가 단독 처리한다.
// 본 클래스는 다음 두 책임만 유지한다:
//   1. isConfigured() — SMPP 환경변수 설정 여부 판정 (활성 프로바이더 전환 가드)
//   2. getBalance() — HTTP /getbalance (SMPP에는 잔액 query 없음)
//
// **sendBatch는 더 이상 직접 발송하지 않는다.**
// 호출되면 fail-closed로 즉시 throw 한다 — Next.js 측에서 잘못된 경로로
// TXG에 직접 발송 시도하는 것을 방지하기 위함.
// ---------------------------------------------------------------------------

import { logger, toLogError } from "../logger";
import type {
  SmsProvider,
  SmsSendRequest,
  SmsSendResult,
  SmsProviderBalance,
} from "./types";

/**
 * TxgProvider sendBatch 호출 시 발생하는 에러.
 * 호출자가 catch 후 명확한 분기를 할 수 있도록 별도 에러 클래스로 노출.
 */
export class TxgSendBatchUnsupportedError extends Error {
  constructor() {
    super(
      "TXG는 SMPP 워커가 단독 처리합니다. lib/campaign-processor.ts 가 이미 TXG 활성 시 처리를 건너뛰도록 분기되어 있어야 합니다.",
    );
    this.name = "TxgSendBatchUnsupportedError";
  }
}

export class TxgProvider implements SmsProvider {
  readonly name = "txg" as const;
  /**
   * SMPP는 PDU 단위 발송이라 "배치 상한" 개념이 직접 매핑되지 않는다.
   * Next.js 측 코드가 provider.maxBatchSize 를 참조하는 곳이 있어 호환을 위해 유지.
   * 실제 동시성 제어는 워커의 TXG_SMPP_WINDOW 환경변수가 담당.
   */
  readonly maxBatchSize = 200;

  isConfigured(): boolean {
    return !!(
      process.env.TXG_SMPP_HOST &&
      process.env.TXG_SMPP_SYSTEM_ID &&
      process.env.TXG_SMPP_PASSWORD
    );
  }

  /**
   * **사용 금지** — TXG 발송은 SMPP 워커 전담.
   * 호출되면 즉시 throw 하여 잘못된 경로로 발송되는 것을 차단한다.
   *
   * (인터페이스 호환을 위해 시그니처는 유지하되 실제 호출은 막음)
   */
  async sendBatch(_messages: SmsSendRequest[]): Promise<SmsSendResult[]> {
    throw new TxgSendBatchUnsupportedError();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // getBalance — HTTP /getbalance 만 유지 (SMPP에 잔액 query 없음)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * 응답: {"status":0, "balance":"99.990000", "gift":"50.00000"}
   * 단위: EUR (2026-04-24 실측). 한국 SMS 단가 €0.0055/segment.
   */
  async getBalance(): Promise<SmsProviderBalance | null> {
    const baseUrl = process.env.TXG_HTTP_BALANCE_URL;
    const account = process.env.TXG_HTTP_ACCOUNT;
    const password = process.env.TXG_HTTP_PASSWORD;

    if (!baseUrl || !account || !password) {
      logger.warn(
        "[TXG] 잔액 조회 환경변수 누락 (TXG_HTTP_BALANCE_URL/ACCOUNT/PASSWORD)",
      );
      return null;
    }

    try {
      const params = new URLSearchParams({ account, password });
      const res = await fetch(`${baseUrl}/getbalance?${params}`);
      if (!res.ok) {
        logger.warn("[TXG] getBalance HTTP 오류", {
          metadata: { httpStatus: res.status },
        });
        return null;
      }

      const data = (await res.json()) as { status?: number; balance?: string };
      if (data.status !== 0) {
        logger.warn("[TXG] getBalance API 실패", {
          metadata: { status: data.status },
        });
        return null;
      }

      return {
        balance: parseFloat(data.balance || "0"),
        currency: "EUR",
      };
    } catch (e) {
      logger.warn("[TXG] getBalance 네트워크/파싱 오류", { error: toLogError(e) });
      return null;
    }
  }
}
