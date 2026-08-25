'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ProvisionView } from '@/lib/provisions'

/** Short enough that the badge flips the moment it is due, not a second late. */
const TICK_MS = 250

/**
 * A clock that runs only while something is actually in flight.
 *
 * Nothing schedules a transition — no queue, no worker. A row that says
 * `starting` simply reads as `running` once its timestamp is old enough. The
 * server sends the moment each pending machine is due, so this ticks until the
 * last one passes, then asks the server for a fresh read so the rest of the
 * page — counts, group tallies — agrees with the badge that just flipped.
 *
 * Returns null while nothing is pending, which is also the value the very
 * first client render sees. `displayStatus` treats null as "use what the
 * server rendered", so hydration has nothing to reconcile: the alternative,
 * seeding state from `Date.now()`, would have the server and the browser
 * disagree about a countdown that is a second further along by the time it
 * reaches the page.
 */
export function useSettleClock(rows: ProvisionView[]): number | null {
  const router = useRouter()
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    const due = rows
      .map((r) => r.settles_at)
      .filter((t): t is number => t !== null)

    // Everything has settled, so there is nothing for a clock to change.
    if (!due.some((t) => t > Date.now())) return

    const id = window.setInterval(() => {
      const tick = Date.now()
      setNow(tick)
      if (!due.some((t) => t > tick)) {
        window.clearInterval(id)
        // The row still says `starting` in the database — it settled by
        // getting old, not by being written to. Re-read so the server agrees.
        router.refresh()
      }
    }, TICK_MS)

    return () => window.clearInterval(id)
  }, [rows, router])

  return now
}
