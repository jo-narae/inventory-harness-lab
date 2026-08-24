import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db, totalStock } from '../helpers'
import { applyMovement, reverseMovement } from '@/lib/stock'
import { applyAdjustmentTx, AdjustRejectedError, countDiff } from '@/lib/adjust'
import { getAdjustSheet } from '@/lib/inventory'
import { ADJUST_REASONS, type ReasonCode } from '@/lib/constants'
import { addDays, dateOnly, today } from '@/lib/date'

/**
 * Issue #12 — SKU 재고 조정(실사) 기능.
 *
 * 차이는 언제나 `실물 − 장부`다 (F8).
 * 기록의 방향은 from/to 로 남는다 — applyMovement 의 수량은 늘 양수이므로(06 §4.1),
 * "음수 조정"은 `from = 그 거점 · to = 없음`인 감소 기록을 뜻한다.
 *
 * 조정 기록을 지우는 경로가 없다는 것 자체는 `npm run check:arch` 의 A2 가 판정한다
 * (Movement 쓰기는 applyMovement 안에서만). 여기서는 확정한 기록이 남고, 되돌리려면
 * 상쇄 기록이 필요하다는 것을 확인한다 (F10).
 */
const SKU = '__TEST-ISSUE-12'
const EXPIRY = dateOnly(addDays(today(), 410)) // 시드와 겹치지 않는 전용 유통기한
const BOOK = 100 // 장부 수량

async function cleanup() {
  const product = await db.product.findUnique({ where: { sku: SKU } })
  if (product) {
    await db.movement.deleteMany({ where: { productId: product.id } })
    await db.lot.deleteMany({ where: { productId: product.id } })
    await db.product.delete({ where: { id: product.id } })
  }
}

async function fixture() {
  const [own, user] = await Promise.all([
    db.location.findFirstOrThrow({ where: { type: 'OWN' } }),
    db.user.findFirstOrThrow(),
  ])
  const product = await db.product.create({
    data: { sku: SKU, name: '테스트 껌 (issue-12)', unit: '개' },
  })

  await db.$transaction(async (tx) => {
    await applyMovement(tx, {
      type: 'INBOUND',
      reason: 'PURCHASE',
      productId: product.id,
      expiryDate: EXPIRY,
      quantity: BOOK,
      toLocationId: own.id,
      userId: user.id,
    })
  })

  return { own, user, product }
}

function lotQty(productId: number, locationId: number) {
  return db.lot
    .findUnique({
      where: { productId_locationId_expiryDate: { productId, locationId, expiryDate: EXPIRY } },
    })
    .then((l) => l?.quantity ?? 0)
}

function adjustMovements(productId: number) {
  return db.movement.findMany({ where: { productId, type: 'ADJUST' }, orderBy: { id: 'asc' } })
}

describe('Issue #12 — 재고 조정 (실사)', () => {
  beforeEach(cleanup)
  afterAll(async () => {
    await cleanup()
    await db.$disconnect()
  })

  it('실물 수량을 입력하면 차이가 실물 − 장부로 계산된다', async () => {
    const { own, product } = await fixture()

    const sheet = await getAdjustSheet(own.id)
    const row = sheet!.rows.find((r) => r.productId === product.id)
    expect(row?.bookQty).toBe(BOOK) // 화면이 기준으로 삼는 장부 수량

    expect(countDiff(BOOK, 93)).toBe(-7) // 실물이 적으면 음수
    expect(countDiff(BOOK, 108)).toBe(8) // 실물이 많으면 양수
    expect(countDiff(BOOK, BOOK)).toBe(0)
  })

  it('실물이 장부보다 적으면 차이만큼 감소 ADJUST 기록이 남고, 로트 수량이 실물과 같아진다', async () => {
    const { own, user, product } = await fixture()
    const beforeTotal = await totalStock()

    const result = await db.$transaction((tx) =>
      applyAdjustmentTx(tx, {
        locationId: own.id,
        reason: 'COUNT_DIFF',
        userId: user.id,
        lines: [{ productId: product.id, expiryDate: EXPIRY, countedQty: 93 }],
      })
    )

    expect(result.lines[0].diff).toBe(-7)
    expect(result.decreased).toBe(7)

    const [movement] = await adjustMovements(product.id)
    expect(movement.type).toBe('ADJUST')
    expect(movement.reason).toBe('COUNT_DIFF')
    expect(movement.quantity).toBe(7)
    expect(movement.fromLocationId).toBe(own.id) // 거점에서 빠졌다
    expect(movement.toLocationId).toBeNull() // 외부로 나간 감소 기록

    expect(await lotQty(product.id, own.id)).toBe(93) // 입력한 실물 수량과 같다
    expect(await totalStock()).toBe(beforeTotal - 7) // 조정은 총 재고를 바꾼다
  })

  it('실물이 장부보다 많으면 차이만큼 증가 ADJUST 기록이 남고, 로트 수량이 실물과 같아진다', async () => {
    const { own, user, product } = await fixture()
    const beforeTotal = await totalStock()

    const result = await db.$transaction((tx) =>
      applyAdjustmentTx(tx, {
        locationId: own.id,
        reason: 'COUNT_DIFF',
        userId: user.id,
        lines: [{ productId: product.id, expiryDate: EXPIRY, countedQty: 108 }],
      })
    )

    expect(result.lines[0].diff).toBe(8)
    expect(result.increased).toBe(8)

    const [movement] = await adjustMovements(product.id)
    expect(movement.quantity).toBe(8)
    expect(movement.fromLocationId).toBeNull() // 외부에서 들어온 증가 기록
    expect(movement.toLocationId).toBe(own.id)

    expect(await lotQty(product.id, own.id)).toBe(108)
    expect(await totalStock()).toBe(beforeTotal + 8)
  })

  it('차이가 없으면 조정 기록을 만들지 않는다', async () => {
    const { own, user, product } = await fixture()

    const result = await db.$transaction((tx) =>
      applyAdjustmentTx(tx, {
        locationId: own.id,
        reason: 'COUNT_DIFF',
        userId: user.id,
        lines: [{ productId: product.id, expiryDate: EXPIRY, countedQty: BOOK }],
      })
    )

    expect(result.lines).toHaveLength(0)
    expect(await adjustMovements(product.id)).toHaveLength(0)
    expect(await lotQty(product.id, own.id)).toBe(BOOK)
  })

  it('조정 사유를 선택하지 않으면 확정할 수 없고, 아무것도 바뀌지 않는다', async () => {
    const { own, user, product } = await fixture()
    const beforeTotal = await totalStock()

    await expect(
      db.$transaction((tx) =>
        applyAdjustmentTx(tx, {
          locationId: own.id,
          reason: null,
          userId: user.id,
          lines: [{ productId: product.id, expiryDate: EXPIRY, countedQty: 93 }],
        })
      )
    ).rejects.toThrow(AdjustRejectedError)

    try {
      await db.$transaction((tx) =>
        applyAdjustmentTx(tx, {
          locationId: own.id,
          reason: null,
          userId: user.id,
          lines: [{ productId: product.id, expiryDate: EXPIRY, countedQty: 93 }],
        })
      )
      throw new Error('여기 도달하면 안 된다')
    } catch (e) {
      expect(e).toBeInstanceOf(AdjustRejectedError)
      expect((e as AdjustRejectedError).code).toBe('REASON_REQUIRED')
    }

    expect(await adjustMovements(product.id)).toHaveLength(0)
    expect(await lotQty(product.id, own.id)).toBe(BOOK)
    expect(await totalStock()).toBe(beforeTotal)
  })

  it('조정 사유는 COUNT_DIFF · DAMAGE · LOSS · INPUT_ERROR · OTHER 중 하나로 기록된다', async () => {
    expect(ADJUST_REASONS).toEqual(['COUNT_DIFF', 'DAMAGE', 'LOSS', 'INPUT_ERROR', 'OTHER'])

    for (const reason of ADJUST_REASONS) {
      await cleanup()
      const { own, user, product } = await fixture()

      await db.$transaction((tx) =>
        applyAdjustmentTx(tx, {
          locationId: own.id,
          reason,
          note: reason === 'OTHER' ? '기타 사유 메모' : undefined, // OTHER 는 메모 필수 (F5-1)
          userId: user.id,
          lines: [{ productId: product.id, expiryDate: EXPIRY, countedQty: 95 }],
        })
      )

      const [movement] = await adjustMovements(product.id)
      expect(movement.reason).toBe(reason)
      expect(await lotQty(product.id, own.id)).toBe(95)
    }
  })

  it('조정에 쓸 수 없는 사유는 거부한다', async () => {
    const { own, user, product } = await fixture()

    await expect(
      db.$transaction((tx) =>
        applyAdjustmentTx(tx, {
          locationId: own.id,
          reason: 'SALE' as ReasonCode, // 판매는 출고 사유다
          userId: user.id,
          lines: [{ productId: product.id, expiryDate: EXPIRY, countedQty: 93 }],
        })
      )
    ).rejects.toThrow(AdjustRejectedError)

    expect(await adjustMovements(product.id)).toHaveLength(0)
    expect(await lotQty(product.id, own.id)).toBe(BOOK)
  })

  it('사유가 기타인데 메모가 없으면 확정할 수 없다', async () => {
    const { own, user, product } = await fixture()

    await expect(
      db.$transaction((tx) =>
        applyAdjustmentTx(tx, {
          locationId: own.id,
          reason: 'OTHER',
          userId: user.id,
          lines: [{ productId: product.id, expiryDate: EXPIRY, countedQty: 93 }],
        })
      )
    ).rejects.toThrow(AdjustRejectedError)

    expect(await lotQty(product.id, own.id)).toBe(BOOK)
  })

  it('확정한 조정 이력은 지워지지 않는다 — 되돌리려면 상쇄 기록이 필요하다', async () => {
    const { own, user, product } = await fixture()

    const result = await db.$transaction((tx) =>
      applyAdjustmentTx(tx, {
        locationId: own.id,
        reason: 'LOSS',
        note: '창고 실사',
        userId: user.id,
        lines: [{ productId: product.id, expiryDate: EXPIRY, countedQty: 90 }],
      })
    )
    const adjustId = result.lines[0].movementId
    expect(await lotQty(product.id, own.id)).toBe(90)

    // 되돌리기 = 삭제가 아니라 방향을 뒤집은 상쇄 기록 (F10 · 06 §4.4)
    await db.$transaction((tx) => reverseMovement(tx, adjustId, user.id))

    const origin = await db.movement.findUnique({ where: { id: adjustId } })
    expect(origin).not.toBeNull() // 원본은 그대로 남는다
    expect(origin!.reason).toBe('LOSS')

    const rows = await adjustMovements(product.id)
    expect(rows).toHaveLength(2) // 이력에 두 줄이 보인다
    expect(rows[1].reversalOfId).toBe(adjustId)
    expect(await lotQty(product.id, own.id)).toBe(BOOK) // 수량은 원래대로

    // 상쇄한 기록을 또 취소할 수는 없다
    await expect(
      db.$transaction((tx) => reverseMovement(tx, adjustId, user.id))
    ).rejects.toThrow()
  })
})
