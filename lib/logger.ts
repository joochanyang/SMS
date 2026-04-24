type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: string;
  userId?: string;
  campaignId?: string;
  error?: { message: string; stack?: string };
  metadata?: Record<string, unknown>;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "\x1b[36m", // cyan
  info: "\x1b[32m",  // green
  warn: "\x1b[33m",  // yellow
  error: "\x1b[31m", // red
};

const RESET = "\x1b[0m";

function getMinLevel(): LogLevel {
  const env = process.env.LOG_LEVEL?.toLowerCase();
  if (env && env in LEVEL_PRIORITY) return env as LogLevel;
  return "info";
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[getMinLevel()];
}

function buildEntry(
  level: LogLevel,
  message: string,
  data?: Partial<LogEntry>,
): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data,
  };
}

function formatDev(entry: LogEntry): string {
  const color = LEVEL_COLORS[entry.level];
  const tag = entry.context ? ` [${entry.context}]` : "";
  const user = entry.userId ? ` uid=${entry.userId}` : "";
  const campaign = entry.campaignId ? ` cid=${entry.campaignId}` : "";
  const err = entry.error
    ? `\n  → ${entry.error.message}${entry.error.stack ? `\n${entry.error.stack}` : ""}`
    : "";
  const meta =
    entry.metadata && Object.keys(entry.metadata).length > 0
      ? `\n  meta=${JSON.stringify(entry.metadata)}`
      : "";

  return `${color}${entry.level.toUpperCase().padEnd(5)}${RESET} ${entry.timestamp}${tag}${user}${campaign} ${entry.message}${err}${meta}`;
}

// 파일 싱크: LOG_FILE_PATH 설정 시 JSON Lines 추가 기록 (Loki/Promtail 수집용).
// Edge/browser 환경에서는 require 실패 시 무시됨.
let fileStream: NodeJS.WritableStream | null = null;
let fileStreamInitAttempted = false;

function getFileStream(): NodeJS.WritableStream | null {
  if (fileStreamInitAttempted) return fileStream;
  fileStreamInitAttempted = true;

  const filePath = process.env.LOG_FILE_PATH;
  if (!filePath) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("node:path") as typeof import("node:path");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fileStream = fs.createWriteStream(filePath, { flags: "a" });
    fileStream.on("error", (err) => {
      console.error("[logger] 파일 싱크 오류:", err);
      fileStream = null;
    });
  } catch (err) {
    console.error("[logger] 파일 싱크 초기화 실패:", err);
    fileStream = null;
  }
  return fileStream;
}

function emit(level: LogLevel, message: string, data?: Partial<LogEntry>): void {
  if (!shouldLog(level)) return;

  const entry = buildEntry(level, message, data);
  const isDev = process.env.NODE_ENV !== "production";
  const json = JSON.stringify(entry);
  const output = isDev ? formatDev(entry) : json;

  if (level === "error") {
    console.error(output);
  } else if (level === "warn") {
    console.warn(output);
  } else {
    console.log(output);
  }

  const stream = getFileStream();
  if (stream) {
    stream.write(json + "\n");
  }
}

/** unknown 타입의 catch error를 LogEntry.error 형태로 변환 */
export function toLogError(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) return { message: err.message, stack: err.stack };
  return { message: String(err) };
}

export const logger = {
  debug(message: string, data?: Partial<LogEntry>) {
    emit("debug", message, data);
  },
  info(message: string, data?: Partial<LogEntry>) {
    emit("info", message, data);
  },
  warn(message: string, data?: Partial<LogEntry>) {
    emit("warn", message, data);
  },
  error(message: string, data?: Partial<LogEntry>) {
    emit("error", message, data);
  },
};
