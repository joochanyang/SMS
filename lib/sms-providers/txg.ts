// ---------------------------------------------------------------------------
// TXG-TEL HTTP API V3.4 Provider
// ---------------------------------------------------------------------------
//
// 문서: TXG-TEL+HTTP+API_V3.4+EN.pdf
// Base URL: http://8.219.42.83:20003 (환경변수 오버라이드 가능)
// 인증: account + password
//
// 핵심 장점:
// - POST /sendsms: 최대 10,000건 네이티브 배치 발송
// - DLR: Push 콜백 + /getreport 폴링 이중화
// - Throttle 불필요 (서버가 배치 관리)
// ---------------------------------------------------------------------------

import { logger, toLogError } from '../logger';
import type {
  SmsProvider,
  SmsSendRequest,
  SmsSendResult,
  SmsProviderBalance,
} from './types';

const DEFAULT_BASE_URL = 'http://8.219.42.83:20003';

// ── TXG 에러 코드 매핑 ──
const TXG_ERROR_MESSAGES: Record<number, string> = {
  [-1]: '인증 오류 (Authentication error)',
  [-2]: 'IP 접근 제한 (IP limited access)',
  [-3]: '민감 문자 포함 (SMS contain sensitive characters)',
  [-4]: '메시지 내용 비어있음 (SMS content is empty)',
  [-5]: '메시지 길이 초과 (SMS content is too long)',
  [-6]: '템플릿 SMS가 아님 (Not a template SMS)',
  [-7]: '번호 수 초과 (Over number)',
  [-8]: '번호 비어있음 (Number is empty)',
  [-9]: '비정상 번호 (Abnormal number)',
  [-10]: '채널 잔액 부족 (Channel balance insufficient)',
  [-11]: '시간 오류 (Time is wrong)',
  [-12]: '플랫폼 오류 (Platform batch commit error)',
  [-13]: '사용자 잠김 (User locked)',
};

// ── DLR 상세 실패 사유 코드 ──
const TXG_DLR_STATUS_CODES: Record<number, string> = {
  0: 'success',
  1001: 'NoRoute',
  1002: 'NoChannel',
  1003: 'NoBalance',
  1004: 'Unknown',
  1005: 'Send Refuse',
  1006: 'Send Timeout',
  1007: 'Server Timeout',
  1008: 'SupplierMccMncLimit',
  1009: 'ConsumerMccMncLimit',
  1010: 'NoSupplier',
  1011: 'Black Number',
  1012: 'Sensitive Words',
  1013: 'Daily Limit',
  1014: 'DestinationMccMncLimit',
  1016: 'SMS Template Limit',
  1017: 'SupplierNoBalance',
  1018: 'UserProfitLimit',
  1019: 'ChannelProfitLimit',
  1020: 'MccNumberLengthLimit',
  1021: 'Job not found',
  1022: 'China SMS Limit',
  1023: 'RouteMccMncLimit',
};

export { TXG_DLR_STATUS_CODES };

// ---------------------------------------------------------------------------
// 공용: TXG 이벤트 → 내부 SmsLog 상태 매핑
// Push DLR과 getreport 폴링이 동일 포맷을 쓰므로 양쪽에서 재사용한다.
// ---------------------------------------------------------------------------

export interface TxgMappedStatus {
  /** null이면 현재 상태를 유지 (deliverStatus=5 알수없음 등) */
  nextStatus: "DELIVERED" | "FAILED" | null;
  providerStatus: string;
  providerError: string | null;
}

/**
 * TXG 이벤트 한 건을 내부 상태로 매핑한다.
 *
 * @param sendStatus    0=성공, 1=미전송, 2=전송중, non-0=발송실패
 * @param deliverStatus 0=보고불필요, 1=미전달, 2=전달실패, 3=전달성공,
 *                      4=시간초과, 5=알수없음, undefined=아직 결과 없음
 */
export function mapTxgEventToStatus(
  sendStatus: number,
  deliverStatus: number | undefined,
): TxgMappedStatus {
  // 1) 발송 자체 실패
  if (sendStatus !== 0) {
    const label = TXG_DLR_STATUS_CODES[sendStatus] ?? `send_error_${sendStatus}`;
    return {
      nextStatus: "FAILED",
      providerStatus: `send_status_${sendStatus}`,
      providerError: label,
    };
  }

  // 2) 발송 성공 + 전달 결과 미수신 → 상태 유지
  if (deliverStatus == null) {
    return { nextStatus: null, providerStatus: "sent", providerError: null };
  }

  // 3) 전달 결과 매핑
  switch (deliverStatus) {
    case 3: // 전달 성공
      return { nextStatus: "DELIVERED", providerStatus: "delivered", providerError: null };
    case 1: // 미전달
      return { nextStatus: "FAILED", providerStatus: "undelivered", providerError: "미전달" };
    case 2: // 전달 실패
      return { nextStatus: "FAILED", providerStatus: "delivery_failed", providerError: "전달 실패" };
    case 4: // 시간 초과
      return {
        nextStatus: "FAILED",
        providerStatus: "delivery_timeout",
        providerError: "전달 시간 초과",
      };
    case 0: // 보고 불필요 → 상태 유지 (이미 SENT)
    case 5: // 알 수 없음 → 후속 이벤트/폴링으로 확정
    default:
      return {
        nextStatus: null,
        providerStatus: `deliver_status_${deliverStatus}`,
        providerError: null,
      };
  }
}

/**
 * TXG-TEL getreport 응답 타입
 */
export interface TxgReportResult {
  status: number;
  success?: number;
  fail?: number;
  unsent?: number;
  sending?: number;
  nofound?: number;
  /** [[id, number, sendTime, sendStatus, deliverStatus?], ...] */
  array?: Array<[number, string, number, number, number?]>;
}

export class TxgProvider implements SmsProvider {
  readonly name = 'txg' as const;
  readonly maxBatchSize = 10000; // POST 최대 10,000건

  isConfigured(): boolean {
    return !!(process.env.TXG_ACCOUNT && process.env.TXG_PASSWORD);
  }

  private get baseUrl(): string {
    return process.env.TXG_BASE_URL || DEFAULT_BASE_URL;
  }

  private get authParams(): { account: string; password: string } {
    return {
      account: process.env.TXG_ACCOUNT!,
      password: process.env.TXG_PASSWORD!,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // sendBatch — 핵심 발송 로직
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * POST /sendsms — 네이티브 배치 발송
   *
   * 본문이 동일한 경우: numbers 콤마 구분 단일 요청
   * 본문이 다른 경우: smsarray 배열 모드
   *
   * 응답: {"status":0, "success":2, "fail":0, "array":[[number, id], ...]}
   */
  async sendBatch(messages: SmsSendRequest[]): Promise<SmsSendResult[]> {
    const uniqueTexts = new Set(messages.map((m) => m.text));

    if (uniqueTexts.size === 1) {
      return this.sendSingleContent(messages);
    }
    return this.sendMultiContent(messages);
  }

  /**
   * 동일 본문 — numbers 콤마 구분 단일 POST
   */
  private async sendSingleContent(
    messages: SmsSendRequest[],
  ): Promise<SmsSendResult[]> {
    const numbers = messages.map((m) => m.to).join(',');

    const body = {
      ...this.authParams,
      numbers,
      content: messages[0].text,
      smstype: 0,
      sender: '', // 업체 요청: Sender ID 지원 안하므로 빈 값으로 설정
    };

    try {
      const res = await fetch(`${this.baseUrl}/sendsms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json;charset=utf-8' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error(`TXG sendsms HTTP ${res.status}`);
      }

      const data = await res.json();
      return this.parseResponse(messages, data);
    } catch (err) {
      logger.warn('[TXG] sendSingleContent 네트워크/파싱 오류', {
        error: toLogError(err),
        metadata: { count: messages.length },
      });
      return messages.map((m) => ({
        messageId: null,
        to: m.to,
        status: 'FAILED' as const,
        providerStatus: 'NETWORK_ERROR',
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  /**
   * 다중 본문 — smsarray 사용
   */
  private async sendMultiContent(
    messages: SmsSendRequest[],
  ): Promise<SmsSendResult[]> {
    const smsarray = messages.map((m) => ({
      content: m.text,
      smstype: 0,
      numbers: m.to,
      sender: '', // 업체 요청: Sender ID 비우기
    }));

    const body = {
      ...this.authParams,
      smsarray,
    };

    try {
      const res = await fetch(`${this.baseUrl}/sendsms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json;charset=utf-8' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error(`TXG sendsms HTTP ${res.status}`);
      }

      const data = await res.json();
      return this.parseResponse(messages, data);
    } catch (err) {
      logger.warn('[TXG] sendMultiContent 네트워크/파싱 오류', {
        error: toLogError(err),
        metadata: { count: messages.length },
      });
      return messages.map((m) => ({
        messageId: null,
        to: m.to,
        status: 'FAILED' as const,
        providerStatus: 'NETWORK_ERROR',
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  /**
   * TXG 응답 파싱 — 통일된 SmsSendResult 배열로 변환
   *
   * 성공 응답: {"status":0, "success":2, "fail":0, "array":[[10010,1],[1008611,2]]}
   * 실패 응답: {"status":-1} (전체 실패)
   */
  private parseResponse(
    messages: SmsSendRequest[],
    data: { status: number; success?: number; fail?: number; array?: Array<[number | string, number]> },
  ): SmsSendResult[] {
    // status !== 0 → 전체 실패
    if (data.status !== 0) {
      const errorMsg = TXG_ERROR_MESSAGES[data.status] || `TXG 오류 (${data.status})`;
      return messages.map((m) => ({
        messageId: null,
        to: m.to,
        status: 'FAILED' as const,
        providerStatus: `TXG_ERROR_${data.status}`,
        error: errorMsg,
      }));
    }

    // array: [[number, id], [number, id], ...]
    // number → 수신번호, id → TXG 시스템 발급 ID
    const resultMap = new Map<string, number>();
    if (Array.isArray(data.array)) {
      for (const item of data.array) {
        resultMap.set(String(item[0]), item[1]);
      }
    }

    // TXG는 부분 실패 사유를 개별로 내려주지 않는다. array에서 빠진 번호는 FAILED로 기록하고,
    // providerError에 확인 경로를 명시해 운영자가 /getreport로 후속 추적할 수 있게 한다.
    return messages.map((m) => {
      const txgId = resultMap.get(m.to);
      if (txgId != null) {
        return {
          messageId: String(txgId),
          to: m.to,
          status: 'SENT' as const,
          providerStatus: 'SUBMITTED',
        };
      }
      return {
        messageId: null,
        to: m.to,
        status: 'FAILED' as const,
        providerStatus: 'SUBMIT_FAILED',
        error: 'TXG 응답 array에서 누락 (사유 미상 — /getreport로 확인 필요)',
      };
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // getBalance — 잔액 조회
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /getbalance
   * 응답: {"status":0, "balance":"99.990000", "gift":"50.00000"}
   */
  async getBalance(): Promise<SmsProviderBalance | null> {
    try {
      const params = new URLSearchParams(this.authParams);
      const res = await fetch(`${this.baseUrl}/getbalance?${params}`);
      if (!res.ok) {
        logger.warn('[TXG] getBalance HTTP 오류', {
          metadata: { httpStatus: res.status },
        });
        return null;
      }

      const data = await res.json();
      if (data.status !== 0) {
        const label = TXG_ERROR_MESSAGES[data.status] ?? `unknown(${data.status})`;
        logger.warn('[TXG] getBalance API 실패', {
          metadata: { status: data.status, label },
        });
        return null;
      }

      return {
        balance: parseFloat(data.balance || '0'),
        currency: 'EUR',
      };
    } catch (e) {
      logger.warn('[TXG] getBalance 네트워크/파싱 오류', { error: toLogError(e) });
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // getReport — 전송 결과 폴링 (DLR)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /getreport?ids=1,2,3
   *
   * 응답: {"status":0, "success":1, "fail":1, "unsent":0, "sending":0,
   *        "nofound":0, "array":[[1,"10010",20171001123015,0,3], ...]}
   *
   * array[i] = [id, number, sendTime, sendStatus, deliverStatus]
   *   sendStatus: 0=성공, 1=미전송, 2=전송중, non-0=실패
   *   deliverStatus: 0=보고불필요, 1=미전달, 2=전달실패, 3=전달성공, 4=시간초과, 5=알수없음
   */
  async getReport(ids: number[]): Promise<TxgReportResult> {
    const params = new URLSearchParams({
      ...this.authParams,
      ids: ids.join(','),
    });

    const res = await fetch(`${this.baseUrl}/getreport?${params}`);
    if (!res.ok) {
      throw new Error(`TXG getreport HTTP ${res.status}`);
    }
    const data = (await res.json()) as TxgReportResult;
    if (data.status !== 0) {
      const label = TXG_ERROR_MESSAGES[data.status] ?? `unknown(${data.status})`;
      throw new Error(`TXG getreport 응답 실패 status=${data.status} (${label})`);
    }
    return data;
  }
}
