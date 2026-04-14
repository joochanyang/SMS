// ---------------------------------------------------------------------------
// SMS.to Provider — 전달률 최적화 설정
// ---------------------------------------------------------------------------
//
// 한국 통신사(SKT/KT/LGU+) 스팸 필터링 회피를 위한 핵심 원칙:
// 1. 초당 발송량 제한 — 버스트 발송은 통신사에서 즉시 차단
// 2. 동시 요청 최소화 — 동일 발신자에서 동시 다발 요청 = 스팸 판정
// 3. 요청 간 랜덤 지터 — 기계적 패턴 회피
// 4. 네트워크 에러 시 재시도 — 일시 장애로 인한 손실 방지
//
// 결과: 초당 ~3건 발송, 200건 ≈ 70초, 1000건 ≈ 6분
// 속도는 느리지만 전달률이 최대 (= 돈을 아끼는 것)
// ---------------------------------------------------------------------------

import type { SmsProvider, SmsSendRequest, SmsSendResult, SmsProviderBalance } from './types';

const BASE_URL = 'https://api.sms.to';

// ── 전달률 최적화 파라미터 ──
const CONCURRENCY = 3;              // 동시 발송 3건 (통신사 버스트 감지 회피)
const BASE_DELAY_MS = 800;          // 청크 간 기본 대기 800ms
const JITTER_MS = 400;              // 랜덤 지터 0~400ms (패턴 회피)
const NETWORK_RETRY_DELAY_MS = 3000; // 네트워크 에러 시 3초 후 재시도

export class SmsToProvider implements SmsProvider {
  readonly name = 'smsto' as const;
  readonly maxBatchSize = 200;

  isConfigured(): boolean {
    return !!process.env.SMSTO_API_KEY;
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.SMSTO_API_KEY}`,
    };
  }

  async sendBatch(messages: SmsSendRequest[]): Promise<SmsSendResult[]> {
    const results: SmsSendResult[] = new Array(messages.length);

    for (let i = 0; i < messages.length; i += CONCURRENCY) {
      const batch = messages.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map((msg) => this.sendOneWithRetry(msg))
      );

      for (let j = 0; j < batchResults.length; j++) {
        results[i + j] = batchResults[j];
      }

      // 마지막 청크가 아니면 대기 (랜덤 지터 포함)
      if (i + CONCURRENCY < messages.length) {
        await sleep(BASE_DELAY_MS + Math.random() * JITTER_MS);
      }
    }

    return results;
  }

  /**
   * 1건 발송 + 네트워크 에러 시 1회 재시도
   */
  private async sendOneWithRetry(msg: SmsSendRequest): Promise<SmsSendResult> {
    const result = await this.sendOne(msg);

    // 네트워크 에러면 1회 재시도 (크레딧 부족 등 비즈니스 에러는 재시도 안함)
    if (result.status === 'FAILED' && result.error && this.isNetworkError(result.error)) {
      await sleep(NETWORK_RETRY_DELAY_MS);
      return this.sendOne(msg);
    }

    return result;
  }

  private async sendOne(msg: SmsSendRequest): Promise<SmsSendResult> {
    try {
      const res = await fetch(`${BASE_URL}/v1/sms/send`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          to: msg.to,
          message: msg.text,
          sender_id: msg.from || 'SMSto',
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        return {
          messageId: null,
          to: msg.to,
          status: 'FAILED',
          providerStatus: String(data?.status || `HTTP_${res.status}`),
          error: data?.message || data?.error || `HTTP ${res.status}`,
        };
      }

      const trackingId =
        data?.data?.trackingId || data?.trackingId || data?.message_id || null;

      return {
        messageId: trackingId,
        to: msg.to,
        status: 'SENT',
        providerStatus: data?.data?.status || 'ongoing',
      };
    } catch (err) {
      return {
        messageId: null,
        to: msg.to,
        status: 'FAILED',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private isNetworkError(msg: string): boolean {
    const lower = msg.toLowerCase();
    return (
      lower.includes('timeout') ||
      lower.includes('econnreset') ||
      lower.includes('econnrefused') ||
      lower.includes('network') ||
      lower.includes('fetch failed')
    );
  }

  async getBalance(): Promise<SmsProviderBalance | null> {
    try {
      const res = await fetch(`${BASE_URL}/v1/balance`, {
        headers: this.headers(),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return {
        balance: data?.balance ?? 0,
        currency: data?.currency ?? 'USD',
      };
    } catch {
      return null;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
