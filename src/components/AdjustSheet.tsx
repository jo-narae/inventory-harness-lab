'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BulkInputRow } from './BulkInputRow'
import { saveAdjustment } from '@/actions/adjust'
import { countDiff } from '@/lib/adjust'
import type { AdjustRow } from '@/lib/inventory'
import { ADJUST_REASONS, REASON_LABEL, REASON_REQUIRES_NOTE, type ReasonCode } from '@/lib/constants'
import { formatDate } from '@/lib/date'
import { EXPIRY_LABEL } from '@/lib/expiry'

/**
 * 재고 조정 (실사, F8)
 *
 * 셀 로트를 나열하고 실물 수량 칸만 채우게 한다.
 * 차이(실물 − 장부)는 입력하는 즉시 그 줄에 보인다.
 * 비워 둔 줄은 세지 않은 줄이다 — 확정해도 아무 기록도 남지 않는다.
 */
export function AdjustSheet({
  location,
  rows,
}: {
  location: { id: number; name: string }
  rows: AdjustRow[]
}) {
  const router = useRouter()
  const [values, setValues] = useState<Record<number, string>>({})
  const [reason, setReason] = useState<ReasonCode | ''>('') // 조정에는 기본 사유가 없다 (F5-1)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const computed = useMemo(
    () =>
      rows.map((row) => {
        const raw = (values[row.lotId] ?? '').trim()
        const counted = raw === '' ? null : Number(raw)
        const valid = counted !== null && Number.isInteger(counted) && counted >= 0
        return {
          row,
          counted,
          valid,
          diff: valid ? countDiff(row.bookQty, counted!) : 0,
        }
      }),
    [rows, values]
  )

  // 장부 0 로트도 실사 대상이다 (F8). 다만 잔량이 남은 줄과 섞으면 매번 채워야 할 칸으로
  // 보이므로 아래에 따로 모은다 — "실물이 나왔을 때만" 손이 가는 자리다
  const stocked = computed.filter((c) => c.row.bookQty > 0)
  const depleted = computed.filter((c) => c.row.bookQty === 0)

  const counted = computed.filter((c) => c.counted !== null)
  const invalid = counted.filter((c) => !c.valid)
  const changed = computed.filter((c) => c.valid && c.diff !== 0)
  const increased = changed.filter((c) => c.diff > 0).reduce((s, c) => s + c.diff, 0)
  const decreased = changed.filter((c) => c.diff < 0).reduce((s, c) => s - c.diff, 0)
  const noteRequired = !!reason && REASON_REQUIRES_NOTE.includes(reason)
  const blocked =
    !reason || counted.length === 0 || invalid.length > 0 || (noteRequired && !note.trim())

  const submit = async () => {
    if (blocked) return
    setPending(true)
    setError(null)
    const res = await saveAdjustment({
      locationId: location.id,
      reason: reason || null,
      note: note.trim() || undefined,
      lines: counted.map((c) => ({
        productId: c.row.productId,
        expiry: c.row.expiry,
        countedQty: c.counted!,
      })),
    })
    setPending(false)
    if (!res.ok) return setError(res.error)
    router.push('/adjust')
    router.refresh()
  }

  const renderRow = (c: (typeof computed)[number]) => {
    const filled = c.counted !== null
    const tone = !c.valid && filled ? 'error' : c.diff !== 0 ? 'filled' : 'idle'
    const expiry = new Date(c.row.expiry)
    const sub = [
      formatDate(expiry),
      c.row.status === 'OK' ? null : EXPIRY_LABEL[c.row.status],
      c.row.sku,
    ]
      .filter(Boolean)
      .join(' · ')

    return (
      <BulkInputRow
        key={c.row.lotId}
        name={c.row.name}
        sub={sub}
        unit={c.row.unit}
        ariaLabel={`${c.row.name} ${formatDate(expiry)} 실물 수량`}
        value={values[c.row.lotId] ?? ''}
        onChange={(v) => setValues((p) => ({ ...p, [c.row.lotId]: v }))}
        onEnter={submit}
        tone={tone}
        info={
          filled && c.valid ? (
            <>
              {c.row.bookQty.toLocaleString()} <span className="text-[#c9c4d6]">→</span>{' '}
              <b className={c.diff === 0 ? 'text-sub' : 'text-acc'}>
                {c.counted!.toLocaleString()}
              </b>
            </>
          ) : (
            <>장부 {c.row.bookQty.toLocaleString()}</>
          )
        }
        result={
          filled && !c.valid ? (
            <b className="text-red">0 이상의 정수로 입력하세요</b>
          ) : filled && c.diff !== 0 ? (
            <b className={c.diff > 0 ? 'text-ok' : 'text-red'}>
              차이 {c.diff > 0 ? '+' : '−'}
              {Math.abs(c.diff).toLocaleString()}
              {c.row.unit} ({c.diff > 0 ? '장부보다 많음' : '장부보다 적음'})
            </b>
          ) : filled ? (
            <span className="text-sub">차이 없음</span>
          ) : (
            <span className="hidden text-[#c9c4d6] lg:inline">—</span>
          )
        }
      />
    )
  }

  return (
    <main className="pb-32">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <Link href="/adjust" className="text-[14.5px] font-extrabold">
          ‹ {location.name} 재고 조정
        </Link>
        <span className="text-[11px] text-sub tnum">
          {stocked.length}개 로트
          {depleted.length > 0 && ` · 장부 0 ${depleted.length}개`}
        </span>
      </header>

      <p className="border-b border-line bg-dim px-4 py-2.5 text-[11.5px] leading-relaxed text-[#5b5570]">
        세어 본 <b>실물 수량</b>을 적습니다. 장부와 다른 줄만 조정 기록으로 남고, 비워 둔 줄은
        세지 않은 것으로 봅니다. 확정한 조정은 지울 수 없습니다.
      </p>

      <div className="px-4 pt-3">
        <label className="mb-1 block text-[10.5px] text-sub" htmlFor="adjust-reason">
          조정 사유 (필수)
        </label>
        <select
          id="adjust-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value as ReasonCode | '')}
          className={`w-full rounded-xl border px-3.5 py-2.5 text-[12.5px] font-bold outline-none ${
            reason ? 'border-[#e2ddec] bg-[#f5f3f9]' : 'border-amber bg-amber-bg text-amber'
          }`}
        >
          <option value="">사유를 선택하세요</option>
          {ADJUST_REASONS.map((r) => (
            <option key={r} value={r}>
              {REASON_LABEL[r]}
            </option>
          ))}
        </select>
        {noteRequired && (
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="메모 (사유가 기타일 때 필수)"
            className="mt-2 w-full rounded-xl border border-[#e2ddec] px-3.5 py-2.5 text-[12.5px] outline-none"
          />
        )}
      </div>

      {/* PC에서만 보이는 표 머리 — 같은 행이 넓은 폭에서 표로 펼쳐진다 */}
      <div className="mt-3 hidden border-y border-line bg-dim px-4 py-1.5 text-[10.5px] font-extrabold tracking-wider text-sub lg:grid lg:grid-cols-[minmax(0,1.4fr)_112px_112px_minmax(0,1.6fr)] lg:gap-x-3">
        <span>상품 · 유통기한</span>
        <span className="text-right">장부</span>
        <span className="text-center">실물</span>
        <span>차이</span>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-14 text-center text-[13px] text-sub">이 거점에 실사할 로트가 없습니다</p>
      ) : (
        <>
          {stocked.map(renderRow)}

          {depleted.length > 0 && (
            <>
              <div className="border-b border-line bg-dim px-4 py-2.5 text-[10.5px] leading-relaxed text-sub">
                <b className="text-[#5b5570]">장부 0 · {depleted.length}개 로트</b> — 소진된
                로트입니다. 창고에서 실물이 나온 것만 수량을 적고, 나머지는 비워 둡니다.
              </div>
              {depleted.map(renderRow)}
            </>
          )}
        </>
      )}

      {error && (
        <p className="mx-4 mt-3 rounded-xl bg-red-bg px-3.5 py-2.5 text-[12px] font-bold text-red">
          {error}
        </p>
      )}

      <div className="fixed inset-x-0 bottom-0 mx-auto max-w-[560px] border-t border-line bg-white p-3 lg:max-w-[960px]">
        <div className="mb-2 flex items-center justify-between px-1 text-[11.5px]">
          <span className="font-bold text-[#5b5570] tnum">
            {counted.length === 0
              ? '실물 수량을 입력하세요'
              : changed.length === 0
                ? `${counted.length}개 로트 확인 · 차이 없음`
                : `${changed.length}개 로트 차이 · ${increased > 0 ? `+${increased}` : ''}${
                    increased > 0 && decreased > 0 ? ' / ' : ''
                  }${decreased > 0 ? `−${decreased}` : ''}`}
          </span>
          {!reason && <span className="font-extrabold text-amber">사유를 선택하세요</span>}
        </div>
        <button
          onClick={submit}
          disabled={pending || blocked}
          className="acc-grad w-full rounded-xl py-3.5 text-[14.5px] font-extrabold text-white disabled:opacity-40"
        >
          {pending ? '확정 중…' : changed.length > 0 ? `조정 확정 · ${changed.length}건` : '조정 확정'}
        </button>
      </div>
    </main>
  )
}
