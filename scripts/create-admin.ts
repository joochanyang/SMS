import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'

async function main() {
  const password = process.argv[2]
  if (!password || password.length < 8) {
    console.error('사용법: npx tsx scripts/create-admin.ts <비밀번호>')
    console.error('비밀번호는 최소 8자 이상이어야 합니다.')
    process.exit(1)
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
  })
  console.log('Connecting to:', process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':***@'))
  const adapter = new PrismaPg(pool)
  const prisma = new PrismaClient({ adapter })

  // 기존 admin이 있으면 삭제
  await prisma.user.deleteMany({ where: { username: 'admin' } })

  const hash = await bcrypt.hash(password, 12)
  const user = await prisma.user.create({
    data: {
      username: 'admin',
      passwordHash: hash,
      name: '관리자',
    }
  })
  console.log('admin 계정 생성 완료:', user.id, user.username)
  await prisma.$disconnect()
  await pool.end()
}

main().catch(console.error)
