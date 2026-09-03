import { describe, expect, it } from 'vitest'
import { popupDisplayStatus } from '@/lib/popup'
import { POPUP_STATUS, POPUP_STATUS_LABEL } from '@/lib/constants'
import { addDays, today } from '@/lib/date'

/**
 * Issue #19 — 행사 종료일이 지난 팝업이 목록에서 계속 `진행 중` 으로 표시된다.
 *
 * 저장된 `status` 는 업무 진행 단계라서 행사가 끝나도 정산 전까지 `ACTIVE` 로 남는다.
 * 그래서 표시할 때 행사 기간을 한 번 더 보는 `popupDisplayStatus()` 가 판정한다.
 * 여기서 확인하는 것은 그 판정이고, 화면은 이 값에 라벨을 붙일 뿐이다.
 *
 * 종료일은 "그날까지 행사한다"는 뜻이므로 포함이다 (Issue 종료 조건 2 — 종료일 이하는 진행 중).
 */
const label = (popup: { status: string; endDate: Date }, now: Date) =>
  POPUP_STATUS_LABEL[popupDisplayStatus(popup, now)]

const NOW = today()

describe('Issue #19 — 팝업 표시 상태는 행사 기간을 본다', () => {
  it('행사 종료일이 지났으면 종료로 표시된다', () => {
    const popup = { status: POPUP_STATUS.ACTIVE, endDate: addDays(NOW, -1) }

    expect(popupDisplayStatus(popup, NOW)).toBe(POPUP_STATUS.CLOSED)
    expect(label(popup, NOW)).toBe('종료')
  })

  it('행사 기간 중이면 진행 중으로 표시된다', () => {
    const 시작일 = { status: POPUP_STATUS.ACTIVE, endDate: addDays(NOW, 3) }
    const 종료일 = { status: POPUP_STATUS.ACTIVE, endDate: NOW } // 종료일 당일도 기간 안이다

    expect(label(시작일, NOW)).toBe('진행 중')
    expect(label(종료일, NOW)).toBe('진행 중')
  })

  it('시각이 아니라 날짜로 비교한다 — 종료일 당일 오후도 진행 중이다', () => {
    const 오후 = new Date(NOW.getTime() + 15 * 3_600_000)
    const popup = { status: POPUP_STATUS.ACTIVE, endDate: NOW }

    expect(label(popup, 오후)).toBe('진행 중')
  })

  it('ACTIVE 가 아닌 팝업의 표시 상태는 기간과 무관하게 그대로다', () => {
    const 지난날 = addDays(NOW, -10)

    expect(label({ status: POPUP_STATUS.PREP, endDate: 지난날 }, NOW)).toBe('준비')
    expect(label({ status: POPUP_STATUS.SETTLING, endDate: 지난날 }, NOW)).toBe('정산 중')
    expect(label({ status: POPUP_STATUS.CLOSED, endDate: 지난날 }, NOW)).toBe('종료')
  })
})
