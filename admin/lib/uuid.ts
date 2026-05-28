// 브라우저 Web Crypto 의 randomUUID 는 Secure Context(HTTPS / localhost)
// 에서만 정의된다. admin 패널을 HTTP + 공인 IP 로 노출하는 동안에도
// 멱등성 키 생성이 동작해야 하므로 폴리필을 제공한다.
// 서버 측 코드는 Node 'crypto' 를 그대로 쓰면 되므로 이 모듈은
// 브라우저(client component) 전용으로만 가져다 쓴다.

export function randomUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // RFC4122 v4 — crypto.getRandomValues 는 HTTP 환경에서도 정의된다.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}
