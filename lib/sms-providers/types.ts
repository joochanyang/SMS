// ---------------------------------------------------------------------------
// SMS Provider 공통 인터페이스 — 모든 프로바이더가 이 interface를 구현한다
// ---------------------------------------------------------------------------

export interface SmsSendRequest {
  to: string;        // E.164 수신번호 (+821012345678)
  text: string;      // 메시지 본문
  from?: string;     // 발신번호 (Alphanumeric Sender ID)
}

export interface SmsSendResult {
  messageId: string | null;
  to: string;
  status: 'SENT' | 'FAILED' | 'PENDING';
  providerStatus?: string;
  error?: string;
}

export interface SmsProviderBalance {
  balance: number;
  currency: string;
}

export type SmsProviderName = 'infobip' | 'smsto';

export interface SmsProvider {
  readonly name: SmsProviderName;
  readonly maxBatchSize: number;

  sendBatch(messages: SmsSendRequest[]): Promise<SmsSendResult[]>;
  getBalance(): Promise<SmsProviderBalance | null>;
  isConfigured(): boolean;
}
