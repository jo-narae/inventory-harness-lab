/**
 * 목업 데이터 — 강아지 간식
 *
 * 두 가지 원칙으로 만든다.
 *
 * 1) 재고를 만들 때 앱과 '같은 함수'를 쓴다.
 *    로트를 손으로 지정하지 않고 applyMovement + allocateLots를 통과시키므로,
 *    시드가 앱의 규칙(FEFO / LEFO / 음수 재고 금지)을 어길 수 없다.
 *
 * 2) 사건을 '시간 순서대로' 실행한다.
 *    95일 전 입고 → 85일 전 발송 → … → 어제 반영.
 *    그래야 그 시점에 없던 로트가 선택되는 일이 생기지 않는다.
 *
 * 목표: 시드 직후 모든 화면에 보여줄 것이 있어야 한다.
 *       (임박·만료 재고 / 지연된 배송 / 미반영 풀필먼트 / 정산 대기 팝업)
 */
import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../src/generated/prisma/client'
import { applyMovement } from '../src/lib/stock'
import { ALLOCATION, allocateLots } from '../src/lib/fefo'
import { addDays, today } from '../src/lib/date'
import { LOCATION_TYPES, MOVEMENT_TYPES, POPUP_STATUS, TRANSFER_STATUS } from '../src/lib/constants'

const url = process.env.DATABASE_URL ?? 'file:./prisma/dev.db'
const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) })

const T = today()
const d = (offset: number) => addDays(T, offset) // 유통기한
const ago = (days: number, hour = 10) => {
  const x = new Date()
  x.setDate(x.getDate() - days)
  x.setHours(hour, 0, 0, 0)
  return x
}

type Ref = { id: number }

async function main() {
  console.log('▸ 기존 데이터 삭제')
  await db.movement.deleteMany()
  await db.transferLine.deleteMany()
  await db.transfer.deleteMany()
  await db.popupPlan.deleteMany()
  await db.popup.deleteMany()
  await db.lot.deleteMany()
  await db.product.deleteMany()
  await db.location.deleteMany()
  await db.user.deleteMany()

  // ★ 자동 증가 번호까지 초기화한다.
  //   이걸 안 하면 시드를 다시 돌릴 때마다 ID가 밀려서
  //   - 열어둔 브라우저의 로그인 쿠키가 없는 사용자를 가리키고 (외래키 오류)
  //   - /products/1 같은 주소가 404가 된다.
  //   강의 중 seed:reset을 눌러도 화면과 링크가 그대로여야 한다.
  for (const table of [
    'User', 'Product', 'Location', 'Lot', 'Movement',
    'Transfer', 'TransferLine', 'Popup', 'PopupPlan',
  ]) {
    await db.$executeRawUnsafe(`DELETE FROM sqlite_sequence WHERE name = '${table}'`)
  }

  // ───────── 사용자
  const hash = await bcrypt.hash('demo1234', 10)
  const warehouse = await db.user.create({
    data: { email: 'warehouse@demo.kr', name: '이현', passwordHash: hash, role: 'ADMIN' },
  })
  const sales = await db.user.create({
    data: { email: 'sales@demo.kr', name: '민수', passwordHash: hash, role: 'MEMBER' },
  })

  // ───────── 거점
  const own = await db.location.create({ data: { name: '자사창고', type: LOCATION_TYPES.OWN } })
  const ffA = await db.location.create({
    data: { name: '풀필먼트 A', type: LOCATION_TYPES.FULFILLMENT, lastReflectedAt: ago(0, 9) },
  })
  const ffB = await db.location.create({
    data: { name: '풀필먼트 B', type: LOCATION_TYPES.FULFILLMENT, lastReflectedAt: ago(0, 9) },
  })
  const ffC = await db.location.create({
    data: { name: '풀필먼트 C', type: LOCATION_TYPES.FULFILLMENT, lastReflectedAt: ago(3, 9) },
  })
  const transit = await db.location.create({ data: { name: '배송 중', type: LOCATION_TYPES.TRANSIT } })
  await db.location.create({ data: { name: '폐기', type: LOCATION_TYPES.DISPOSAL } })

  // ───────── 상품 12종
  const P = await Promise.all(
    (
      [
        ['DOG-CHEESE-200', '강아지 치즈 간식 200g', 60],
        ['DOG-MILKGUM-M', '강아지 우유껌 M', 60],
        ['DOG-DUCKNECK-5', '오리목뼈 껌 5p', 90],
        ['DOG-JERKY-100', '닭가슴살 저키 100g', 45],
        ['DOG-SWEETPOTATO-150', '고구마 말랭이 150g', 60],
        ['DOG-SALMON-80', '연어 트릿 80g', 45],
        ['DOG-BEEF-120', '소고기 육포 120g', 60],
        ['DOG-CHICKSTICK-10', '치킨 스틱 10p', 30],
        ['DOG-VEGAN-STRAWBERRY-40', '비건쿠키 딸기 40g', 60],
        ['DOG-VEGAN-CARROT-40', '비건쿠키 당근 40g', 60],
        ['DOG-VEGAN-BLUEBERRY-40', '비건쿠키 블루베리 40g', 60],
        ['DOG-VEGAN-SWEETPOTATO-40', '비건쿠키 고구마 40g', 60],
      ] as [string, string, number][]
    ).map(([sku, name, alert]) =>
      db.product.create({ data: { sku, name, expiryAlertDays: alert } })
    )
  )
  const [cheese, milkgum, duckneck, jerky, sweetpotato, salmon, beef, chickstick] = P
  const [veganStrawberry, veganCarrot, veganBlueberry, veganSweetpotato] = P.slice(8)

  // ───────── 헬퍼 — 전부 applyMovement / allocateLots를 통과한다
  type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0]
  const tx = <T>(fn: (t: Tx) => Promise<T>) => db.$transaction(fn)

  /** 입고 — 유통기한을 직접 지정하는 유일한 동작 (박스에 적힌 것을 읽는 것이므로) */
  const inbound = (product: Ref, expiry: Date, qty: number, daysAgo: number) =>
    tx((t) =>
      applyMovement(t, {
        type: MOVEMENT_TYPES.INBOUND,
        reason: 'PURCHASE',
        productId: product.id,
        expiryDate: expiry,
        quantity: qty,
        toLocationId: own.id,
        userId: warehouse.id,
        createdAt: ago(daysAgo),
      })
    )

  /** 출고 — FEFO. 임박분부터 나간다 */
  const outbound = (
    product: Ref,
    qty: number,
    daysAgo: number,
    reason: 'SALE' | 'SAMPLE' | 'DAMAGE',
    user = warehouse
  ) =>
    tx(async (t) => {
      const plan = await allocateLots(t, {
        productId: product.id,
        locationId: own.id,
        quantity: qty,
        strategy: ALLOCATION.FEFO,
      })
      for (const a of plan) {
        await applyMovement(t, {
          type: MOVEMENT_TYPES.OUTBOUND,
          reason,
          productId: product.id,
          expiryDate: a.expiryDate,
          quantity: a.qty,
          fromLocationId: own.id,
          userId: user.id,
          createdAt: ago(daysAgo),
        })
      }
    })

  /** 풀필먼트 발송 — LEFO. 기한이 넉넉한 로트를 보낸다 */
  const transfer = async (
    dest: Ref,
    lines: { product: Ref; qty: number }[],
    sentDaysAgo: number,
    receivedDaysAgo: number | null
  ) => {
    const t0 = await db.transfer.create({
      data: {
        fromLocationId: own.id,
        toLocationId: dest.id,
        status: receivedDaysAgo === null ? TRANSFER_STATUS.SENT : TRANSFER_STATUS.RECEIVED,
        sentAt: ago(sentDaysAgo),
        receivedAt: receivedDaysAgo === null ? null : ago(receivedDaysAgo),
        sentById: warehouse.id,
        receivedById: receivedDaysAgo === null ? null : warehouse.id,
      },
    })

    for (const line of lines) {
      await tx(async (t) => {
        const plan = await allocateLots(t, {
          productId: line.product.id,
          locationId: own.id,
          quantity: line.qty,
          strategy: ALLOCATION.LEFO, // ★ 발송은 출고와 반대
        })
        for (const a of plan) {
          await t.transferLine.create({
            data: {
              transferId: t0.id,
              productId: line.product.id,
              expiryDate: a.expiryDate,
              sentQty: a.qty,
              receivedQty: receivedDaysAgo === null ? null : a.qty,
            },
          })
          await applyMovement(t, {
            type: MOVEMENT_TYPES.TRANSFER,
            productId: line.product.id,
            expiryDate: a.expiryDate,
            quantity: a.qty,
            fromLocationId: own.id,
            toLocationId: transit.id,
            transferId: t0.id,
            userId: warehouse.id,
            createdAt: ago(sentDaysAgo),
          })
          if (receivedDaysAgo !== null) {
            await applyMovement(t, {
              type: MOVEMENT_TYPES.TRANSFER,
              productId: line.product.id,
              expiryDate: a.expiryDate,
              quantity: a.qty,
              fromLocationId: transit.id,
              toLocationId: dest.id,
              transferId: t0.id,
              userId: warehouse.id,
              createdAt: ago(receivedDaysAgo),
            })
          }
        }
      })
    }
    return t0
  }

  /** 풀필먼트 일일 출고 반영 — FEFO */
  const ffOut = (location: Ref, product: Ref, qty: number, daysAgo: number) =>
    tx(async (t) => {
      const plan = await allocateLots(t, {
        productId: product.id,
        locationId: location.id,
        quantity: qty,
        strategy: ALLOCATION.FEFO,
      })
      for (const a of plan) {
        await applyMovement(t, {
          type: MOVEMENT_TYPES.OUTBOUND,
          reason: 'SALE',
          note: '풀필먼트 일일 반영',
          productId: product.id,
          expiryDate: a.expiryDate,
          quantity: a.qty,
          fromLocationId: location.id,
          userId: warehouse.id,
          createdAt: ago(daysAgo, 9),
        })
      }
    })

  // ════════════════ 시간 순서대로 ════════════════

  console.log('▸ 95일 전 — 초기 입고')
  await inbound(cheese, d(23), 90, 95) // 당시 118일 → 넉넉했다. 지금은 임박
  await inbound(milkgum, d(155), 200, 95)
  await inbound(duckneck, d(-8), 26, 95) // 당시 87일 → 정상. 지금은 만료
  await inbound(duckneck, d(155), 120, 95)
  await inbound(jerky, d(316), 150, 95)
  await inbound(sweetpotato, d(194), 90, 95)
  await inbound(salmon, d(120), 80, 95)
  await inbound(beef, d(280), 110, 95)
  await inbound(chickstick, d(-3), 20, 95) // 당시 92일 → 정상. 지금은 만료

  console.log('▸ 85~79일 전 — 풀필먼트 3사로 첫 발송 (당시엔 전부 넉넉한 로트였다)')
  await transfer(ffA, [{ product: cheese, qty: 30 }, { product: jerky, qty: 50 }], 85, 82)
  await transfer(ffB, [{ product: milkgum, qty: 95 }, { product: chickstick, qty: 6 }], 84, 80)
  await transfer(ffC, [{ product: duckneck, qty: 60 }, { product: salmon, qty: 35 }], 83, 79)

  console.log('▸ 30~22일 전 — 추가 입고')
  await inbound(cheese, d(225), 300, 30)
  await inbound(chickstick, d(96), 70, 28)
  await inbound(milkgum, d(29), 45, 26) // 임박 재고 — 자사창고에 남겨 직접 소진한다
  await inbound(sweetpotato, d(41), 42, 22) // 임박 재고

  console.log('▸ 22일 전 — 비건쿠키 4종 신규 입고 (각 80개)')
  // 신규 라인업이라 아직 발송·출고 이력이 없다. 자사창고에 80개씩 그대로 남는다.
  await inbound(veganStrawberry, d(180), 80, 22)
  await inbound(veganCarrot, d(200), 80, 22)
  await inbound(veganBlueberry, d(220), 80, 22)
  await inbound(veganSweetpotato, d(240), 80, 22)

  console.log('▸ 25~20일 전 — 2차 발송 (LEFO: 넉넉한 로트만 나간다)')
  await transfer(ffA, [{ product: cheese, qty: 160 }], 25, 21)
  await transfer(ffB, [{ product: beef, qty: 40 }], 24, 20)

  console.log('▸ 16~5일 전 — 자사창고 출고 (FEFO: 임박분부터 나간다)')
  await outbound(cheese, 12, 16, 'SALE')
  await outbound(milkgum, 10, 13, 'SALE')
  await outbound(jerky, 24, 11, 'SALE', sales)
  await outbound(beef, 8, 9, 'SAMPLE', sales)
  await outbound(sweetpotato, 15, 7, 'SALE')
  await outbound(salmon, 5, 6, 'DAMAGE')

  console.log('▸ 8~2일 전 — 배송 중 3건 (1건은 8일 경과 = 지연)')
  await transfer(
    ffC,
    [{ product: cheese, qty: 30 }, { product: sweetpotato, qty: 20 }],
    8,
    null // ★ 아직 도착 확인 안 됨
  )
  await transfer(ffA, [{ product: beef, qty: 25 }], 4, null)
  await transfer(ffB, [{ product: salmon, qty: 15 }], 2, null)

  console.log('▸ 6~3일 전 — 성수 팝업 반출 2회 (FEFO: 현장에서 며칠 안에 팔린다)')
  const popupLoc = await db.location.create({
    data: { name: '성수 팝업', type: LOCATION_TYPES.POPUP },
  })
  const popup = await db.popup.create({
    data: {
      name: '성수 팝업',
      status: POPUP_STATUS.ACTIVE,
      startDate: ago(5),
      endDate: ago(1),
      locationId: popupLoc.id,
      sourceLocationId: own.id,
      planLines: {
        create: [
          { productId: cheese.id, plannedQty: 50 },
          { productId: milkgum.id, plannedQty: 40 },
          { productId: duckneck.id, plannedQty: 40 },
          { productId: jerky.id, plannedQty: 30 },
        ],
      },
    },
  })

  const popupOut = (product: Ref, qty: number, daysAgo: number) =>
    tx(async (t) => {
      const plan = await allocateLots(t, {
        productId: product.id,
        locationId: own.id,
        quantity: qty,
        strategy: ALLOCATION.FEFO,
      })
      for (const a of plan) {
        await applyMovement(t, {
          type: MOVEMENT_TYPES.POPUP_OUT,
          productId: product.id,
          expiryDate: a.expiryDate,
          quantity: a.qty,
          fromLocationId: own.id,
          toLocationId: popupLoc.id,
          popupId: popup.id,
          userId: warehouse.id,
          createdAt: ago(daysAgo),
        })
      }
    })

  // 1차 반출 120개
  await popupOut(cheese, 40, 6)
  await popupOut(milkgum, 30, 6)
  await popupOut(duckneck, 30, 6)
  await popupOut(jerky, 20, 6)
  // 2차 추가 반출 40개 — 잘 팔려서 더 보냈다
  await popupOut(cheese, 10, 3)
  await popupOut(milkgum, 10, 3)
  await popupOut(duckneck, 10, 3)
  await popupOut(jerky, 10, 3)

  console.log('▸ 4~0일 전 — 풀필먼트 일일 반영 (C는 3일 전이 마지막 = 할 일에 뜬다)')
  await ffOut(ffA, cheese, 18, 2)
  await ffOut(ffA, jerky, 6, 1)
  await ffOut(ffA, cheese, 7, 0)
  await ffOut(ffB, milkgum, 12, 2)
  await ffOut(ffB, beef, 4, 1)
  await ffOut(ffB, milkgum, 9, 0)
  await ffOut(ffC, duckneck, 11, 4)
  await ffOut(ffC, salmon, 6, 3)

  console.log('▸ 3일 전 — 풀필먼트 B 재고표 대조에서 차이 발견')
  await tx(async (t) => {
    const plan = await allocateLots(t, {
      productId: beef.id,
      locationId: ffB.id,
      quantity: 2,
      strategy: ALLOCATION.FEFO,
    })
    for (const a of plan) {
      await applyMovement(t, {
        type: MOVEMENT_TYPES.ADJUST,
        reason: 'COUNT_DIFF',
        note: '풀필먼트 B 재고표 대조',
        productId: beef.id,
        expiryDate: a.expiryDate,
        quantity: a.qty,
        fromLocationId: ffB.id,
        userId: warehouse.id,
        createdAt: ago(3, 15),
      })
    }
  })

  // ───────── 요약
  const locs = await db.location.findMany({ include: { lots: { where: { quantity: { gt: 0 } } } } })
  const mvCount = await db.movement.count()
  let total = 0
  console.log('\n─────────── 시드 완료 ───────────')
  for (const l of locs) {
    const sum = l.lots.reduce((s, x) => s + x.quantity, 0)
    total += sum
    if (sum > 0) console.log(`  ${l.name.padEnd(12)} ${String(sum).padStart(6)}개`)
  }
  console.log(`  ${'총 재고'.padEnd(11)} ${String(total).padStart(6)}개 · 이동 기록 ${mvCount}건`)
  console.log('\n로그인: warehouse@demo.kr / sales@demo.kr  (비밀번호 demo1234)')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
