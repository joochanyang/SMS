@../CLAUDE.md

# 관리자 패널 추가 규칙

## 이 앱은 유저 앱과 별도의 Next.js 앱이다
- 포트: 3001 (dev)
- 인증: 세션 쿠키 기반 (NextAuth 아님)
- RBAC: SUPER_ADMIN > ADMIN > SUPPORT > VIEWER
- Prisma 공유: `@shared/prisma` (부모 디렉토리의 prisma 사용)

## 한국어 규칙 (부모 CLAUDE.md 상속)
모든 UI, API 에러 메시지, placeholder, 버튼 텍스트를 한국어로 작성한다.
영어 텍스트가 포함된 코드를 발견하면 즉시 한국어로 수정한다.
