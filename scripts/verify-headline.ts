/** 목록의 대표 유통기한 줄이 '단일 로트'를 가리키는지 검증 (거점 합산 버그 회귀 방지) */
import 'dotenv/config'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../src/generated/prisma/client'
import { getStockRows } from '../src/lib/inventory'
import { formatDate } from '../src/lib/date'

const db = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./prisma/dev.db' }),
})

let bad = 0

async function main() {
  const rows = await getStockRows()

  for (const r of rows) {
    if (!r.headline) continue
    const h = r.headline
    const loc = await db.location.findFirst({ where: { name: h.locationName } })
    const lot = await db.lot.findFirst({
      where: { productId: r.productId, locationId: loc!.id, expiryDate: h.expiryDate },
    })
    const ok = lot?.quantity === h.qty
    if (!ok) bad++
    console.log(
      `${ok ? '✅' : '❌'} ${r.name.padEnd(22)} 화면 "${h.locationName} ${h.qty}개" / 실제 로트 ${lot?.quantity}개  (${formatDate(h.expiryDate)})`
    )
  }
  console.log(bad === 0 ? '\n전부 단일 로트와 일치 — 버그 해결' : `\n불일치 ${bad}건`)
}
main()
  .catch((e) => {
    console.error(e)
    bad++
  })
  .finally(async () => {
    await db.$disconnect()
    if (bad > 0) process.exitCode = 1
  })
