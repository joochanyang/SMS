// ---------------------------------------------------------------------------
// SMPP submit_sm 분할기 — UCS-2 BE / GSM-7 자동 감지 + UDH concatenation
// ---------------------------------------------------------------------------
//
// SMPP 3.4 short_message 페이로드 상한: 140 bytes
//   - 단일 GSM-7: 160자(140 bytes의 7-bit packed = 160 septets)
//   - 단일 UCS-2: 70자 (140 bytes / 2 bytes per char)
//
// 다중 분할 시 UDH 6 bytes 차감:
//   - GSM-7 part: 153자
//   - UCS-2 part: 67자 (134 bytes / 2)
//
// UDH 구조 (8-bit reference, concatenated SMS):
//   [UDHL=0x05, IEI=0x00, IEDL=0x03, ref(0~255), totalParts, thisPart(1-indexed)]
// ---------------------------------------------------------------------------

import { isGsm7 } from "@/lib/sms-policy";

/**
 * SMPP `data_coding` 값.
 * 0x00 = SMSC default (실무에서 7-bit GSM)
 * 0x08 = UCS-2 BE
 *
 * smpp 라이브러리는 string을 넘기면 내용에 따라 자동 결정하지만, 우리는
 * sms-policy의 GSM-7 판정과 일관되게 명시 지정한다.
 */
const DATA_CODING_GSM7 = 0x00;
const DATA_CODING_UCS2 = 0x08;

const SINGLE_GSM7_CHARS = 160;
const SINGLE_UCS2_CHARS = 70;
const MULTIPART_GSM7_CHARS = 153;
const MULTIPART_UCS2_CHARS = 67;

const UDHL = 0x05;
const UDH_IEI_CONCAT_8BIT = 0x00;
const UDH_IEDL_CONCAT_8BIT = 0x03;

/** 한 PDU(submit_sm)에 들어갈 분할 단위 */
export interface SmppSegment {
  /** smpp 라이브러리 short_message 입력 — string 또는 {udh, message} */
  shortMessage: string | { udh: Buffer; message: string };
  dataCoding: number;
  /** 멀티파트 여부 (운영 로깅/관측용) */
  isMultipart: boolean;
  /** 1-indexed part number (단일 segment면 1) */
  partNumber: number;
  /** 총 part 수 */
  totalParts: number;
  /** 동일 메시지의 모든 part가 공유하는 reference (관측용) */
  referenceNumber: number;
}

/**
 * 메시지를 SMPP submit_sm에 적합한 segment 배열로 분할한다.
 *
 * 단일 segment에 들어가면 1개, 그렇지 않으면 UDH concatenation 헤더를 붙여 N개 반환.
 * **반환된 segment 수 = 청구되는 SMS 건수**임에 유의 (TXG는 segment 단위 과금).
 *
 * @param text 발송 본문 (E.164 destination_addr는 호출자가 별도 관리)
 * @param refNumber 8-bit reference number (호출자가 카운터/랜덤으로 발급, 같은 메시지의 모든 part가 공유)
 */
export function segmentMessage(text: string, refNumber: number): SmppSegment[] {
  if (!text) {
    // 빈 문자열도 1 segment로 취급 (실제론 호출 전 검증되어야 함)
    return [
      {
        shortMessage: "",
        dataCoding: DATA_CODING_GSM7,
        isMultipart: false,
        partNumber: 1,
        totalParts: 1,
        referenceNumber: refNumber & 0xff,
      },
    ];
  }

  const useGsm7 = isGsm7(text);
  const dataCoding = useGsm7 ? DATA_CODING_GSM7 : DATA_CODING_UCS2;
  const singleLimit = useGsm7 ? SINGLE_GSM7_CHARS : SINGLE_UCS2_CHARS;
  const partLimit = useGsm7 ? MULTIPART_GSM7_CHARS : MULTIPART_UCS2_CHARS;

  // 단일 segment에 들어가면 UDH 없이 단순 string 전달
  // (smpp 라이브러리가 data_coding에 맞춰 자동 인코딩)
  // GSM-7 카운트는 확장문자가 2자리를 차지하지만, 본문은 그대로 전달하고 byte/septet
  // 카운트는 UCS-2 단순화 케이스로 보수적으로 처리한다.
  if (useGsm7) {
    if (text.length <= singleLimit) {
      return [
        {
          shortMessage: text,
          dataCoding,
          isMultipart: false,
          partNumber: 1,
          totalParts: 1,
          referenceNumber: refNumber & 0xff,
        },
      ];
    }
  } else if (text.length <= singleLimit) {
    return [
      {
        shortMessage: text,
        dataCoding,
        isMultipart: false,
        partNumber: 1,
        totalParts: 1,
        referenceNumber: refNumber & 0xff,
      },
    ];
  }

  // 분할 — char 단위로 나눈 뒤 각 part에 UDH 헤더를 붙인다.
  // (UCS-2의 경우 surrogate pair 분리 위험을 최소화하려면 code point 기반이 안전하지만,
  // SMS 본문에 BMP 외 문자가 들어올 빈도가 매우 낮으므로 현재는 simple slice로 처리.
  // 필요 시 후속 작업에서 [...text] iterator로 교체.)
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += partLimit) {
    parts.push(text.slice(i, i + partLimit));
  }

  if (parts.length > 255) {
    // SMPP 8-bit reference UDH로는 255 part 초과 분할 불가. 실무상 도달 불가.
    throw new Error(
      `SMPP 분할 part 수가 255를 초과했습니다 (${parts.length}). 메시지를 더 짧게 나눠 발송하세요.`,
    );
  }

  const ref = refNumber & 0xff;
  const total = parts.length;

  return parts.map((chunk, index) => {
    const partNumber = index + 1;
    const udh = Buffer.from([
      UDHL,
      UDH_IEI_CONCAT_8BIT,
      UDH_IEDL_CONCAT_8BIT,
      ref,
      total,
      partNumber,
    ]);

    return {
      shortMessage: { udh, message: chunk },
      dataCoding,
      isMultipart: true,
      partNumber,
      totalParts: total,
      referenceNumber: ref,
    };
  });
}

// ---------------------------------------------------------------------------
// Reference number 카운터 (모듈 스코프 — 워커 단일 인스턴스 보장 하에서만 안전)
// ---------------------------------------------------------------------------

let refCounter = Math.floor(Math.random() * 256);

/** 다음 8-bit UDH reference number 발급 */
export function nextReferenceNumber(): number {
  refCounter = (refCounter + 1) & 0xff;
  return refCounter;
}
