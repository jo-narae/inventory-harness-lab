'use client'

import Link from 'next/link'
import { useState } from 'react'

/** 모든 동작이 ＋ 하나 뒤에 모인다 (시안 2 구조) */
const ACTIONS = [
  { href: '/inbound', icon: '📥', label: '입고' },
  { href: '/outbound', icon: '📤', label: '출고' },
  { href: '/transfers/new', icon: '🚚', label: '풀필먼트 발송' },
  { href: '/fulfillment', icon: '📝', label: '풀필먼트 일일 반영' },
  { href: '/popups', icon: '🎪', label: '팝업 반출 · 정산' },
  { href: '/adjust', icon: '🔢', label: '재고 조정 (실사)' },
]

export function ActionFab() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="작업 선택"
        className="acc-grad fixed bottom-5 right-5 z-30 rounded-2xl px-5 py-3.5 text-[15px] font-extrabold text-white shadow-[0_8px_20px_rgba(91,33,182,.4)]"
      >
        ＋
      </button>

      {open && (
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/25" />
          <div
            className="absolute inset-x-0 bottom-0 mx-auto max-w-[560px] rounded-t-[20px] bg-white pb-4 pt-2 shadow-[0_-10px_30px_rgba(35,24,60,.16)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-2.5 mt-1 h-1 w-9 rounded-full bg-[#e2ddec]" />
            {ACTIONS.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="flex items-center gap-3 border-b border-[#f7f4fc] px-[18px] py-3 text-[13.5px] font-bold last:border-b-0"
              >
                <span className="text-[16px]">{a.icon}</span>
                {a.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
