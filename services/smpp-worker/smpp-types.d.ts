// ---------------------------------------------------------------------------
// `smpp` (npm) 패키지 — 공식 타입 정의가 없으므로 사용 영역만 최소 선언
// ---------------------------------------------------------------------------
//
// 라이브러리 위치: node_modules/smpp/lib/smpp.js
// SMPP v5.0 호환 (v3.4 backward 호환)
// ---------------------------------------------------------------------------

declare module "smpp" {
  import { EventEmitter } from "events";

  export interface PDU {
    command: string;
    command_status: number;
    sequence_number: number;
    /** submit_sm_resp 응답 — TXG가 발급한 메시지 ID */
    message_id?: string;
    /** deliver_sm 본문 (DLR 또는 MO). data_coding에 따라 string/Buffer 모두 가능 */
    short_message?:
      | string
      | Buffer
      | { udh?: Buffer; message: string | Buffer };
    /** deliver_sm 발신자 (DLR의 경우 SMSC, MO의 경우 sender). DLR 매칭에는 사용하지 않음 */
    source_addr?: string;
    /** deliver_sm 수신자 (원래 destination_addr) */
    destination_addr?: string;
    /** ESM Class — bit 2 (0x04) 가 set이면 delivery receipt */
    esm_class?: number;
    /** 일부 SMSC가 명시 제공하는 receipted message ID (TLV 0x001E) */
    receipted_message_id?: string;
    /** TLV — 일부 SMSC가 제공하는 메시지 상태 (TLV 0x0427) */
    message_state?: number;
    /** 송신 시 사용 PDU 응답 객체 생성 */
    response(options?: Record<string, unknown>): PDU;
    isResponse(): boolean;
  }

  export interface SubmitSmOptions {
    destination_addr: string;
    source_addr?: string;
    short_message: string | Buffer | { udh?: Buffer; message: string | Buffer };
    data_coding?: number;
    esm_class?: number;
    registered_delivery?: number;
    /** 4.5 schema 그 외 추가 필드 */
    [key: string]: unknown;
  }

  export interface BindOptions {
    system_id: string;
    password: string;
    system_type?: string;
    interface_version?: number;
    addr_ton?: number;
    addr_npi?: number;
    address_range?: string;
  }

  export interface ConnectOptions {
    url?: string;
    host?: string;
    port?: number;
    auto_enquire_link_period?: number;
    /** 자동 reconnect는 사용하지 않음 — 우리가 직접 backoff로 관리 */
    [key: string]: unknown;
  }

  export class Session extends EventEmitter {
    bind_transceiver(
      options: BindOptions,
      callback: (pdu: PDU) => void,
    ): void;
    bind_transmitter(
      options: BindOptions,
      callback: (pdu: PDU) => void,
    ): void;
    bind_receiver(
      options: BindOptions,
      callback: (pdu: PDU) => void,
    ): void;
    submit_sm(
      options: SubmitSmOptions,
      callback: (pdu: PDU) => void,
    ): void;
    enquire_link(callback?: (pdu: PDU) => void): void;
    unbind(callback?: (pdu: PDU) => void): void;
    send(pdu: PDU, responseCallback?: (pdu: PDU) => void): void;
    close(callback?: () => void): void;
    destroy(callback?: () => void): void;
    pause(): void;
    resume(): void;
  }

  export function connect(
    options: ConnectOptions | string,
    listener?: () => void,
  ): Session;

  export const ESME_ROK: number;
  export const ESME_RTHROTTLED: number;
  export const ESME_RMSGQFUL: number;
  export const ESME_RBINDFAIL: number;
}
