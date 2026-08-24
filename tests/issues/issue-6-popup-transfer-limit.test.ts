import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db, totalStock } from '../helpers'
import { applyMovement } from '@/lib/stock'
import { createPopupTx, PopupPlanExceedsStockError } from '@/lib/popup'
import { addDays, dateOnly, today } from '@/lib/date'

/**
 * Issue #6 — 팝업 반출서에서 자사창고 보유 수량을 초과한 수량을 입력할 수 있음.
 * 테스트 전용 상품·팝업을 만들어 쓰고, 앞뒤로 자기가 만든 것만 지운다.
 */
const SKU = '__TEST-ISSUE-6'
const POPUP_NAME = '__테스트 팝업 (issue-6)'
const EXPIRY = dateOnly(addDays(today(), 400)) // 시드와 겹치지 않는 전용 유통기한

async function cleanup() {
  const popups = await db.popup.findMany({ where: { name: POPUP_NAME } })
  for (const popup of popups) {
    await db.movement.deleteMany({ where: { popupId: popup.id } })
    await db.popupPlan.deleteMany({ where: { popupId: popup.id } })
    await db.popup.delete({ where: { id: popup.id } })
    await db.lot.deleteMany({ where: { locationId: popup.locationId } })
    await db.location.delete({ where: { id: popup.locationId } })
  }
  const product = await db.product.findUnique({ where: { sku: SKU } })
  if (product) {
    await db.movement.deleteMany({ where: { productId: product.id } })
    await db.lot.deleteMany({ where: { productId: product.id } })
    await db.product.delete({ where: { id: product.id } })
  }
}

async function fixture() {
  const [own, ff, user] = await Promise.all([
    db.location.findFirstOrThrow({ where: { type: 'OWN' } }),
    db.location.findFirstOrThrow({ where: { type: 'FULFILLMENT' } }),
    db.user.findFirstOrThrow(),
  ])
  const product = await db.product.create({
    data: { sku: SKU, name: '테스트 저키 (issue-6)', unit: '개' },
  })

  await db.$transaction(async (tx) => {
    // 자사창고 보유 50개
    await applyMovement(tx, {
      type: 'INBOUND',
      reason: 'PURCHASE',
      productId: product.id,
      expiryDate: EXPIRY,
      quantity: 50,
      toLocationId: own.id,
      userId: user.id,
    })
    // 다른 거점(풀필먼트)에는 넉넉히 있다 — 반출 가능 수량에 합산되면 안 된다
    await applyMovement(tx, {
      type: 'INBOUND',
      reason: 'PURCHASE',
      productId: product.id,
      expiryDate: EXPIRY,
      quantity: 9999,
      toLocationId: ff.id,
      userId: user.id,
    })
  })

  return { own, ff, user, product }
}

describe('Issue #6 — 팝업 반출서 자사창고 보유 수량 초과 방지', () => {
  beforeEach(cleanup)
  afterAll(async () => {
    await cleanup()
    await db.$disconnect()
  })

  it('자사창고 보유 수량과 동일한 수량은 허용한다', async () => {
    const { own, product } = await fixture()

    const popup = await db.$transaction((tx) =>
      createPopupTx(tx, {
        name: POPUP_NAME,
        startDate: today(),
        endDate: addDays(today(), 3),
        sourceLocationId: own.id,
        planLines: [{ productId: product.id, plannedQty: 50 }], // 보유량과 동일
      })
    )

    expect(popup.id).toBeGreaterThan(0)
    const plan = await db.popupPlan.findFirst({ where: { popupId: popup.id } })
    expect(plan?.plannedQty).toBe(50)
  })

  it('자사창고 보유 수량 이하이면 반출서를 생성할 수 있다', async () => {
    const { own, product } = await fixture()

    const popup = await db.$transaction((tx) =>
      createPopupTx(tx, {
        name: POPUP_NAME,
        startDate: today(),
        endDate: addDays(today(), 3),
        sourceLocationId: own.id,
        planLines: [{ productId: product.id, plannedQty: 30 }], // 보유 50개 중 30개
      })
    )

    expect(popup.id).toBeGreaterThan(0)
  })

  it('자사창고 보유 수량을 초과하면 반출서를 생성할 수 없고, 현재 보유 수량과 초과 사실을 알린다', async () => {
    const { own, product } = await fixture()

    await expect(
      db.$transaction((tx) =>
        createPopupTx(tx, {
          name: POPUP_NAME,
          startDate: today(),
          endDate: addDays(today(), 3),
          sourceLocationId: own.id,
          planLines: [{ productId: product.id, plannedQty: 51 }], // 보유 50개 초과
        })
      )
    ).rejects.toThrow(PopupPlanExceedsStockError)

    try {
      await db.$transaction((tx) =>
        createPopupTx(tx, {
          name: POPUP_NAME,
          startDate: today(),
          endDate: addDays(today(), 3),
          sourceLocationId: own.id,
          planLines: [{ productId: product.id, plannedQty: 51 }],
        })
      )
      throw new Error('여기 도달하면 안 된다')
    } catch (e) {
      expect(e).toBeInstanceOf(PopupPlanExceedsStockError)
      const err = e as PopupPlanExceedsStockError
      expect(err.detail.have).toBe(50) // 현재 자사창고 보유 수량
      expect(err.detail.want).toBe(51)
    }
  })

  it('초과 상태에서는 반출 계획(팝업·반출서)이 저장되지 않는다', async () => {
    const { own, product } = await fixture()
    const beforePopups = await db.popup.count({ where: { name: POPUP_NAME } })
    const beforeTotal = await totalStock()

    await expect(
      db.$transaction((tx) =>
        createPopupTx(tx, {
          name: POPUP_NAME,
          startDate: today(),
          endDate: addDays(today(), 3),
          sourceLocationId: own.id,
          planLines: [{ productId: product.id, plannedQty: 999 }],
        })
      )
    ).rejects.toThrow()

    expect(await db.popup.count({ where: { name: POPUP_NAME } })).toBe(beforePopups)
    expect(await totalStock()).toBe(beforeTotal) // 재고도, 트랜잭션도 롤백됐다
  })

  it('초과 수량을 자사창고 보유 수량 이하로 수정하면 정상적으로 반출서를 생성할 수 있다', async () => {
    const { own, product } = await fixture()

    await expect(
      db.$transaction((tx) =>
        createPopupTx(tx, {
          name: POPUP_NAME,
          startDate: today(),
          endDate: addDays(today(), 3),
          sourceLocationId: own.id,
          planLines: [{ productId: product.id, plannedQty: 60 }], // 초과 시도
        })
      )
    ).rejects.toThrow(PopupPlanExceedsStockError)

    // 보유 수량 이하(50)로 고쳐서 다시 시도
    const popup = await db.$transaction((tx) =>
      createPopupTx(tx, {
        name: POPUP_NAME,
        startDate: today(),
        endDate: addDays(today(), 3),
        sourceLocationId: own.id,
        planLines: [{ productId: product.id, plannedQty: 50 }],
      })
    )
    expect(popup.id).toBeGreaterThan(0)
  })

  it('다른 거점(풀필먼트)의 재고는 팝업 반출 가능 수량에 합산하지 않는다', async () => {
    const { own, ff, product } = await fixture()

    // 풀필먼트에는 9999개가 있지만, 자사창고 보유(50)를 넘는 51개는 여전히 거부돼야 한다
    await expect(
      db.$transaction((tx) =>
        createPopupTx(tx, {
          name: POPUP_NAME,
          startDate: today(),
          endDate: addDays(today(), 3),
          sourceLocationId: own.id,
          planLines: [{ productId: product.id, plannedQty: 51 }],
        })
      )
    ).rejects.toThrow(PopupPlanExceedsStockError)

    // 풀필먼트 재고는 그대로다 — 반출 가능 판단에 쓰이지 않았다는 방증
    const ffLot = await db.lot.findUnique({
      where: { productId_locationId_expiryDate: { productId: product.id, locationId: ff.id, expiryDate: EXPIRY } },
    })
    expect(ffLot?.quantity).toBe(9999)
  })
})
