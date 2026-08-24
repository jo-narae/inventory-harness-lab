import type { Prisma } from '@/generated/prisma/client'
import { applyMovement } from './stock'
import { ADJUST_REASONS, MOVEMENT_TYPES, REASON_REQUIRES_NOTE, type ReasonCode } from './constants'
import { dateOnly } from './date'

/**
 * 재고 조정 = 실사 (F8).
 *
 * "풀필먼트사 수치가 진실"이라는 원칙의 실행 수단이다.
 * 거점·로트별로 실물을 세어 넣으면 장부와의 차이만큼 ADJUST 기록이 남는다.
 *
 * 차이는 언제나 `실물 − 장부`다. 양수면 장부에 없던 물건이 나온 것이고,
 * 음수면 장부에는 있는데 실물이 없는 것이다. 어느 쪽이든 외부와의 증감이므로
 * (from 또는 to 한쪽이 비어 있다) 총 재고가 그만큼 변한다 — 위치 이동이 아니다.
 *
 * 실사 화면이 읽는 조회(`getAdjustLocations`·`getAdjustSheet`)는 `lib/inventory.ts` 에 있다.
 * 이 파일은 클라이언트 컴포넌트도 `countDiff` 를 같이 쓰므로 DB 를 끌어오지 않는다.
 */

// ───────────────────────── 차이 계산

/** 차이 = 실물 − 장부. 양수면 늘고, 음수면 준다 */
export function countDiff(bookQty: number, countedQty: number): number {
  return countedQty - bookQty
}

// ───────────────────────── 거부 사유

export type AdjustRejectCode =
  | 'REASON_REQUIRED' // 사유를 고르지 않았다
  | 'REASON_NOT_ALLOWED' // 조정에 쓸 수 없는 사유다
  | 'NOTE_REQUIRED' // 기타인데 메모가 없다
  | 'INVALID_COUNT' // 실물 수량이 0 이상의 정수가 아니다

export class AdjustRejectedError extends Error {
  constructor(
    readonly code: AdjustRejectCode,
    message: string
  ) {
    super(message)
    this.name = 'AdjustRejectedError'
  }
}

// ───────────────────────── 확정

export type AdjustCountLine = {
  productId: number
  expiryDate: Date
  countedQty: number // 실물 수량
}

export type AdjustInput = {
  locationId: number
  reason: ReasonCode | null | undefined
  note?: string | null
  userId: number
  lines: AdjustCountLine[]
}

export type AdjustedLine = {
  movementId: number
  productId: number
  expiryDate: Date
  bookQty: number
  countedQty: number
  diff: number // 실물 − 장부
}

export type AdjustResult = {
  lines: AdjustedLine[]
  increased: number // 늘어난 합계
  decreased: number // 줄어든 합계 (양수로 센다)
}

/**
 * 실사 확정 — 차이가 있는 로트마다 ADJUST 기록을 하나씩 남긴다.
 * 차이가 0인 줄은 셌다는 사실만 확인된 것이므로 기록을 만들지 않는다.
 */
export async function applyAdjustmentTx(
  tx: Prisma.TransactionClient,
  input: AdjustInput
): Promise<AdjustResult> {
  const reason = requireAdjustReason(input.reason, input.note)

  for (const line of input.lines) {
    if (!Number.isInteger(line.countedQty) || line.countedQty < 0) {
      throw new AdjustRejectedError('INVALID_COUNT', '실물 수량은 0 이상의 정수로 입력하세요')
    }
  }

  const result: AdjustResult = { lines: [], increased: 0, decreased: 0 }

  for (const line of input.lines) {
    const expiryDate = dateOnly(line.expiryDate)
    const lot = await tx.lot.findUnique({
      where: {
        productId_locationId_expiryDate: {
          productId: line.productId,
          locationId: input.locationId,
          expiryDate,
        },
      },
    })
    const bookQty = lot?.quantity ?? 0
    const diff = countDiff(bookQty, line.countedQty)
    if (diff === 0) continue

    // 늘면 외부에서 들어온 것(to만), 줄면 외부로 나간 것(from만)이다
    const movement = await applyMovement(tx, {
      type: MOVEMENT_TYPES.ADJUST,
      reason,
      note: input.note ?? null,
      productId: line.productId,
      expiryDate,
      quantity: Math.abs(diff),
      fromLocationId: diff < 0 ? input.locationId : null,
      toLocationId: diff > 0 ? input.locationId : null,
      userId: input.userId,
    })

    result.lines.push({
      movementId: movement.id,
      productId: line.productId,
      expiryDate,
      bookQty,
      countedQty: line.countedQty,
      diff,
    })
    if (diff > 0) result.increased += diff
    else result.decreased += -diff
  }

  return result
}

/** 사유 검사 — F8 "조정에는 사유 입력 필수", F5-1 "OTHER는 메모 없이 저장할 수 없다" */
export function requireAdjustReason(
  reason: ReasonCode | null | undefined,
  note?: string | null
): ReasonCode {
  if (!reason) throw new AdjustRejectedError('REASON_REQUIRED', '조정 사유를 선택하세요')
  if (!ADJUST_REASONS.includes(reason)) {
    throw new AdjustRejectedError('REASON_NOT_ALLOWED', '조정에 쓸 수 없는 사유입니다')
  }
  if (REASON_REQUIRES_NOTE.includes(reason) && !note?.trim()) {
    throw new AdjustRejectedError('NOTE_REQUIRED', '사유가 기타일 때는 메모가 필요합니다')
  }
  return reason
}
