import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db, totalStock } from '../helpers'
import { applyMovement } from '@/lib/stock'
import { applyAdjustmentTx } from '@/lib/adjust'
import { getAdjustSheet } from '@/lib/inventory'
import { addDays, dateOnly, today } from '@/lib/date'

/**
 * Issue #15 — 실사 시트에 잔량 0 로트가 나타나지 않아 "장부 0 · 실물 있음"을 입력할 수 없다.
 *
 * 실사는 실물을 세는 일이다 (F8: "거점·로트별로 실물 수량 입력 → 장부와의 차이를 표시").
 * 셀 수 있는 로트를 장부 잔량으로 미리 걸러내면 창고에서 나온 실물을 올릴 자리가 사라진다.
 *
 * 서버(`applyAdjustmentTx`)는 이미 `bookQty = lot?.quantity ?? 0` 으로 그 경우를 받는다.
 * 여기서 판정하는 것은 **화면이 읽는 조회가 그 분기에 닿는가**와, 닿았을 때 기록·수량이
 * 어떻게 남는가다. 기록 방향은 늘 from/to 로 남는다 (06 §4.1 — 수량은 언제나 양수).
 */
const SKU = '__TEST-ISSUE-15'
const ZERO_EXPIRY = dateOnly(addDays(today(), 420)) // 소진시켜 잔량 0 으로 만들 로트
const KEEP_EXPIRY = dateOnly(addDays(today(), 430)) // 잔량이 남아 있는 로트 (대조군)
const STOCKED = 50

async function cleanup() {
  const product = await db.product.findUnique({ where: { sku: SKU } })
  if (!product) return
  await db.movement.deleteMany({ where: { productId: product.id } })
  await db.lot.deleteMany({ where: { productId: product.id } })
  await db.product.delete({ where: { id: product.id } })
}

/**
 * 잔량 0 로트 하나 + 잔량이 남은 로트 하나를 자사창고에 만든다.
 * 잔량 0 은 로트를 손으로 만들지 않고 **입고 뒤 전량 출고**로 만든다 —
 * 실제로 소진이 일어나는 경로가 그것이고, 재고 수량 변경은 `applyMovement()` 로만 한다.
 */
async function fixture() {
  const [own, user] = await Promise.all([
    db.location.findFirstOrThrow({ where: { type: 'OWN' } }),
    db.user.findFirstOrThrow(),
  ])
  const product = await db.product.create({
    data: { sku: SKU, name: '테스트 저키 (issue-15)', unit: '개' },
  })

  await db.$transaction(async (tx) => {
    await applyMovement(tx, {
      type: 'INBOUND',
      reason: 'PURCHASE',
      productId: product.id,
      expiryDate: ZERO_EXPIRY,
      quantity: 30,
      toLocationId: own.id,
      userId: user.id,
    })
    await applyMovement(tx, {
      type: 'OUTBOUND',
      reason: 'SALE',
      productId: product.id,
      expiryDate: ZERO_EXPIRY,
      quantity: 30, // 전량 출고 → 로트는 남고 수량만 0 이 된다
      fromLocationId: own.id,
      userId: user.id,
    })
    await applyMovement(tx, {
      type: 'INBOUND',
      reason: 'PURCHASE',
      productId: product.id,
      expiryDate: KEEP_EXPIRY,
      quantity: STOCKED,
      toLocationId: own.id,
      userId: user.id,
    })
  })

  return { own, user, product }
}

function lotQty(productId: number, locationId: number, expiryDate: Date) {
  return db.lot
    .findUnique({ where: { productId_locationId_expiryDate: { productId, locationId, expiryDate } } })
    .then((l) => l?.quantity ?? 0)
}

function adjustMovements(productId: number) {
  return db.movement.findMany({ where: { productId, type: 'ADJUST' }, orderBy: { id: 'asc' } })
}

describe('Issue #15 — 실사 시트의 잔량 0 로트', () => {
  beforeEach(cleanup)
  afterAll(async () => {
    await cleanup()
    await db.$disconnect()
  })

  // 종료 조건 1
  it('잔량 0 로트가 그 거점의 실사 시트에 bookQty 0 으로 나타난다', async () => {
    const { own, product } = await fixture()
    expect(await lotQty(product.id, own.id, ZERO_EXPIRY)).toBe(0) // 전제: 소진된 로트다

    const sheet = await getAdjustSheet(own.id)
    const mine = sheet!.rows.filter((r) => r.productId === product.id)

    const zero = mine.find((r) => r.expiry === ZERO_EXPIRY.toISOString())
    expect(zero).toBeDefined() // 시트에서 사라지지 않는다
    expect(zero!.bookQty).toBe(0)
    expect(zero!.sku).toBe(SKU) // 상품 정보가 붙어 있어 셀 수 있는 줄이다

    // 잔량이 남은 로트는 그대로 함께 나온다 — 잔량 0 을 올리려고 다른 줄을 잃지 않는다
    const kept = mine.find((r) => r.expiry === KEEP_EXPIRY.toISOString())
    expect(kept?.bookQty).toBe(STOCKED)
  })

  // 종료 조건 2
  it('잔량 0 로트에 실물 4 를 입력해 확정하면 증가 ADJUST 기록이 남고 로트 수량이 4 가 된다', async () => {
    const { own, user, product } = await fixture()
    const beforeTotal = await totalStock()

    const result = await db.$transaction((tx) =>
      applyAdjustmentTx(tx, {
        locationId: own.id,
        reason: 'COUNT_DIFF',
        userId: user.id,
        lines: [{ productId: product.id, expiryDate: ZERO_EXPIRY, countedQty: 4 }],
      })
    )

    expect(result.lines[0].bookQty).toBe(0)
    expect(result.lines[0].diff).toBe(4)
    expect(result.increased).toBe(4)

    const movements = await adjustMovements(product.id)
    expect(movements).toHaveLength(1)
    expect(movements[0].quantity).toBe(4)
    expect(movements[0].fromLocationId).toBeNull() // 외부에서 들어온 증가 기록
    expect(movements[0].toLocationId).toBe(own.id)
    expect(movements[0].reason).toBe('COUNT_DIFF')

    expect(await lotQty(product.id, own.id, ZERO_EXPIRY)).toBe(4)
    expect(await totalStock()).toBe(beforeTotal + 4) // 조정은 총 재고를 바꾼다
  })

  // 종료 조건 3
  it('잔량 0 로트를 비워 둔 채 확정하면 그 로트의 기록이 생기지 않고 수량도 0 그대로다', async () => {
    const { own, user, product } = await fixture()
    const beforeTotal = await totalStock()

    // 비워 둔 줄은 화면이 lines 에 담지 않는다 — 세지 않은 줄이기 때문이다.
    // 여기서는 잔량이 남은 로트만 세어 넣고 확정한다
    const result = await db.$transaction((tx) =>
      applyAdjustmentTx(tx, {
        locationId: own.id,
        reason: 'COUNT_DIFF',
        userId: user.id,
        lines: [{ productId: product.id, expiryDate: KEEP_EXPIRY, countedQty: STOCKED - 2 }],
      })
    )

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].expiryDate.toISOString()).toBe(KEEP_EXPIRY.toISOString())

    const movements = await adjustMovements(product.id)
    expect(movements).toHaveLength(1) // 잔량 0 로트에 대한 기록은 없다
    expect(movements[0].toLocationId).toBeNull()
    expect(movements[0].fromLocationId).toBe(own.id)

    expect(await lotQty(product.id, own.id, ZERO_EXPIRY)).toBe(0) // 손대지 않았다
    expect(await totalStock()).toBe(beforeTotal - 2)
  })

  // 종료 조건 3 — 0 을 적어 낸 경우도 기록이 생기지 않는다 (차이가 0 이므로)
  it('잔량 0 로트에 실물 0 을 적어 내면 셌다는 사실만 남고 기록은 생기지 않는다', async () => {
    const { own, user, product } = await fixture()

    const result = await db.$transaction((tx) =>
      applyAdjustmentTx(tx, {
        locationId: own.id,
        reason: 'COUNT_DIFF',
        userId: user.id,
        lines: [{ productId: product.id, expiryDate: ZERO_EXPIRY, countedQty: 0 }],
      })
    )

    expect(result.lines).toHaveLength(0)
    expect(await adjustMovements(product.id)).toHaveLength(0)
    expect(await lotQty(product.id, own.id, ZERO_EXPIRY)).toBe(0)
  })

  // 종료 조건 4 — 잔량이 남은 로트의 실사 동작은 이전과 같다
  it('잔량이 남은 로트의 조정은 전과 같이 차이만큼만 기록된다', async () => {
    const { own, user, product } = await fixture()

    await db.$transaction((tx) =>
      applyAdjustmentTx(tx, {
        locationId: own.id,
        reason: 'LOSS',
        userId: user.id,
        lines: [{ productId: product.id, expiryDate: KEEP_EXPIRY, countedQty: STOCKED - 5 }],
      })
    )

    const [movement] = await adjustMovements(product.id)
    expect(movement.quantity).toBe(5)
    expect(movement.fromLocationId).toBe(own.id)
    expect(movement.toLocationId).toBeNull()
    expect(await lotQty(product.id, own.id, KEEP_EXPIRY)).toBe(STOCKED - 5)
  })
})
