import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 환경변수와 모듈 캐시를 초기화하기 위해 동적 import 사용
// NODE_ENV 는 Node 22+ 에서 readonly 라 vi.stubEnv 로 우회 (afterEach 의 vi.unstubAllEnvs 가 정리)
async function getLogger(logLevel?: string, nodeEnv?: string) {
  if (logLevel !== undefined) vi.stubEnv('LOG_LEVEL', logLevel);
  else vi.stubEnv('LOG_LEVEL', '');

  if (nodeEnv !== undefined) vi.stubEnv('NODE_ENV', nodeEnv);
  else vi.stubEnv('NODE_ENV', '');

  // 모듈 캐시 제거 후 재import
  const mod = await import('../../lib/logger');
  return mod.logger;
}

describe('logger', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('info 호출 시 console.log를 사용한다', async () => {
    const logger = await getLogger('debug');
    logger.info('테스트 메시지');
    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain('테스트 메시지');
  });

  it('warn 호출 시 console.warn을 사용한다', async () => {
    const logger = await getLogger('debug');
    logger.warn('경고 메시지');
    expect(warnSpy).toHaveBeenCalled();
    const output = warnSpy.mock.calls[0][0] as string;
    expect(output).toContain('경고 메시지');
  });

  it('error 호출 시 console.error를 사용한다', async () => {
    const logger = await getLogger('debug');
    logger.error('에러 메시지');
    expect(errorSpy).toHaveBeenCalled();
    const output = errorSpy.mock.calls[0][0] as string;
    expect(output).toContain('에러 메시지');
  });

  it('LOG_LEVEL=error이면 info는 출력되지 않는다', async () => {
    const logger = await getLogger('error');
    logger.info('무시될 메시지');
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('LOG_LEVEL=error이면 warn도 출력되지 않는다', async () => {
    const logger = await getLogger('error');
    logger.warn('무시될 경고');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('LOG_LEVEL=error이면 error는 출력된다', async () => {
    const logger = await getLogger('error');
    logger.error('에러만 출력');
    expect(errorSpy).toHaveBeenCalled();
  });

  it('LOG_LEVEL=warn이면 info는 출력되지 않는다', async () => {
    const logger = await getLogger('warn');
    logger.info('무시될 메시지');
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('LOG_LEVEL=warn이면 warn과 error는 출력된다', async () => {
    const logger = await getLogger('warn');
    logger.warn('경고');
    logger.error('에러');
    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('LOG_LEVEL 미설정 시 기본값 info: debug는 무시, info는 출력', async () => {
    const logger = await getLogger(undefined);
    logger.debug('디버그 무시');
    expect(logSpy).not.toHaveBeenCalled();

    logger.info('인포 출력');
    expect(logSpy).toHaveBeenCalled();
  });

  it('context가 포함되면 출력에 태그가 표시된다', async () => {
    const logger = await getLogger('debug');
    logger.info('컨텍스트 테스트', { context: 'campaign' });
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain('[campaign]');
  });

  it('error 데이터가 포함되면 에러 메시지가 표시된다', async () => {
    const logger = await getLogger('debug');
    logger.error('에러 발생', { error: { message: '테스트 에러' } });
    const output = errorSpy.mock.calls[0][0] as string;
    expect(output).toContain('테스트 에러');
  });

  it('production 환경에서는 JSON 형식으로 출력한다', async () => {
    const logger = await getLogger('debug', 'production');
    logger.info('프로덕션 로그');
    const output = logSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.level).toBe('info');
    expect(parsed.message).toBe('프로덕션 로그');
    expect(parsed.timestamp).toBeDefined();
  });
});
