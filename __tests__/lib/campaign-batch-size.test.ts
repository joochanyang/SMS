import { describe, it, expect } from 'vitest';
import { getProviderByName } from '@/lib/sms-providers/router';

describe('프로바이더별 maxBatchSize', () => {
  it('TXG 프로바이더는 SMPP 워커 전담이므로 직접 배치 발송을 차단한다', async () => {
    const provider = getProviderByName('txg');
    await expect(provider.sendBatch([{ to: '+821012345678', text: 'test' }]))
      .rejects
      .toThrow('TXG는 SMPP 워커가 단독 처리합니다');
  });

  it('SMS.to 프로바이더는 200 이하 (통신사 throttling 준수)', () => {
    const provider = getProviderByName('smsto');
    expect(provider.maxBatchSize).toBeLessThanOrEqual(200);
  });

  it('Infobip 프로바이더는 200 이하 (기존 유지)', () => {
    const provider = getProviderByName('infobip');
    expect(provider.maxBatchSize).toBeLessThanOrEqual(200);
  });
});

describe('campaign-processor 배치 크기 제한', () => {
  it('SMS_POLICY.maxBatchSize 상수는 더 이상 프로바이더 배치 상한으로 쓰이지 않는다', async () => {
    // campaign-processor.ts 소스를 직접 검사해서 SMS_POLICY.maxBatchSize 의존이 provider별 상한으로 대체됐는지 확인.
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('lib/campaign-processor.ts', 'utf8');
    // 배치 clamp 라인에서 SMS_POLICY.maxBatchSize 가 아닌 provider.maxBatchSize 를 사용해야 한다.
    // maxRetries 용도는 그대로 유지 가능.
    const clampSection = src.slice(src.indexOf('effectiveBatchSize'), src.indexOf('FOR UPDATE SKIP LOCKED'));
    expect(clampSection).toContain('providerMaxBatch');
  });
});
