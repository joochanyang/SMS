export type RecipientWithVars = { phone: string; name?: string; nickname?: string };

export type CampaignProgress = {
  id: string;
  status: string;
  processedCount: number;
  totalRecipients: number;
  failedCount: number;
  deliveredCount: number;
};

const GSM7_CHARS = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
  'ÄÖÑÜabcdefghijklmnopqrstuvwxyzäöñüà§ÆæßÉ{|}~[\\]^€'
);

function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (!GSM7_CHARS.has(ch)) return false;
  }
  return true;
}

export function getSmsInfo(text: string) {
  const gsm7 = isGsm7(text);
  const charCount = text.length;
  const singleMax = gsm7 ? 160 : 70;
  const concatMax = gsm7 ? 153 : 67;
  const parts = charCount <= singleMax ? (charCount > 0 ? 1 : 0) : Math.ceil(charCount / concatMax);
  return {
    encoding: gsm7 ? 'GSM-7' : 'UCS-2',
    charCount,
    maxChars: singleMax,
    parts,
    remaining: singleMax - charCount,
  };
}

export function cleanPhoneInput(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('+')) {
    return '+' + trimmed.slice(1).replace(/[^0-9]/g, '');
  }
  return trimmed.replace(/[^0-9]/g, '');
}

export function isValidPhone(raw: string): boolean {
  const cleaned = cleanPhoneInput(raw);
  if (/^\+\d{7,15}$/.test(cleaned)) return true;
  if (/^\d{7,15}$/.test(cleaned)) return true;
  return false;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
