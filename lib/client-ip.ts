/**
 * 클라이언트 IP 추출 공용 유틸.
 *
 * X-Forwarded-For: [client, proxy1, proxy2] 순으로 쌓임.
 * - 'claimed' : 첫 번째 IP (원본 클라이언트 주장 — 감사/로그용)
 * - 'trusted' : 마지막 IP (직속 리버스 프록시가 추가한 값 — rate limit용, 위조 방지)
 */

export type IpMode = 'claimed' | 'trusted';

interface HeaderReader {
  headers: { get(name: string): string | null };
}

export function getClientIp(req: HeaderReader, mode: IpMode = 'trusted'): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const ips = forwarded.split(',').map((ip) => ip.trim()).filter(Boolean);
    if (ips.length > 0) {
      return mode === 'trusted' ? ips[ips.length - 1] : ips[0];
    }
  }
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return 'unknown';
}
