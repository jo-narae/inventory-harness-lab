/** M1 검증: 시드가 만든 상태가 기획 문서의 요구와 맞는지 확인 */
import 'dotenv/config'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../src/generated/prisma/client'
import { daysUntil, formatDate } from '../src/lib/date'
import { TRANSIT_DELAY_DAYS } from '../src/lib/constants'

const db = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./prisma/dev.db' }),
})

let failed = 0
let drifted = 0

/** 게이트 판정 — 코드·데이터 불변식. 실패하면 exit 1 */
const ok = (b: boolean) => {
  if (!b) failed++
  return b ? '✅' : '❌'
}

/**
 * 시드 시점 기준 판정 — 오늘 날짜에 따라 결과가 바뀌므로 exit code 에 반영하지 않는다.
 * 예) 시드는 발송일을 8·4·2일 전으로 넣는데 지연 기준이 7일이라, 시드 3일 뒤면 지연이 2건이 된다.
 * 코드 회귀가 아니라 시드가 낡은 것이므로 `npm run seed:reset` 으로 되돌린다.
 */
const drift = (b: boolean) => {
  if (!b) drifted++
  return b ? '✅' : '⚠️'
}

async function main() {
  // 1) Lot 수량 = Movement 합계 (불변식)
  const lots = await db.lot.findMany()
  const movements = await db.movement.findMany()
  let mismatch = 0
  for (const lot of lots) {
    const inQty = movements
      .filter(
        (m) =>
          m.toLocationId === lot.locationId &&
          m.productId === lot.productId &&
          m.expiryDate.getTime() === lot.expiryDate.getTime()
      )
      .reduce((s, m) => s + m.quantity, 0)
    const outQty = movements
      .filter(
        (m) =>
          m.fromLocationId === lot.locationId &&
          m.productId === lot.productId &&
          m.expiryDate.getTime() === lot.expiryDate.getTime()
      )
      .reduce((s, m) => s + m.quantity, 0)
    if (inQty - outQty !== lot.quantity) mismatch++
  }
  console.log(`${ok(mismatch === 0)} 불변식: Lot 수량 = 이동 기록 합계 (불일치 ${mismatch}건)`)

  // 2) 로트 분리 — 같은 상품에 유통기한이 다르면 다른 로트
  const cheese = await db.product.findFirst({ where: { sku: 'DOG-CHEESE-200' } })
  const cheeseLots = await db.lot.findMany({
    where: { productId: cheese!.id, quantity: { gt: 0 } },
    include: { location: true },
    orderBy: { expiryDate: 'asc' },
  })
  console.log(`${ok(cheeseLots.length >= 3)} 로트 분리: 치즈 간식이 ${cheeseLots.length}개 로트로 나뉨`)
  for (const l of cheeseLots) {
    console.log(
      `     ${formatDate(l.expiryDate)}  ${l.location.name.padEnd(10)} ${String(l.quantity).padStart(4)}개  (${daysUntil(l.expiryDate)}일)`
    )
  }

  // 3) 임박 · 만료
  const all = await db.lot.findMany({ where: { quantity: { gt: 0 } }, include: { product: true } })
  const expired = all.filter((l) => daysUntil(l.expiryDate) < 0)
  const soon = all.filter((l) => {
    const dd = daysUntil(l.expiryDate)
    return dd >= 0 && dd <= l.product.expiryAlertDays
  })
  console.log(`${drift(expired.length >= 2)} 만료 재고 ${expired.length}건 / ${drift(soon.length >= 3)} 임박 재고 ${soon.length}건`)

  // 4) 배송 중 · 지연
  const sent = await db.transfer.findMany({ where: { status: 'SENT' }, include: { toLocation: true } })
  const delayed = sent.filter(
    (t) => (Date.now() - t.sentAt.getTime()) / 86400000 >= TRANSIT_DELAY_DAYS
  )
  console.log(`${ok(sent.length === 3)} 배송 중 ${sent.length}건 / ${drift(delayed.length === 1)} 지연(7일+) ${delayed.length}건`)

  // 5) 풀필먼트 반영일
  const ffs = await db.location.findMany({ where: { type: 'FULFILLMENT' } })
  const stale = ffs.filter(
    (f) => !f.lastReflectedAt || new Date().toDateString() !== f.lastReflectedAt.toDateString()
  )
  console.log(`${drift(stale.length === 1)} 오늘 미반영 풀필먼트 ${stale.length}곳 (${stale.map((s) => s.name).join(', ')})`)

  // 6) 팝업 누적 반출
  const popup = await db.popup.findFirst({ where: { status: 'ACTIVE' } })
  const outs = await db.movement.findMany({ where: { popupId: popup!.id, type: 'POPUP_OUT' } })
  const total = outs.reduce((s, m) => s + m.quantity, 0)
  console.log(`${ok(total === 160)} 팝업 누적 반출 ${total}개 (${outs.length}건 = 1차+2차)`)

  // 7) 가용 재고 (배송 중·팝업 제외)
  const avail = await db.lot.aggregate({
    _sum: { quantity: true },
    where: { quantity: { gt: 0 }, location: { type: { in: ['OWN', 'FULFILLMENT'] } } },
  })
  const totalAll = await db.lot.aggregate({ _sum: { quantity: true } })
  console.log(
    `✅ 총 재고 ${totalAll._sum.quantity} = 가용 ${avail._sum.quantity} + 배송중·팝업 ${totalAll._sum.quantity! - avail._sum.quantity!}`
  )
}
main()
  .then(() => {
    if (failed > 0) console.error(`\n검증 실패 ${failed}건`)
    else console.log('\n불변식 전부 통과')
    if (drifted > 0) {
      console.warn(`⚠️  시드 기준 항목 ${drifted}건이 오늘 날짜와 어긋남 — \`npm run seed:reset\` 후 다시 확인`)
    }
  })
  .catch((e) => {
    console.error(e)
    failed++
  })
  .finally(async () => {
    await db.$disconnect()
    if (failed > 0) process.exitCode = 1
  })
