import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import argon2 from 'argon2'

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
  })
  const adapter = new PrismaPg(pool)
  const prisma = new PrismaClient({ adapter })

  const hash = await argon2.hash('asd123', {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  })

  // 기존 admin이 있으면 비밀번호 업데이트, 없으면 생성
  const existing = await prisma.adminUser.findUnique({ where: { username: 'admin' } })

  if (existing) {
    await prisma.adminUser.update({
      where: { id: existing.id },
      data: {
        passwordHash: hash,
        failedLoginCount: 0,
        status: 'ACTIVE',
        lockedUntil: null,
      }
    })
    console.log('AdminUser 비밀번호 업데이트 완료:', existing.id, existing.username)
  } else {
    const admin = await prisma.adminUser.create({
      data: {
        username: 'admin',
        passwordHash: hash,
        name: '관리자',
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        passwordChangedAt: new Date(),
        previousPasswords: [hash],
      }
    })
    console.log('AdminUser 생성 완료:', admin.id, admin.username, admin.role)
  }
  await prisma.$disconnect()
  await pool.end()
}

main().catch(console.error)
