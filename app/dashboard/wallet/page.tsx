import { redirect } from 'next/navigation';

export default function WalletRedirect() {
  // 중간 지갑 허브 페이지를 생략하고 즉시 USDT 충전 페이지로 넘깁니다.
  redirect('/dashboard/wallet/usdt');
}
