import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TxgProvider } from '@/lib/sms-providers/txg';

describe('TxgProvider.sendBatch — pushurl 주입', () => {
  const ORIGINAL_ENV = { ...process.env };
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.TXG_ACCOUNT = 'test-account';
    process.env.TXG_PASSWORD = 'test-password';
    process.env.TXG_BASE_URL = 'http://txg.test';
    process.env.TXG_DLR_WEBHOOK_URL = 'https://example.com/api/txg/report';

    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 0,
        success: 1,
        fail: 0,
        array: [['+821011112222', 12345]],
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  it('TXG_DLR_WEBHOOK_URL이 설정되면 단일 본문 요청에 pushurl 포함', async () => {
    const provider = new TxgProvider();
    await provider.sendBatch([{ to: '+821011112222', text: 'hi' }]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.pushurl).toBe('https://example.com/api/txg/report');
  });

  it('TXG_DLR_WEBHOOK_URL이 설정되면 다중 본문 요청에도 pushurl 포함', async () => {
    const provider = new TxgProvider();
    await provider.sendBatch([
      { to: '+821011112222', text: 'a' },
      { to: '+821033334444', text: 'b' },
    ]);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.pushurl).toBe('https://example.com/api/txg/report');
  });

  it('TXG_DLR_WEBHOOK_URL이 없으면 pushurl 미포함', async () => {
    delete process.env.TXG_DLR_WEBHOOK_URL;
    const provider = new TxgProvider();
    await provider.sendBatch([{ to: '+821011112222', text: 'hi' }]);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.pushurl).toBeUndefined();
  });
});
