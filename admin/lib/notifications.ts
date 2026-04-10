/**
 * Alert / Notification System for SovereignSMS Admin Panel
 *
 * Sends critical alerts via Telegram Bot API.
 * Includes deduplication to prevent alert fatigue.
 */

type AlertLevel = 'INFO' | 'WARNING' | 'CRITICAL';

const LEVEL_EMOJI: Record<AlertLevel, string> = {
  INFO: '\uD83D\uDCCB',       // clipboard
  WARNING: '\u26A0\uFE0F',    // warning sign
  CRITICAL: '\uD83D\uDEA8',   // rotating light
};

/** Deduplication window: 15 minutes */
const DEDUP_WINDOW_MS = 15 * 60 * 1000;

/** Store for dedup: message hash -> last sent timestamp */
const recentAlerts = new Map<string, number>();

/** Cleanup interval handle for dedup store */
let dedupCleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Simple hash for dedup key — not cryptographic, just a fast fingerprint.
 */
function hashMessage(message: string, level: AlertLevel): string {
  let hash = 0;
  const str = `${level}:${message}`;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash.toString(36);
}

/**
 * Ensure periodic cleanup of the dedup store.
 */
function ensureDedupCleanup(): void {
  if (dedupCleanupInterval !== null) return;
  dedupCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, ts] of recentAlerts.entries()) {
      if (now - ts > DEDUP_WINDOW_MS) {
        recentAlerts.delete(key);
      }
    }
  }, 60_000);

  if (dedupCleanupInterval && typeof dedupCleanupInterval === 'object' && 'unref' in dedupCleanupInterval) {
    dedupCleanupInterval.unref();
  }
}

/**
 * Send a Telegram alert message.
 *
 * Requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in environment.
 * Fails silently — logs error to console but never throws.
 */
export async function sendTelegramAlert(
  message: string,
  level: AlertLevel,
): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    console.warn('[ALERT] Telegram not configured: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing');
    return;
  }

  const emoji = LEVEL_EMOJI[level];
  const formatted = `${emoji} [SovereignSMS ${level}]\n\n${message}`;

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: formatted,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[ALERT] Telegram API error ${res.status}:`, body);
    }
  } catch (err) {
    console.error('[ALERT] Failed to send Telegram alert:', err);
  }
}

/**
 * Send an alert with deduplication.
 *
 * If the same message + level combination was sent within the last 15 minutes,
 * it is silently skipped to prevent alert fatigue.
 */
export async function sendAlert(
  message: string,
  level: AlertLevel,
): Promise<void> {
  ensureDedupCleanup();

  const key = hashMessage(message, level);
  const now = Date.now();
  const lastSent = recentAlerts.get(key);

  if (lastSent && now - lastSent < DEDUP_WINDOW_MS) {
    // Duplicate within window — skip
    return;
  }

  recentAlerts.set(key, now);
  await sendTelegramAlert(message, level);
}
