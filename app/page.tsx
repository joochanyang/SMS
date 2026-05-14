'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Activity,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Globe2,
  LockKeyhole,
  LogIn,
  MessageSquareText,
  RadioTower,
  ShieldCheck,
  UploadCloud,
  WalletCards,
} from 'lucide-react';
import styles from './page.module.css';

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0 },
};

const routeRows = [
  { country: 'Korea', route: 'Direct', status: 'Delivered', time: '0.8s' },
  { country: 'Japan', route: 'Tier 1', status: 'Queued', time: '1.4s' },
  { country: 'Singapore', route: 'Direct', status: 'Delivered', time: '0.9s' },
];

const capabilities = [
  {
    icon: RadioTower,
    label: 'Global Routing',
    title: '190개국 직접 라우팅',
    description: '국가별 우선 경로와 장애 우회 정책으로 캠페인 지연을 줄입니다.',
  },
  {
    icon: UploadCloud,
    label: 'Bulk Operation',
    title: '대량 발송에 맞춘 워크플로',
    description: 'CSV 업로드, 중복 제거, 예약 발송까지 한 화면에서 처리합니다.',
  },
  {
    icon: ShieldCheck,
    label: 'Delivery Report',
    title: '전달 결과를 끝까지 추적',
    description: '발송, 대기, 실패, 재시도 상태를 실시간 리포트로 확인합니다.',
  },
];

const stats = [
  { value: '99.9%', label: '전달 안정성' },
  { value: '190+', label: '지원 국가' },
  { value: '24/7', label: '라우팅 모니터링' },
];

export default function Home() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="SovereignSMS 홈">
          <span className={styles.brandMark}>
            <Globe2 size={20} strokeWidth={2.1} />
          </span>
          <span>SovereignSMS</span>
        </Link>

        <nav className={styles.nav} aria-label="주요 메뉴">
          <a href="#pricing">요금</a>
          <a href="#features">기능</a>
          <Link href="/dashboard/sms-send">대시보드</Link>
        </nav>

        <Link href="/login" className={styles.loginButton}>
          <LogIn size={17} />
          <span>로그인</span>
        </Link>
      </header>

      <main>
        <section className={styles.hero}>
          <motion.div
            className={styles.heroCopy}
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            transition={{ duration: 0.55, ease: 'easeOut' }}
          >
            <div className={styles.eyebrow}>
              <span className={styles.liveDot} />
              Enterprise SMS Gateway
            </div>

            <h1>대량 문자 발송을 조용하고 정확하게 운영합니다.</h1>

            <p className={styles.heroText}>
              마케팅, 알림, 인증 문자를 한 곳에서 관리하세요. 국가별 라우팅,
              발송 상태, 충전 흐름까지 운영자가 보는 화면에 맞춰 정돈했습니다.
            </p>

            <div className={styles.actions}>
              <Link href="/register" className={styles.primaryAction}>
                <span>무료로 시작하기</span>
                <ArrowRight size={18} />
              </Link>
              <Link href="/login" className={styles.secondaryAction}>
                <span>계정으로 접속</span>
              </Link>
            </div>

            <div className={styles.assurance}>
              <span>
                <CheckCircle2 size={16} />
                CSV 대량 업로드
              </span>
              <span>
                <CheckCircle2 size={16} />
                실시간 전달 추적
              </span>
              <span>
                <CheckCircle2 size={16} />
                USDT 충전 지원
              </span>
            </div>
          </motion.div>

          <motion.div
            className={styles.console}
            initial={{ opacity: 0, y: 22, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.65, delay: 0.12, ease: 'easeOut' }}
            aria-label="문자 발송 운영 콘솔 미리보기"
          >
            <div className={styles.consoleTop}>
              <div>
                <span className={styles.consoleKicker}>Campaign ready</span>
                <strong>Global Notice 05</strong>
              </div>
              <span className={styles.secureBadge}>
                <LockKeyhole size={14} />
                Secured
              </span>
            </div>

            <div className={styles.messagePreview}>
              <div className={styles.messageIcon}>
                <MessageSquareText size={21} />
              </div>
              <div>
                <span>발송 메시지</span>
                <p>[SovereignSMS] 예약된 캠페인이 정상 접수되었습니다.</p>
              </div>
            </div>

            <div className={styles.consoleGrid}>
              <div className={styles.signalPanel}>
                <div className={styles.panelHeader}>
                  <span>Route Health</span>
                  <Activity size={16} />
                </div>
                <div className={styles.signalBars} aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
                <div className={styles.signalMeta}>
                  <strong>99.91%</strong>
                  <span>last 24h</span>
                </div>
              </div>

              <div className={styles.walletPanel}>
                <div className={styles.panelHeader}>
                  <span>Balance</span>
                  <WalletCards size={16} />
                </div>
                <strong>1,284 USDT</strong>
                <p>예상 42,800건 발송 가능</p>
              </div>
            </div>

            <div className={styles.routeTable}>
              <div className={styles.routeHead}>
                <span>국가</span>
                <span>경로</span>
                <span>상태</span>
                <span>응답</span>
              </div>
              {routeRows.map((row) => (
                <div className={styles.routeRow} key={row.country}>
                  <span>{row.country}</span>
                  <span>{row.route}</span>
                  <span className={row.status === 'Delivered' ? styles.good : styles.waiting}>
                    {row.status}
                  </span>
                  <span>{row.time}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </section>

        <section className={styles.statsStrip} aria-label="서비스 주요 지표">
          {stats.map((item) => (
            <div key={item.label}>
              <strong>{item.value}</strong>
              <span>{item.label}</span>
            </div>
          ))}
        </section>

        <section className={styles.section} id="features">
          <div className={styles.sectionHeading}>
            <span>Built for operators</span>
            <h2>필요한 기능만 선명하게 남겼습니다.</h2>
          </div>

          <div className={styles.featureGrid}>
            {capabilities.map((item) => {
              const Icon = item.icon;

              return (
                <article
                  className={styles.featureCard}
                  key={item.title}
                >
                  <div className={styles.featureIcon}>
                    <Icon size={22} />
                  </div>
                  <span>{item.label}</span>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className={styles.workflow}>
          <div>
            <span className={styles.workflowLabel}>Campaign flow</span>
            <h2>번호 업로드부터 결과 확인까지 흐름이 끊기지 않습니다.</h2>
          </div>

          <div className={styles.flowLine}>
            <div>
              <UploadCloud size={19} />
              <span>CSV 정리</span>
            </div>
            <div>
              <RadioTower size={19} />
              <span>라우팅 선택</span>
            </div>
            <div>
              <MessageSquareText size={19} />
              <span>캠페인 발송</span>
            </div>
            <div>
              <BarChart3 size={19} />
              <span>결과 분석</span>
            </div>
          </div>
        </section>

        <section className={styles.pricing} id="pricing">
          <div>
            <span>Transparent operation</span>
            <h2>운영 규모에 맞춰 바로 시작하세요.</h2>
          </div>
          <Link href="/register" className={styles.pricingAction}>
            계정 만들기
            <ArrowRight size={18} />
          </Link>
        </section>
      </main>
    </div>
  );
}
