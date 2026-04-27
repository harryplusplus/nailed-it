/**
 * Format a duration in milliseconds to a human-readable string.
 *
 * Shows the two largest adjacent units based on the duration's magnitude:
 * - ≥ 1 day  → "Xd Yh"
 * - ≥ 1 hour → "Xh Ym"
 * - ≥ 1 min  → "Xm Ys"
 * - ≥ 1 sec  → "Xs Yms"
 * - < 1 sec  → "Xms"
 */
export function formatDuration(ms: number): string {
  const totalMs = Math.max(0, Math.floor(ms))

  const days = Math.floor(totalMs / 86_400_000)
  const hours = Math.floor((totalMs % 86_400_000) / 3_600_000)
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000)
  const seconds = Math.floor((totalMs % 60_000) / 1_000)
  const milliseconds = totalMs % 1_000

  if (days > 0) {
    return `${days}d ${hours}h`
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }
  if (seconds > 0) {
    return `${seconds}s ${milliseconds}ms`
  }
  return `${milliseconds}ms`
}
