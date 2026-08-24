import Link from 'next/link'
import { Badge } from '@/components/StatusBadge'
import { getAdjustLocations } from '@/lib/inventory'
import { LOCATION_TYPE_LABEL, type LocationType } from '@/lib/constants'
import { formatDate } from '@/lib/date'

export const dynamic = 'force-dynamic'

export default async function AdjustPage() {
  const locations = await getAdjustLocations()

  return (
    <main className="pb-16">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <Link href="/" className="text-[14.5px] font-extrabold">
          ‹ 재고 조정 (실사)
        </Link>
      </header>

      <p className="border-b border-line bg-dim px-4 py-2.5 text-[11.5px] leading-relaxed text-[#5b5570]">
        실물을 세어 장부와 맞추는 곳입니다. 거점을 고르면 로트별 장부 수량이 나옵니다.
      </p>

      {locations.map((l) => (
        <Link
          key={l.id}
          href={`/adjust/${l.id}`}
          className="flex items-center justify-between border-b border-line px-4 py-3.5"
        >
          <div>
            <p className="text-[13.5px] font-bold">📍 {l.name}</p>
            <p className="mt-[3px] text-[11px] text-sub tnum">
              {l.lotCount}개 로트 · {l.total.toLocaleString()}개 보유 · 마지막 조정{' '}
              <b className="text-[#5b5570]">
                {l.lastAdjustedAt ? formatDate(l.lastAdjustedAt) : '없음'}
              </b>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="gray">{LOCATION_TYPE_LABEL[l.type as LocationType]}</Badge>
            <span className="text-sub">›</span>
          </div>
        </Link>
      ))}

      <p className="mx-4 mt-4 rounded-xl bg-dim px-3.5 py-3 text-[11.5px] leading-relaxed text-[#5b5570]">
        조정에는 사유가 반드시 붙습니다. 원인이 분명하면 <b>파손·분실</b>을, 모르면{' '}
        <b>대조 차이</b>를 고릅니다. 확정한 조정 기록은 지울 수 없고, 되돌리려면 상쇄 기록이
        필요합니다.
      </p>
    </main>
  )
}
