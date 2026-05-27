/**
 * 무헤더 엑셀(A=번호, B=이름)을 N건씩 잘라 주소록으로 적재.
 *
 * 사용 예:
 *   npx tsx scripts/import-address-book-chunks.ts \
 *     --file "/Users/mr.joo/Desktop/스마/원피.xlsx" \
 *     --prefix 원피 \
 *     --user-id cmntvm0q1000039aktjxrp50p \
 *     --dry-run
 *
 * --dry-run 빼면 실제 적재.
 * 본인 번호 3개는 각 청크 맨 앞에 자동으로 들어감 (MY_CONTACTS).
 */
import 'dotenv/config';
import * as XLSX from 'xlsx';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const MY_CONTACTS = [
  { phone: '01028855838', name: '김무석' },
  { phone: '01083658229', name: '박진우' },
  { phone: '01029155838', name: '김만구' },
];

type Args = {
  file: string;
  prefix: string;
  userId: string;
  chunkSize: number;
  dryRun: boolean;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const out: Partial<Args> = { chunkSize: 1000, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--file':
        out.file = next;
        i++;
        break;
      case '--prefix':
        out.prefix = next;
        i++;
        break;
      case '--user-id':
        out.userId = next;
        i++;
        break;
      case '--chunk-size':
        out.chunkSize = Number(next);
        i++;
        break;
      case '--dry-run':
        out.dryRun = true;
        break;
      default:
        console.error(`알 수 없는 옵션: ${a}`);
        process.exit(1);
    }
  }
  if (!out.file || !out.prefix || !out.userId) {
    console.error('필수 옵션 누락: --file, --prefix, --user-id');
    process.exit(1);
  }
  if (!Number.isFinite(out.chunkSize!) || out.chunkSize! <= 0) {
    console.error('--chunk-size 는 양의 정수');
    process.exit(1);
  }
  return out as Args;
}

function cleanPhone(raw: string): string {
  const t = raw.trim();
  if (t.startsWith('+')) return '+' + t.slice(1).replace(/[^0-9]/g, '');
  return t.replace(/[^0-9]/g, '');
}

function isValidPhone(raw: string): boolean {
  const c = cleanPhone(raw);
  if (/^\+\d{7,15}$/.test(c)) return true;
  if (/^\d{7,15}$/.test(c)) return true;
  return false;
}

type Row = { phone: string; name: string };

function readSource(file: string): Row[] {
  const wb = XLSX.readFile(file);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) {
    console.error(`첫 시트를 읽을 수 없음: ${file}`);
    process.exit(1);
  }
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    raw: false,
  });

  const rows: Row[] = [];
  for (const r of aoa) {
    if (!Array.isArray(r)) continue;
    const phoneRaw = r[0] != null ? String(r[0]) : '';
    const nameRaw = r[1] != null ? String(r[1]) : '';
    const phone = cleanPhone(phoneRaw);
    if (!isValidPhone(phone)) continue;
    rows.push({ phone, name: nameRaw.trim() });
  }
  return rows;
}

async function main() {
  const args = parseArgs();

  console.log(`[1/4] 원본 읽는 중: ${args.file}`);
  const rows = readSource(args.file);
  console.log(`     유효 행: ${rows.length}건`);

  const chunkCount = Math.ceil(rows.length / args.chunkSize);
  console.log(
    `[2/4] 청크 계획: ${chunkCount}개 (청크당 ${args.chunkSize}건 + 본인 ${MY_CONTACTS.length}건 = ${args.chunkSize + MY_CONTACTS.length}건)`,
  );

  const plan: { bookName: string; contacts: { phone: string; name: string }[] }[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const slice = rows.slice(i * args.chunkSize, (i + 1) * args.chunkSize);
    const bookName = `${args.prefix}${(i + 1) * args.chunkSize}`;
    const contacts = [...MY_CONTACTS, ...slice];
    plan.push({ bookName, contacts });
  }

  console.log('     주소록 명세:');
  for (const p of plan) {
    console.log(`       - ${p.bookName}: ${p.contacts.length}건`);
  }

  if (args.dryRun) {
    console.log('[dry-run] DB 변경 없이 종료.');
    return;
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
  });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    console.log(`[3/4] DB 확인: userId=${args.userId}`);
    const user = await prisma.user.findUnique({
      where: { id: args.userId },
      select: { id: true, username: true, name: true },
    });
    if (!user) {
      console.error(`     ❌ userId ${args.userId}가 존재하지 않음`);
      process.exit(1);
    }
    console.log(`     ✓ ${user.username} (${user.name})`);

    console.log(`[4/4] 주소록 + 연락처 적재 시작`);
    let createdBooks = 0;
    let createdContacts = 0;

    for (const p of plan) {
      const book = await prisma.addressBook.create({
        data: { userId: args.userId, name: p.bookName },
      });
      createdBooks++;

      await prisma.contact.createMany({
        data: p.contacts.map((c) => ({
          addressBookId: book.id,
          phone: c.phone,
          name: c.name || null,
        })),
      });
      createdContacts += p.contacts.length;
      console.log(
        `     ✓ ${p.bookName} → ${p.contacts.length}건 적재 (누적 ${createdBooks}/${plan.length})`,
      );
    }

    console.log(`\n✅ 완료: 주소록 ${createdBooks}개, 총 ${createdContacts}건`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('스크립트 실패:', err);
  process.exit(1);
});
