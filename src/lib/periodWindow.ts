/**
 * Compute the per-period window key used by `authority_usage`.
 *
 * Lifted out of `modules/authorities/service.ts` at H-4 because two callers
 * now need it: the validator (read-side; H-3) and the dispatch path
 * (write-side; H-4). The string format is the source of truth for the
 * `authority_usage.period_window` DATE column — keep them in sync.
 *
 *   monthly    → first day of the calendar month     ('2026-05-01')
 *   weekly     → ISO Monday of the calendar week     ('2026-05-18')
 *   daily      → calendar day                        ('2026-05-21')
 *   single_use → calendar day (a single_use scope is enforced by call_count,
 *                not by window, but the same key shape is harmless here)
 *   undefined  → calendar day (defensive default)
 *
 * `now` is injectable so tests don't depend on the wall clock.
 */
export function periodWindowKey(period: string | undefined, now: Date): string {
  const iso = now.toISOString();
  if (period === 'monthly') return `${iso.slice(0, 7)}-01`;
  if (period === 'weekly') {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const day = d.getUTCDay() || 7; // Sunday=0 → 7
    d.setUTCDate(d.getUTCDate() - (day - 1));
    return d.toISOString().slice(0, 10);
  }
  return iso.slice(0, 10);
}
