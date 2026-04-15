/**
 * 메시지 템플릿에서 {이름}, {별명} 변수를 치환합니다.
 */
export function substituteVars(
  template: string,
  vars: { name?: string | null; nickname?: string | null }
): string {
  return template
    .replace(/\{이름\}/g, vars.name || "")
    .replace(/\{별명\}/g, vars.nickname || "");
}

/**
 * 템플릿 문자열에서 사용된 변수 목록을 추출합니다.
 */
export function extractPlaceholders(template: string): string[] {
  const matches = template.match(/\{[^}]+\}/g);
  return matches ? [...new Set(matches)] : [];
}
