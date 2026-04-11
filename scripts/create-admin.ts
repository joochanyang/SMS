import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
  })
  console.log('Connecting to:', process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':***@'))
  const adapter = new PrismaPg(pool)
  const prisma = new PrismaClient({ adapter })

  // 기존 admin이 있으면 삭제
  await prisma.user.deleteMany({ where: { username: 'admin' } })

  const hash = await bcrypt.hash('asd123', 12)
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
