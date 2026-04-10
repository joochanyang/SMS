import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SovereignSMS Admin',
  description: 'SovereignSMS 관리자 패널',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
