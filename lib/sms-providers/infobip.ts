// ---------------------------------------------------------------------------
// Infobip Provider — 기존 lib/infobip.ts 래핑
// ---------------------------------------------------------------------------

import { Infobip, AuthType } from '@infobip-api/sdk';
import type { SmsProvider, SmsSendRequest, SmsSendResult, SmsProviderBalance } from './types';

export class InfobipProvider implements SmsProvider {
  readonly name = 'infobip' as const;
  readonly maxBatchSize = 200;

  private client: Infobip | null = null;

  private getClient(): Infobip {
    if (!this.client) {
      this.client = new Infobip({
        baseUrl: process.env.INFOBIP_URL!,
        apiKey: process.env.INFOBIP_API_KEY!,
        authType: AuthType.ApiKey,
      });
    }
    return this.client;
  }

  isConfigured(): boolean {
    return !!(process.env.INFOBIP_URL && process.env.INFOBIP_API_KEY);
  }

  async sendBatch(messages: SmsSendRequest[]): Promise<SmsSendResult[]> {
    const client = this.getClient();

    const response: any = await client.channels.sms.send({
      messages: messages.map((msg) => ({
        from: msg.from || 'SovereignSMS',
        destinations: [{ to: msg.to }],
        text: msg.text,
      })),
    } as any);

    const responseMessages: any[] =
      (Array.isArray(response?.messages) && response.messages) ||
      (Array.isArray(response?.data?.messages) && response.data.messages) ||
      [];

    return messages.map((msg, i) => {
      const rm = responseMessages[i] || null;
      const messageId = rm?.messageId ?? rm?.message_id ?? rm?.id ?? null;
      const providerStatus =
        rm?.status?.name ??
        rm?.status?.groupName ??
        rm?.status?.description ??
        'SENT';

      return {
        messageId: typeof messageId === 'string' ? messageId : null,
        to: msg.to,
        status: 'SENT' as const,
        providerStatus: String(providerStatus),
      };
    });
  }

  async getBalance(): Promise<SmsProviderBalance | null> {
    try {
      const url = process.env.INFOBIP_URL!;
      const apiKey = process.env.INFOBIP_API_KEY!;
      const res = await fetch(`${url}/account/1/balance`, {
        headers: {
          Authorization: `App ${apiKey}`,
          Accept: 'application/json',
        },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return {
        balance: data.balance ?? 0,
        currency: data.currency ?? 'EUR',
      };
    } catch {
      return null;
    }
  }
}
