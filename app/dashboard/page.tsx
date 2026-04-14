import { redirect } from 'next/navigation';

export default function DashboardRedirect() {
  // 사용자가 루트 대시보드로 접근하면 즉시 문자 발송 페이지로 리다이렉트합니다.
  redirect('/dashboard/sms-send');
}
