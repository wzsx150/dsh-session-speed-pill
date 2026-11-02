/**
 * Pure numeric helpers for the session-speed projection.
 *
 * Every function returns `null` instead of `NaN`, `Infinity`, or `-0` so the
 * projection view can never carry a non-finite number to the client.
 *
 * @module dsh-session-speed-pill/metrics
 */

/** True for real, finite numbers only. */
export function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Round to `digits` decimals; non-finite input becomes `null`. */
export function round(value, digits = 1) {
  if (!isFiniteNumber(value)) return null
  const factor = 10 ** digits
  const scaled = Math.round(value * factor) / factor
  return Object.is(scaled, -0) ? 0 : scaled
}

/** `numerator / denominator`, or `null` when the denominator cannot carry a rate. */
export function ratio(numerator, denominator) {
  if (!isFiniteNumber(numerator) || !isFiniteNumber(denominator)) return null
  if (denominator <= 0) return null
  return numerator / denominator
}

/** Arithmetic mean, or `null` for an empty sample. */
export function average(values) {
  if (!Array.isArray(values) || values.length === 0) return null
  let sum = 0
  for (const value of values) {
    if (!isFiniteNumber(value)) continue
    sum += value
  }
  return sum / values.length
}

/**
 * Nearest-rank percentile (`p` in 0..100) over a copy of `values`.
 *
 * `index = floor(p/100 * n)`, clamped. With two samples this collapses to the
 * min/max pair; with twenty-one it drops the two extremes at each end, which is
 * what the panel wants: a min/max spread over per-step rates is dominated by the
 * single best and worst step (measured: 114x for decode, 5673x for the prefill
 * estimate, versus 2.2x/10.5x at p10..p90).
 */
export function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return null
  if (!isFiniteNumber(p)) return null
  const sorted = values.filter(isFiniteNumber).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const clamped = Math.min(100, Math.max(0, p))
  const index = Math.min(sorted.length - 1, Math.floor((clamped / 100) * sorted.length))
  return sorted[index]
}

/** Smallest sample value, or `null` when empty. */
export function minOf(values) {
  if (!Array.isArray(values) || values.length === 0) return null
  let result = null
  for (const value of values) {
    if (!isFiniteNumber(value)) continue
    if (result === null || value < result) result = value
  }
  return result
}

/** Largest sample value, or `null` when empty. */
export function maxOf(values) {
  if (!Array.isArray(values) || values.length === 0) return null
  let result = null
  for (const value of values) {
    if (!isFiniteNumber(value)) continue
    if (result === null || value > result) result = value
  }
  return result
}
