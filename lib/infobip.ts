import { Infobip, AuthType } from '@infobip-api/sdk';

if (!process.env.INFOBIP_URL || !process.env.INFOBIP_API_KEY) {
  throw new Error("Missing INFOBIP credentials in .env");
}

export const infobipClient = new Infobip({
    baseUrl: process.env.INFOBIP_URL,
    apiKey: process.env.INFOBIP_API_KEY,
    authType: AuthType.ApiKey,
});
