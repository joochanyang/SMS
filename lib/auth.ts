import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "./prisma";
import bcrypt from "bcryptjs";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "아이디", type: "text", placeholder: "아이디를 입력하세요" },
        password: { label: "비밀번호", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials.password) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { username: credentials.username }
        });

        if (!user) {
          return null;
        }

        // S-11: 정지/차단 유저 로그인 차단
        if (user.status !== "ACTIVE") {
          return null;
        }

        // S-12: 로그인 실패 잠금 확인
        if (user.lockedUntil && new Date() < user.lockedUntil) {
          return null;
        }

        const isPasswordValid = await bcrypt.compare(credentials.password, user.passwordHash)

        if (!isPasswordValid) {
          // S-12: 실패 횟수 증가 + 5회 이상 시 15분 잠금
          const newCount = (user.failedLoginCount || 0) + 1;
          await prisma.user.update({
            where: { id: user.id },
            data: {
              failedLoginCount: newCount,
              ...(newCount >= 5 ? { lockedUntil: new Date(Date.now() + 15 * 60 * 1000) } : {}),
            },
          });
          return null;
        }

        // 로그인 성공: 실패 카운터 초기화
        if (user.failedLoginCount > 0 || user.lockedUntil) {
          await prisma.user.update({
            where: { id: user.id },
            data: { failedLoginCount: 0, lockedUntil: null },
          });
        }

        return {
          id: user.id,
          email: user.username,
          name: user.name || user.username,
        };
      }
    })
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.sub as string;
      }
      return session;
    }
  },
  pages: {
    signIn: "/login",
  },
};
