// ---------------------------------------------------------------------------
// Global SMS Policy — Infobip international messaging
// ---------------------------------------------------------------------------

export const SMS_POLICY = {
  defaultCostPerMessageKrw: 14,
  maxBatchSize: 200,
  maxRetries: 3,
  retryDelayMinutes: [0.5, 2, 5],
  /** GSM-7 single SMS limit */
  gsm7MaxChars: 160,
  /** UCS-2 single SMS limit (Korean, Chinese, emoji, etc.) */
  ucs2MaxChars: 70,
  /** UCS-2 concatenated SMS per-part limit */
  ucs2ConcatChars: 67,
  /** GSM-7 concatenated SMS per-part limit */
  gsm7ConcatChars: 153,
};

// GSM-7 basic character set
const GSM7_CHARS = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
  'ÄÖÑÜabcdefghijklmnopqrstuvwxyzäöñüà§ÆæßÉ{|}~[\\]^€'
);

/**
 * Check if a message can be encoded as GSM-7 (Latin/basic chars only).
 * If any character is outside GSM-7, UCS-2 encoding is used (70 char limit).
 */
export function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (!GSM7_CHARS.has(ch)) return false;
  }
  return true;
}

/**
 * Calculate SMS segment info for a message.
 * Returns encoding type, character count, max chars per SMS, and number of SMS parts.
 */
export function getSmsSegmentInfo(text: string): {
  encoding: 'GSM-7' | 'UCS-2';
  charCount: number;
  maxCharsPerSms: number;
  parts: number;
  warning: string | null;
} {
  const gsm7 = isGsm7(text);
  const charCount = text.length;
  const singleMax = gsm7 ? SMS_POLICY.gsm7MaxChars : SMS_POLICY.ucs2MaxChars;
  const concatMax = gsm7 ? SMS_POLICY.gsm7ConcatChars : SMS_POLICY.ucs2ConcatChars;

  let parts: number;
  if (charCount <= singleMax) {
    parts = 1;
  } else {
    parts = Math.ceil(charCount / concatMax);
  }

  let warning: string | null = null;
  if (!gsm7 && charCount > SMS_POLICY.ucs2MaxChars) {
    warning = `메시지가 ${charCount}자입니다. UCS-2 인코딩 기준 ${SMS_POLICY.ucs2MaxChars}자 초과 시 ${parts}건으로 분할 과금됩니다.`;
  } else if (gsm7 && charCount > SMS_POLICY.gsm7MaxChars) {
    warning = `메시지가 ${charCount}자입니다. ${SMS_POLICY.gsm7MaxChars}자 초과 시 ${parts}건으로 분할 과금됩니다.`;
  }

  return {
    encoding: gsm7 ? 'GSM-7' : 'UCS-2',
    charCount,
    maxCharsPerSms: singleMax,
    parts,
    warning,
  };
}

// ---------------------------------------------------------------------------
// Phone number normalization — Global E.164 format
// ---------------------------------------------------------------------------

/**
 * Normalize a phone number to E.164 format.
 * Accepts: +821012345678, 821012345678, 01012345678 (assumed Korean +82)
 * Returns null if the number looks invalid.
 */
export function normalizePhone(raw: string): string | null {
  const cleaned = raw.replace(/[\s\-().]/g, "");
  if (!cleaned) return null;

  // Already in E.164 format
  if (/^\+\d{7,15}$/.test(cleaned)) {
    return cleaned;
  }

  // Without + prefix but starts with country code digits
  if (/^\d{7,15}$/.test(cleaned)) {
    // Korean number without + (starts with 82)
    if (cleaned.startsWith("82") && cleaned.length >= 10) {
      return `+${cleaned}`;
    }
    // Korean local format (starts with 0)
    if (cleaned.startsWith("0") && cleaned.length >= 10 && cleaned.length <= 12) {
      return `+82${cleaned.slice(1)}`;
    }
    // Other international number — assume it includes country code
    if (cleaned.length >= 7) {
      return `+${cleaned}`;
    }
  }

  return null;
}

/**
 * Normalize and deduplicate a list of phone numbers.
 */
export function normalizeRecipients(input: string[]): string[] {
  return Array.from(
    new Set(
      input
        .map((r) => normalizePhone(typeof r === "string" ? r.trim() : ""))
        .filter((v): v is string => Boolean(v))
    )
  );
}

// ---------------------------------------------------------------------------
// Retry helpers
// ---------------------------------------------------------------------------

export function getRetryDelayMs(retryCount: number): number {
  const index = Math.max(0, Math.min(retryCount, SMS_POLICY.retryDelayMinutes.length - 1));
  return SMS_POLICY.retryDelayMinutes[index] * 60 * 1000;
}

export function isTemporaryProviderError(statusText: string): boolean {
  const s = statusText.toUpperCase();
  if (s === "PENDING_ACCEPTED" || s === "PENDING_ENROUTE" || s === "SENT") return false;
  return (
    s.includes("PENDING") ||
    s.includes("QUEUE") ||
    s.includes("TEMP") ||
    s.includes("TIMEOUT") ||
    s.includes("THROTTLE")
  );
}

// ---------------------------------------------------------------------------
// Blacklist check
// ---------------------------------------------------------------------------

/**
 * Check which phone numbers are blacklisted (global or user-specific).
 * Returns a Set of blocked phone numbers.
 */
export async function getBlacklistedNumbers(
  phoneNumbers: string[],
  userId: string,
): Promise<Set<string>> {
  if (phoneNumbers.length === 0) return new Set();

  const crypto = await import('crypto');
  const hashMap = new Map<string, string>();
  for (const phone of phoneNumbers) {
    const hash = crypto.createHash('sha256').update(phone).digest('hex');
    hashMap.set(hash, phone);
  }

  const { prisma } = await import('./prisma');
  const hashes = Array.from(hashMap.keys());

  const entries = await prisma.blacklist.findMany({
    where: {
      phoneHash: { in: hashes },
      OR: [
        { isGlobal: true },
        { userId },
      ],
      AND: [
        {
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } },
          ],
        },
      ],
    },
    select: { phoneHash: true },
  });

  const blocked = new Set<string>();
  for (const entry of entries) {
    const phone = hashMap.get(entry.phoneHash);
    if (phone) blocked.add(phone);
  }
  return blocked;
}
