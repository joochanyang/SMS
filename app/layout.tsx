import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Global Mass SMS - Sovereign",
  description: "Secure, fast, and reliable mass SMS platform.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
