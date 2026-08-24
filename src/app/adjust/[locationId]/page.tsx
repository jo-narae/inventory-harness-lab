import { notFound } from 'next/navigation'
import { AdjustSheet } from '@/components/AdjustSheet'
import { getAdjustSheet } from '@/lib/inventory'

export const dynamic = 'force-dynamic'

export default async function AdjustSheetPage({
  params,
}: {
  params: Promise<{ locationId: string }>
}) {
  const { locationId } = await params
  const sheet = await getAdjustSheet(Number(locationId))
  if (!sheet) notFound()

  return (
    <AdjustSheet
      location={{ id: sheet.location.id, name: sheet.location.name }}
      rows={sheet.rows}
    />
  )
}
