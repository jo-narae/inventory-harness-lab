'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireUser, SessionExpiredError } from '@/lib/auth'
import { applyAdjustmentTx, AdjustRejectedError } from '@/lib/adjust'
import { InsufficientStockError } from '@/lib/stock'
import type { ReasonCode } from '@/lib/constants'
import { dateOnly } from '@/lib/date'
import type { SaveResult } from './inbound'

/**
 * 재고 조정 확정 (F8)
 *
 * 사용자는 거점 하나를 골라 로트별 실물 수량을 적는다.
 * 장부와 차이가 있는 줄만 ADJUST 기록이 되고, 확정한 뒤에는 지울 수 없다 (F10).
 */
export async function saveAdjustment(input: {
  locationId: number
  reason: ReasonCode | null
  note?: string
  lines: { productId: number; expiry: string; countedQty: number }[] // expiry: ISO
}): Promise<SaveResult> {
  let user
  try {
    user = await requireUser()
  } catch (e) {
    if (e instanceof SessionExpiredError) return { ok: false, error: e.message }
    throw e
  }

  const location = await db.location.findUnique({ where: { id: input.locationId } })
  if (!location) return { ok: false, error: '거점을 찾을 수 없습니다' }
  if (!input.lines.length) return { ok: false, error: '실물 수량을 입력하세요' }

  let result
  try {
    result = await db.$transaction((tx) =>
      applyAdjustmentTx(tx, {
        locationId: input.locationId,
        reason: input.reason,
        note: input.note,
        userId: user.id,
        lines: input.lines.map((l) => ({
          productId: l.productId,
          expiryDate: dateOnly(new Date(l.expiry)),
          countedQty: l.countedQty,
        })),
      })
    )
  } catch (e) {
    if (e instanceof AdjustRejectedError) return { ok: false, error: e.message }
    if (e instanceof InsufficientStockError) {
      return { ok: false, error: '조정하는 사이에 재고가 바뀌었습니다. 다시 확인해주세요' }
    }
    return { ok: false, error: e instanceof Error ? e.message : '저장에 실패했습니다' }
  }

  revalidatePath('/')
  revalidatePath('/adjust')
  revalidatePath(`/adjust/${input.locationId}`)
  for (const productId of new Set(input.lines.map((l) => l.productId))) {
    revalidatePath(`/products/${productId}`)
  }

  if (result.lines.length === 0) {
    return { ok: true, message: `${location.name} · 차이 없음으로 확정` }
  }
  const parts = [
    result.increased > 0 ? `+${result.increased}` : null,
    result.decreased > 0 ? `−${result.decreased}` : null,
  ].filter(Boolean)
  return {
    ok: true,
    message: `${location.name} · ${result.lines.length}개 로트 조정 (${parts.join(' / ')})`,
  }
}
