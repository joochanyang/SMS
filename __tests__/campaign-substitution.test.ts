import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * 치환모드 + 길이 정책 테스트
 * ---------------------------------------------------------------------------
 * 대상 변경 사항 (PLAN-2026-04-17 § 5.1):
 *   1. recipientsWithVars + 빈 vars → 빈 문자열 치환
 *   2. 치환 후 길이가 1파트 한도 초과 ~ concat 한도 이하 → 발송 통과 + warnings[]
 *   3. 치환 후 길이가 concat 한도 초과 → 해당 수신자만 skipped[] + 나머지 발송
 *   4. 모든 수신자가 길이 초과 → 400 에러
 *   5. 수동 입력(주소록 X) + 치환모드 → 빈 vars로 정상 처리
 *   6. /process 라우트 응답에 campaign 상태 포함
 *
 * 모킹 정책 (deterministic):
 *   - next-auth: 항상 `userId=test-user`로 인증된 세션 반환
 *   - prisma: in-memory 동작 (실제 DB 미접근)
 *   - api-rate-limit: 항상 통과
 *   - blacklist 조회: 항상 빈 Set
 *   - SMS provider: 호출 안 됨 (캠페인 생성까지만 검증, 실제 발송은 process 라우트의 책임)
 */

// ---------------------------------------------------------------------------
// 모킹 인프라
// ---------------------------------------------------------------------------

const mockSession = { user: { id: 'test-user-id' } };

// 캠페인 생성 시 사용된 SmsLog 인자를 캡처하는 컨테이너
type CapturedCreate = {
  campaign?: any;
  smsLogs?: any[];
  transaction?: any;
  ledger?: any;
};
const captured: CapturedCreate = {};

// process 라우트용: campaign-processor 모킹 결과 제어
const processorState = {
  result: { sentCount: 0, failedCount: 0, status: 'SENDING' as string, hasMore: false },
  campaign: null as null | {
    id: string;
    status: string;
    processedCount: number;
    totalRecipients: number;
    failedCount: number;
    deliveredCount: number;
  },
  shouldThrow: null as null | Error,
};

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(async () => mockSession),
}));

vi.mock('@/lib/auth', () => ({
  authOptions: {} as any,
}));

vi.mock('@/lib/api-rate-limit', () => ({
  withRateLimit: vi.fn(async () => ({ allowed: true })),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  toLogError: (e: unknown) => ({ message: e instanceof Error ? e.message : String(e) }),
}));

// Prisma 모킹: 캠페인 생성에 필요한 최소한만 구현
vi.mock('@/lib/prisma', () => {
  const tx = {
    user: {
      findUnique: vi.fn(async () => ({
        id: 'test-user-id',
        credits: 1_000_000,
        status: 'ACTIVE',
        maxCampaignSize: 10_000,
        dailySendLimit: 10_000,
      })),
      update: vi.fn(async () => ({ credits: 999_000 })),
    },
    smsLog: {
      count: vi.fn(async () => 0),
      createMany: vi.fn(async (args: any) => {
        captured.smsLogs = args.data;
        return { count: args.data.length };
      }),
    },
    smsCampaign: {
      create: vi.fn(async (args: any) => {
        captured.campaign = {
          id: 'test-campaign-id',
          ...args.data,
        };
        return captured.campaign;
      }),
    },
    transaction: {
      create: vi.fn(async (args: any) => {
        captured.transaction = args.data;
        return args.data;
      }),
    },
    creditLedger: {
      create: vi.fn(async (args: any) => {
        captured.ledger = args.data;
        return args.data;
      }),
    },
    blacklist: {
      findMany: vi.fn(async () => []),
    },
    systemSetting: {
      findUnique: vi.fn(async () => null),
    },
  };

  const prisma = {
    user: {
      findUnique: vi.fn(async () => ({
        id: 'test-user-id',
        costPerMessage: 14,
      })),
    },
    smsCampaign: {
      findUnique: vi.fn(async () => processorState.campaign),
    },
    blacklist: {
      findMany: vi.fn(async () => []),
    },
    systemSetting: {
      findUnique: vi.fn(async () => null),
    },
    $transaction: vi.fn(async (fn: any) => fn(tx)),
  };

  return { prisma };
});

vi.mock('@/lib/campaign-processor', () => {
  class CampaignProcessError extends Error {
    code: string;
    meta?: any;
    constructor(message: string, code: string, meta?: any) {
      super(message);
      this.code = code;
      this.meta = meta;
      this.name = 'CampaignProcessError';
    }
  }
  return {
    CampaignProcessError,
    processCampaignBatch: vi.fn(async () => {
      if (processorState.shouldThrow) throw processorState.shouldThrow;
      return processorState.result;
    }),
  };
});

// ---------------------------------------------------------------------------
// 테스트 헬퍼
// ---------------------------------------------------------------------------

function makeRequest(body: any, url = 'http://localhost/api/sms/campaign'): NextRequest {
  return {
    headers: new Headers({ 'content-type': 'application/json' }),
    nextUrl: new URL(url),
    json: async () => body,
  } as unknown as NextRequest;
}

function makeProcessRequest(): NextRequest {
  return {
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({}),
  } as unknown as NextRequest;
}

// ---------------------------------------------------------------------------
// 테스트
// ---------------------------------------------------------------------------

describe('POST /api/sms/campaign — 치환모드 길이 정책', () => {
  beforeEach(() => {
    captured.campaign = undefined;
    captured.smsLogs = undefined;
    captured.transaction = undefined;
    captured.ledger = undefined;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('1. recipientsWithVars 의 {이름} 이 정상 치환되고, vars 누락은 빈 문자열로 치환된다', async () => {
    const { POST } = await import('@/app/api/sms/campaign/route');

    const req = makeRequest({
      message: '{이름}님 안녕하세요',
      recipients: [],
      recipientsWithVars: [
        { phone: '+821011112222', name: '홍길동' },
        { phone: '+821033334444' }, // name 없음 → 빈 문자열로 치환되어야 함
      ],
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.campaignId).toBe('test-campaign-id');
    expect(data.totalRecipients).toBe(2);
    expect(data.skipped).toBeUndefined();
    expect(data.warnings).toBeUndefined();

    expect(captured.smsLogs).toBeDefined();
    expect(captured.smsLogs!.length).toBe(2);

    const byPhone = new Map<string, any>(
      captured.smsLogs!.map((log: any) => [log.targetNumber, log]),
    );
    expect(byPhone.get('+821011112222')!.messageBody).toBe('홍길동님 안녕하세요');
    // vars 없는 수신자 → {이름} 이 빈 문자열로 치환되어 "님 안녕하세요" 가 되어야 함
    expect(byPhone.get('+821033334444')!.messageBody).toBe('님 안녕하세요');
    expect(byPhone.get('+821033334444')!.messageBody).not.toContain('{이름}');
  });

  it('2. 치환 후 메시지가 1파트 한도 이하면 warnings/skipped 없이 통과한다', async () => {
    const { POST } = await import('@/app/api/sms/campaign/route');

    const req = makeRequest({
      message: '{이름}님 환영합니다', // UCS-2, 짧음
      recipients: [],
      recipientsWithVars: [{ phone: '+821011112222', name: '홍' }],
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.skipped).toBeUndefined();
    expect(data.warnings).toBeUndefined();
    expect(captured.smsLogs!.length).toBe(1);
  });

  it('3. 치환 후 길이가 maxCharsPerSms 초과 + concat 한도 이하 → warnings 포함하여 통과', async () => {
    const { POST } = await import('@/app/api/sms/campaign/route');

    // UCS-2 70자 초과 / 670자(=67*10) 이하 → 분할 과금 경고 대상
    // {이름} (3자) + 100자 본문 = 치환 후 약 100자 (이름 = 3자라고 가정)
    const longBody = '가'.repeat(150); // 150자 (UCS-2 70 초과, 670 이하)
    const req = makeRequest({
      message: `{이름}${longBody}`,
      recipients: [],
      recipientsWithVars: [{ phone: '+821011112222', name: '홍길동' }],
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.skipped).toBeUndefined();
    expect(Array.isArray(data.warnings)).toBe(true);
    expect(data.warnings.length).toBe(1);
    expect(data.warnings[0].phone).toBe('+821011112222');
    expect(data.warnings[0].parts).toBeGreaterThan(1);
    expect(data.warnings[0].length).toBeGreaterThan(70);
  });

  it('4. 치환 후 concat 한도 초과 수신자는 skipped[] 로 분리되고, 나머지는 발송 + SmsLog 생성 안 됨', async () => {
    const { POST } = await import('@/app/api/sms/campaign/route');

    // 한 명은 길이 통과, 한 명은 치환 결과가 concat 한도(UCS-2 670자) 초과로 스킵되도록 구성
    const req = makeRequest({
      message: '{이름}님 안녕하세요', // 짧은 템플릿
      recipients: [],
      recipientsWithVars: [
        { phone: '+821011112222', name: '단' }, // 치환 결과 짧음 → 통과
        { phone: '+821033334444', name: '나'.repeat(700) }, // 치환 결과 700+ 자 → 스킵
      ],
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(Array.isArray(data.skipped)).toBe(true);
    expect(data.skipped.length).toBe(1);
    expect(data.skipped[0].phone).toBe('+821033334444');
    expect(data.skipped[0].reason).toBe('TOO_LONG');
    expect(data.skipped[0].length).toBeGreaterThan(670);
    expect(data.totalRecipients).toBe(1);

    // SmsLog 는 길이 통과한 한 명만 생성되어야 한다
    expect(captured.smsLogs).toBeDefined();
    expect(captured.smsLogs!.length).toBe(1);
    const targetPhones = captured.smsLogs!.map((log: any) => log.targetNumber);
    expect(targetPhones).toContain('+821011112222');
    expect(targetPhones).not.toContain('+821033334444');
  });

  it('5. 수신자 전원이 길이 초과 시 400 + 한국어 에러 메시지 + 캠페인 미생성', async () => {
    const { POST } = await import('@/app/api/sms/campaign/route');

    const req = makeRequest({
      message: '{이름}',
      recipients: [],
      recipientsWithVars: [
        { phone: '+821011112222', name: '나'.repeat(700) },
        { phone: '+821033334444', name: '다'.repeat(700) },
      ],
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(typeof data.error).toBe('string');
    expect(data.error).toMatch(/치환|초과|길이/); // 한국어 에러 메시지
    expect(Array.isArray(data.skipped)).toBe(true);
    expect(data.skipped.length).toBe(2);

    // 캠페인이 생성되지 않아야 한다
    expect(captured.campaign).toBeUndefined();
    expect(captured.smsLogs).toBeUndefined();
  });

  it('6. substitutionMode 만 ON (주소록 X, 수동 입력) — 빈 vars 로도 정상 처리', async () => {
    const { POST } = await import('@/app/api/sms/campaign/route');

    // 프론트가 substitutionMode + 수동입력 시 보내는 페이로드 (name/nickname 빈 문자열)
    const req = makeRequest({
      message: '{이름}님께 알립니다',
      recipients: [],
      recipientsWithVars: [
        { phone: '+821011112222', name: '', nickname: '' },
        { phone: '+821033334444', name: '', nickname: '' },
      ],
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.totalRecipients).toBe(2);
    expect(captured.smsLogs!.length).toBe(2);

    // 빈 문자열 치환 결과: '{이름}' → '' 이므로 본문이 "님께 알립니다"
    for (const log of captured.smsLogs!) {
      expect(log.messageBody).toBe('님께 알립니다');
      expect(log.messageBody).not.toContain('{이름}');
    }
  });
});

describe('POST /api/sms/campaign/[id]/process — 응답 형태', () => {
  beforeEach(() => {
    processorState.result = {
      sentCount: 5,
      failedCount: 0,
      status: 'SENDING',
      hasMore: true,
    };
    processorState.campaign = {
      id: 'test-campaign-id',
      status: 'SENDING',
      processedCount: 5,
      totalRecipients: 10,
      failedCount: 0,
      deliveredCount: 5,
    };
    processorState.shouldThrow = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('7. process 응답에 { campaign: {...} } 가 포함되고 핵심 필드를 모두 포함한다', async () => {
    const { POST } = await import('@/app/api/sms/campaign/[id]/process/route');

    const req = makeProcessRequest();
    const res = await POST(req, { params: Promise.resolve({ id: 'test-campaign-id' }) });
    const data = await res.json();

    expect(res.status).toBe(200);

    // 폴링 통합용 campaign 필드 (PLAN [F])
    expect(data.campaign).toBeDefined();
    expect(data.campaign.id).toBe('test-campaign-id');
    expect(data.campaign.status).toBe('SENDING');
    expect(data.campaign.processedCount).toBe(5);
    expect(data.campaign.totalRecipients).toBe(10);
    expect(data.campaign.failedCount).toBe(0);
    expect(data.campaign.deliveredCount).toBe(5);

    // processCampaignBatch 결과도 함께 포함되어야 한다
    expect(data.sentCount).toBe(5);
    expect(data.hasMore).toBe(true);
  });

  it('7-b. campaign 조회가 null 이어도 throw 하지 않고 campaign: null 로 응답한다', async () => {
    processorState.campaign = null;
    const { POST } = await import('@/app/api/sms/campaign/[id]/process/route');

    const req = makeProcessRequest();
    const res = await POST(req, { params: Promise.resolve({ id: 'unknown-id' }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.campaign).toBeNull();
    // 결과 필드는 살아있어야 함
    expect(data).toHaveProperty('sentCount');
  });
});
