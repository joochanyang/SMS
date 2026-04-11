import { Infobip, AuthType } from '@infobip-api/sdk';

let _client: Infobip | null = null;

export function getInfobipClient(): Infobip {
  if (!_client) {
    if (!process.env.INFOBIP_URL || !process.env.INFOBIP_API_KEY) {
      throw new Error("Missing INFOBIP credentials in .env");
    }
    _client = new Infobip({
      baseUrl: process.env.INFOBIP_URL,
      apiKey: process.env.INFOBIP_API_KEY,
      authType: AuthType.ApiKey,
    });
  }
  return _client;
}

export const infobipClient = new Proxy({} as Infobip, {
  get(_, prop) {
    return (getInfobipClient() as any)[prop];
  },
});
