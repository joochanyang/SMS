export const KR_POLICY = {
  defaultCostPerMessageUsd: 0.05,
  maxBatchSize: 200,
  maxRetries: 3,
  retryDelayMinutes: [0.5, 2, 5],
};

export type MessageType = "TRANSACTIONAL" | "AD";

export function normalizeKrPhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return null;

  // +82xxxxxxxxxx
  if (digits.startsWith("+82")) {
    const local = digits.slice(3);
    if (!/^1\d{8,9}$/.test(local)) return null;
    return `+82${local}`;
  }

  // 82xxxxxxxxxx
  if (digits.startsWith("82")) {
    const local = digits.slice(2);
    if (!/^1\d{8,9}$/.test(local)) return null;
    return `+82${local}`;
  }

  // 010xxxxxxxx
  if (digits.startsWith("0")) {
    const local = digits.slice(1);
    if (!/^1\d{8,9}$/.test(local)) return null;
    return `+82${local}`;
  }

  return null;
}

export function normalizeKrRecipients(input: string[]): string[] {
  return Array.from(
    new Set(
      input
        .map((r) => normalizeKrPhone(typeof r === "string" ? r.trim() : ""))
        .filter((v): v is string => Boolean(v))
    )
  );
}

export function validateAdMessageRules(message: string): { ok: boolean; reason?: string } {
  const hasAdPrefix = message.includes("(광고)");
  const hasOptOut = /무료\s*수신거부/.test(message);

  if (!hasAdPrefix) return { ok: false, reason: "광고성 메시지는 '(광고)' 표기가 필요합니다." };
  if (!hasOptOut) return { ok: false, reason: "광고성 메시지는 '무료 수신거부' 안내가 필요합니다." };
  return { ok: true };
}

export function getRetryDelayMs(retryCount: number): number {
  const index = Math.max(0, Math.min(retryCount, KR_POLICY.retryDelayMinutes.length - 1));
  return KR_POLICY.retryDelayMinutes[index] * 60 * 1000;
}

export function isTemporaryProviderError(statusText: string): boolean {
  const s = statusText.toUpperCase();
  return (
    s.includes("PENDING") ||
    s.includes("QUEUE") ||
    s.includes("TEMP") ||
    s.includes("TIMEOUT") ||
    s.includes("THROTTLE")
  );
}

