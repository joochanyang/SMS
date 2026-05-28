# 🌐 Global Mass SMS Platform: Perfect Work Plan
## (Full-Stack TypeScript & Next.js Edition)

This document serves as the authoritative implementation guide for the "Global Mass SMS" platform. We will leverage the latest **Next.js 14+ (App Router)** ecosystem to provide a premium, fintech-grade experience with uncompromised performance.

---

## 1. Core Project Vision
A unified communication platform where security meets aesthetics. We aim for a **"Fintech Sovereign"** look: dark, clean, professional, and blazingly fast.

- **Objective:** Enable global multi-channel messaging (starting with SMS) via Infobip connectivity.
- **Key Promise:** 99.9% delivery tracking visibility, intuitive bulk management, and secure financial transactions.

---

## 2. Technical Stack (The "Modern Gold Standard")

### **Frontend & Framework**
- **Next.js (App Router):** Unified frontend/backend architecture with Server Components for fast initial loads.
- **TypeScript:** Strict type-safety across the entire data flow.
- **Styles:** **Vanilla CSS (Custom Design System)**.
    - Using CSS Variables for a centralized theme (Slate & Emerald).
    - Flex/Grid-based layouts for high responsiveness.
- **Animations:** **Framer Motion** for premium micro-interactions and transitions.

### **Backend & Database**
- **DB:** **PostgreSQL** (Hosted via Supabase or Neon for scalability).
- **ORM:** **Prisma** (End-to-end type safety from DB to Client).
- **Authentication:** **NextAuth.js** (Credential-based + Social login if needed).
- **Validation:** **Zod** (Schema validation for API requests and forms).

### **Messaging & Integration**
- **Provider:** **Infobip Node.js SDK**.
- **Real-time:** **Webhooks API** for incoming delivery reports.
- **File Processing:** **PapaParse** (Fast CSV parsing for bulk contacts).

---

## 3. System Architecture & Directory Structure

```text
├── app/                  # Next.js App Router (Pages & API)
│   ├── (auth)/           # Login, Register, Password Reset
│   ├── (dashboard)/      # Protected Dashboard Routes
│   │   ├── sms-send/     # Bulk & Single Send Page
│   │   ├── history/      # Logs & Tracking
│   │   └── wallet/       # Credits & Billing
│   └── api/              # Infobip Integration & Webhooks
├── components/           # UI Atoms/Molecules (Vanilla CSS)
├── lib/                  # Shared Utilities (Infobip Client, Prisma)
├── styles/               # Global CSS & Design Tokens
├── types/                # Shared TS Interfaces
└── prisma/               # Database Schema
```

---

## 4. Key Feature Deep-Dive

### A. Mass Sending Engine
- **Logic:** Batching logic to process 1,000+ numbers from CSV without blocking the main thread.
- **Infobip Integration:** Utilizing `POST /sms/2/text/advanced` to minimize API calls.
- **Feedback:** Real-time progress bar using Server-Sent Events (SSE) or polling.

### B. Fintech Visualization (Analytics)
- **Dashboard:** At-a-glance delivery rates, cost charts, and country distribution.
- **Tracking:** Clickable logs that drill down to individual message status (Sent → Received → Delivered).

### C. Credit & Wallet Logic
- **Prepaid System:** Users buy "Credits". Each country has a specific "Weight" (Cost per message).
- **Transaction Safety:** Atomic DB transactions to ensure credits are deducted only when API dispatch starts.

---

## 5. UI/UX Design Tokens (The Sovereign Theme)

| Token | Value | Sentiment |
| :--- | :--- | :--- |
| **Primary (Brand)** | `emerald-500` (#10B981) | Success, Money, Global |
| **Secondary** | `slate-400` (#94A3B8) | Professionalism, Data |
| **Background** | `slate-950` (#020617) | Depth, Focus |
| **Surface** | `slate-900` (#0F172A) | Elevated areas (Cards, Nav) |
| **Border** | `slate-800` / 0.5 opacity | Glassmorphism subtle separation |

- **Glassmorphism:** `backdrop-filter: blur(12px)` for headers and modal overlays.
- **Typography:** **Inter** for UI control, **Noto Sans KR** for content readability.

---

## 6. Implementation Timeline (Fast-Track)

### **Phase 1: Foundation (Days 1-3)**
- Project scaffolding (Next.js + TS + Prisma).
- Base CSS Design Tokens implementation.
- Infobip Client initialization.

### **Phase 2: Authentication & Wallet (Days 4-7)**
- Secure login system.
- Wallet credit logic & Payment history views.
- Admin panel for credit assignment.

### **Phase 3: Messaging Engine (Days 8-12)**
- Bulk SMS sending (CSV upload).
- Single SMS dispatch UI.
- Webhook listener for Real-time tracking (Infobip callback).

### **Phase 4: Analytics & Polish (Days 13-15)**
- Interactive charts (Recharts or Chart.js).
- UI/UX polish (Animations, Loading States).
- Final security audit (API rate limiting, Input sanitization).

---

## 7. Next Steps Checklist
- [ ] Initialize GitHub Repository.
- [ ] Configure Environment Variables (`INFOBIP_API_KEY`, `DATABASE_URL`).
- [ ] Setup Prisma Schema for `User`, `SmsLog`, `Transaction`.
- [ ] **Begin Implementation of Main Landing Component.**

---
> [!NOTE]
> 본 계획서는 **고급 핀테크 디자인**과 **엔터프라이즈급 안정성**에 초점을 맞추어 작성되었습니다.
