// ---------------------------------------------------------------------------
// SMPP 연결 매니저 — bind_transceiver / enquire_link / 재접속 / 윈도잉
// ---------------------------------------------------------------------------
//
// 책임 영역:
//  - SMPP TCP 연결 수립 + bind_transceiver 1회
//  - enquire_link 자동 송신 (smpp 라이브러리 옵션)
//  - 연결 끊김 시 exponential backoff(1s→30s) 재접속
//  - submit_sm 윈도우 제어 (동시 in-flight 상한)
//  - submit_sm timeout 처리 (설정값 초과 시 reject = SUBMIT_TIMEOUT)
//  - deliver_sm 수신 시 외부 핸들러로 위임
//
// **비용 안전 원칙**:
//  - submit_sm 응답을 받지 못한 채 timeout/disconnect 발생하면 **재시도 금지**.
//    호출자는 SmsLog를 FAILED + providerStatus='SUBMIT_AMBIGUOUS' 로 종결하고
//    이중과금 가능성을 운영자에게 노출.
// ---------------------------------------------------------------------------

import smpp from "smpp";
import type { PDU, Session, SubmitSmOptions } from "smpp";
import { logger, toLogError } from "@/lib/logger";
import type { SmppWorkerConfig } from "./config";

export type SubmitOutcome =
  /** SMSC가 정상 수락 — message_id 발급 */
  | { kind: "accepted"; messageId: string }
  /** 명시적 거절 — 재시도 안전 여부는 commandStatus로 판단 */
  | { kind: "rejected"; commandStatus: number; retryable: boolean }
  /** 응답 미수신 (timeout/disconnect) — **재시도 금지**. 이중과금 위험 */
  | { kind: "ambiguous"; reason: "timeout" | "disconnect" };

export type DeliverHandler = (pdu: PDU) => void;

interface PendingSubmit {
  resolve: (outcome: SubmitOutcome) => void;
  timer: NodeJS.Timeout;
  destinationAddr: string;
}

const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([
  // 0x00000058 ESME_RTHROTTLED — 처리량 초과
  0x58,
  // 0x00000014 ESME_RMSGQFUL — 메시지 큐 가득 참
  0x14,
  // 0x00000045 ESME_RX_T_APPN — temporary app error
  0x45,
  // 0x00000064 ESME_RSYSERR — system error (애매하지만 보수적으로 retryable)
  0x64,
]);

export class SmppConnection {
  private session: Session | null = null;
  private bound = false;
  private shuttingDown = false;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private inflight = 0;
  /** 윈도우 가득 시 대기 중인 제출 요청들 (FIFO) */
  private waiters: Array<() => void> = [];
  /** smpp 라이브러리는 sequence_number 기반 매칭이 콜백으로 처리되므로 우리는 시퀀스 추적만 한다 */
  private pendingSubmits = new Set<PendingSubmit>();
  private boundCallbacks: Array<(ok: boolean) => void> = [];

  constructor(
    private readonly config: SmppWorkerConfig,
    private readonly onDeliver: DeliverHandler,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // 연결 + bind
  // ─────────────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.boundCallbacks.push((ok) => {
        if (ok) resolve();
        else reject(new Error("[smpp-worker] 초기 bind_transceiver 실패"));
      });
      this.connect();
    });
  }

  private connect(): void {
    if (this.shuttingDown) return;

    const url = `smpp://${this.config.host}:${this.config.port}`;
    logger.info(`[smpp-worker] SMPP 연결 시도: ${url}`);

    const session = smpp.connect({
      url,
      auto_enquire_link_period: this.config.enquireLinkMs,
    }) as Session;

    this.session = session;
    this.bound = false;

    session.on("connect", () => {
      logger.info("[smpp-worker] TCP 연결 성공, bind_transceiver 시도");
      session.bind_transceiver(
        {
          system_id: this.config.systemId,
          password: this.config.password,
          interface_version: 0x34, // SMPP 3.4
        },
        (pdu: PDU) => this.onBindResponse(pdu),
      );
    });

    session.on("close", () => this.onSessionClose("close"));
    session.on("error", (err: unknown) => {
      logger.warn("[smpp-worker] SMPP 세션 오류", { error: toLogError(err) });
      // close 이벤트가 뒤따르므로 여기선 별도 reconnect 안 함
    });

    session.on("deliver_sm", (pdu: PDU) => {
      // SMPP 명세: deliver_sm은 반드시 ACK 응답 필요
      try {
        this.onDeliver(pdu);
      } catch (e) {
        logger.error("[smpp-worker] deliver_sm 핸들러 예외", {
          error: toLogError(e),
        });
      }
      try {
        session.send(pdu.response());
      } catch (e) {
        logger.warn("[smpp-worker] deliver_sm_resp 송신 실패", {
          error: toLogError(e),
        });
      }
    });
  }

  private onBindResponse(pdu: PDU): void {
    if (pdu.command_status === 0) {
      this.bound = true;
      this.reconnectAttempt = 0;
      logger.info("[smpp-worker] bind_transceiver 성공");
      const callbacks = this.boundCallbacks.splice(0);
      for (const cb of callbacks) cb(true);
    } else {
      logger.error(
        `[smpp-worker] bind_transceiver 거절 — command_status=0x${pdu.command_status.toString(16)}`,
      );
      const callbacks = this.boundCallbacks.splice(0);
      for (const cb of callbacks) cb(false);
      // bind 실패는 자격증명 오류 가능성이 큼 — 재접속 backoff 늘려서 회피
      this.session?.close();
    }
  }

  private onSessionClose(reason: string): void {
    const wasBound = this.bound;
    this.bound = false;
    this.session = null;

    // 윈도우 가득 대기자들에게 이벤트 흘려서 ambiguous 처리 유도
    const waiters = this.waiters.splice(0);
    for (const w of waiters) w();

    // in-flight submit 들에게 ambiguous 결과 통보 (재시도 금지 신호)
    const pending = Array.from(this.pendingSubmits);
    this.pendingSubmits.clear();
    for (const p of pending) {
      clearTimeout(p.timer);
      p.resolve({ kind: "ambiguous", reason: "disconnect" });
    }
    this.inflight = 0;

    if (this.shuttingDown) {
      logger.info("[smpp-worker] 종료 중 — 재접속 안 함");
      return;
    }

    logger.warn(`[smpp-worker] SMPP 연결 종료 (${reason}, wasBound=${wasBound})`);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.shuttingDown) return;
    this.reconnectAttempt += 1;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempt - 1, 5));
    logger.info(
      `[smpp-worker] ${delay}ms 후 재접속 시도 (attempt=${this.reconnectAttempt})`,
    );
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // submit_sm — 윈도우 제어 + timeout
  // ─────────────────────────────────────────────────────────────────────────

  /** SMPP가 현재 사용 가능한지 (bind 완료 + 종료 중 아님) */
  isReady(): boolean {
    return !!this.session && this.bound && !this.shuttingDown;
  }

  /**
   * submit_sm을 송신하고 결과를 기다린다.
   *
   * 윈도우가 가득 차면 자리가 날 때까지 await한다.
   * 응답을 timeout 안에 못 받으면 ambiguous 결과 반환 (재시도 금지).
   */
  async submit(options: SubmitSmOptions): Promise<SubmitOutcome> {
    if (!this.isReady()) {
      return { kind: "ambiguous", reason: "disconnect" };
    }

    // 윈도우 자리 확보 — gate
    while (this.inflight >= this.config.windowSize) {
      await new Promise<void>((res) => this.waiters.push(res));
      if (!this.isReady()) {
        return { kind: "ambiguous", reason: "disconnect" };
      }
    }

    this.inflight += 1;

    return new Promise<SubmitOutcome>((resolve) => {
      const session = this.session;
      if (!session) {
        this.releaseWindow();
        resolve({ kind: "ambiguous", reason: "disconnect" });
        return;
      }

      let settled = false;
      const settle = (outcome: SubmitOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.pendingSubmits.delete(pending);
        this.releaseWindow();
        resolve(outcome);
      };

      const timer = setTimeout(() => {
        logger.warn(
          `[smpp-worker] submit_sm timeout (${this.config.submitTimeoutMs}ms) dest=${options.destination_addr}`,
        );
        settle({ kind: "ambiguous", reason: "timeout" });
      }, this.config.submitTimeoutMs);

      const pending: PendingSubmit = {
        resolve: settle,
        timer,
        destinationAddr: String(options.destination_addr),
      };
      this.pendingSubmits.add(pending);

      try {
        session.submit_sm(options, (pdu: PDU) => {
          if (pdu.command_status === 0) {
            const messageId = pdu.message_id ?? "";
            if (!messageId) {
              // SMSC가 ROK인데 message_id를 안 주는 케이스 — DLR 매칭 불가
              logger.warn(
                `[smpp-worker] submit_sm_resp ok이지만 message_id 누락 dest=${options.destination_addr}`,
              );
              settle({
                kind: "rejected",
                commandStatus: -1,
                retryable: false,
              });
              return;
            }
            settle({ kind: "accepted", messageId });
          } else {
            settle({
              kind: "rejected",
              commandStatus: pdu.command_status,
              retryable: RETRYABLE_STATUSES.has(pdu.command_status),
            });
          }
        });
      } catch (e) {
        logger.error("[smpp-worker] submit_sm 송신 예외", {
          error: toLogError(e),
        });
        settle({ kind: "ambiguous", reason: "disconnect" });
      }
    });
  }

  private releaseWindow(): void {
    this.inflight = Math.max(0, this.inflight - 1);
    const waiter = this.waiters.shift();
    if (waiter) waiter();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 종료
  // ─────────────────────────────────────────────────────────────────────────

  async shutdown(timeoutMs = 10_000): Promise<void> {
    this.shuttingDown = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // in-flight submit이 끝날 때까지 잠시 대기
    const start = Date.now();
    while (this.inflight > 0 && Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 100));
    }

    const session = this.session;
    if (session && this.bound) {
      await new Promise<void>((res) => {
        try {
          session.unbind(() => res());
        } catch {
          res();
        }
      });
    }

    if (session) {
      try {
        session.close();
      } catch {
        // ignore
      }
    }

    // 남아있는 pending들에게 disconnect 통보
    const pending = Array.from(this.pendingSubmits);
    this.pendingSubmits.clear();
    for (const p of pending) {
      clearTimeout(p.timer);
      p.resolve({ kind: "ambiguous", reason: "disconnect" });
    }
  }
}
