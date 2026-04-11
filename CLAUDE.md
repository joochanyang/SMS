@AGENTS.md

# SovereignSMS 프로젝트 규칙

## 언어 규칙 (최우선)

**모든 사용자 대면 텍스트는 100% 한국어로 작성한다.**

- UI 텍스트 (버튼, 라벨, 제목, 설명, placeholder, 에러 메시지, 상태 표시)
- 주석, 커밋 메시지, 문서
- API 에러 응답 메시지 (`{ error: "한국어 메시지" }`)
- 유일한 예외: 브랜드명(SovereignSMS), 기술 용어(GSM-7, UCS-2, E.164, CUID), 라이브러리/프레임워크명

### 금지 패턴
```
❌ "Unauthorized" → ✅ "인증이 필요합니다."
❌ "Loading..." → ✅ "로딩 중..."
❌ "Submit" → ✅ "제출"
❌ "Campaign created" → ✅ "캠페인이 생성되었습니다."
❌ placeholder="Enter your email" → ✅ placeholder="이메일을 입력하세요"
```

### UI 용어 사전
| 영어 | 한국어 |
|------|--------|
| Dashboard | 대시보드 |
| Sign In / Login | 로그인 |
| Sign Out / Logout | 로그아웃 |
| Sign Up / Register | 회원가입 |
| Search | 검색 |
| Submit | 제출 |
| Save | 저장 |
| Cancel | 취소 |
| Delete | 삭제 |
| Confirm | 확인 |
| Edit / Update | 수정 |
| Add / Create | 추가 / 생성 |
| Back | 뒤로 |
| Loading | 로딩 중 |
| Error | 오류 |
| Success | 성공 |
| Users | 유저 관리 |
| Campaigns | 캠페인 관리 |
| Credits | 크레딧 |
| Wallet | 지갑 |
| Blacklist | 블랙리스트 |
| Templates | 템플릿 |
| Audit Log | 감사 로그 |
| Settings | 설정 |
| Refund | 환불 |
| Approve | 승인 |
| Reject | 거절 |
| Pending | 대기 중 |
| Completed | 완료 |
| Failed | 실패 |
| Delivered | 전달 완료 |
| Send / Dispatch | 발송 |
| Recipients | 수신자 |
| Message | 메시지 |
| Status | 상태 |
| Amount | 금액 |
| Reason | 사유 |
| Kill Switch | 긴급 중지 |
| MFA | 2단계 인증 |
| Password | 비밀번호 |
| Email | 이메일 |
| Name | 이름 |
| Role | 역할 |
| Active | 활성 |
| Suspended | 정지 |
| Banned | 차단 |
| Cost | 비용 |
| Balance | 잔액 |
| Top Up | 충전 |
| Transaction | 거래 |
| History | 내역 |
| Coupon | 쿠폰 |

## 기술 스택

- **프레임워크**: Next.js 16.2.3 (App Router, Turbopack)
- **React**: 19.x
- **ORM**: Prisma 7.7 + @prisma/adapter-pg
- **DB**: PostgreSQL 16 (Hetzner 5.161.112.248:5434)
- **인증 (유저)**: NextAuth.js 4.x (credentials, JWT)
- **인증 (관리자)**: 세션 쿠키 + RBAC + MFA (TOTP)
- **SMS 발송**: Infobip (@infobip-api/sdk)
- **스타일**: Vanilla CSS (글래스모피즘 다크 테마)
- **Proxy**: Next.js 16에서 middleware → proxy.ts로 변경됨

## 프로젝트 구조

```
sms문자사이트/
├── app/                  # 유저 앱 (포트 3000)
│   ├── api/              # 유저 API
│   ├── dashboard/        # 대시보드 페이지
│   ├── login/            # 로그인
│   └── register/         # 회원가입
├── admin/                # 관리자 앱 (포트 3001)
│   ├── app/api/          # 관리자 API
│   └── app/              # 관리자 페이지
├── lib/                  # 공유 라이브러리
│   ├── sms-policy.ts     # SMS 정책 (GSM-7/UCS-2 감지, 글자수 제한)
│   ├── prisma.ts         # Prisma 클라이언트
│   ├── auth.ts           # NextAuth 설정
│   └── infobip.ts        # Infobip 클라이언트
├── prisma/schema.prisma  # DB 스키마
└── proxy.ts              # Next.js 16 프록시 (인증 게이트)
```

## SMS 발송 규칙

- **글로벌 발송** (한국 국내법 적용 안함)
- **인코딩 자동 감지**: 영문만 = GSM-7 (160자), 한글/이모지 = UCS-2 (70자)
- **글자수 초과 차단**: 1건 초과 시 API 400 에러 + UI 발송 버튼 비활성화
- **번호 형식**: E.164 (+821012345678)
- **블랙리스트**: 캠페인 생성 시 + 발송 시 이중 체크, 차단 건 자동 환불

## Next.js 16 주의사항

- `middleware.ts` → `proxy.ts`로 변경됨 (함수명도 `proxy`)
- `node_modules/next/dist/docs/`에서 최신 API 문서 확인 필수
- 훈련 데이터와 다를 수 있으므로 항상 문서 우선
