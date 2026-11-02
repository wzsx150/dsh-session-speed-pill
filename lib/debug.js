/**
 * Optional diagnostics for the Host half.
 *
 * Silent by default: the plugin must not add console noise to a normal session.
 * Set `DSH_SESSION_SPEED_PILL_DEBUG=1` before starting the Harness to get one
 * line per published view, which is usually enough to answer "why is this
 * number what it is".
 *
 * @module dsh-session-speed-pill/debug
 */

const PREFIX = '[dsh-session-speed-pill]'

/** Read once: environment variables cannot change inside a running process anyway. */
export const debugEnabled = (() => {
  try {
    const raw = process.env && process.env.DSH_SESSION_SPEED_PILL_DEBUG
    if (typeof raw !== 'string') return false
    const normalized = raw.trim().toLowerCase()
    return normalized === '1' || normalized === 'true' || normalized === 'yes'
  } catch (error) {
    return false
  }
})()

/** Log only when the debug switch is on. */
export function debug(...args) {
  if (!debugEnabled) return
  try {
    console.log(PREFIX, ...args)
  } catch (error) {
    /* a broken console must not break a fold */
  }
}

/**
 * Report a real problem once. Always enabled: a projection failure is exactly
 * the kind of thing the user should be able to see without knowing a switch
 * exists, and the caller is responsible for keeping it from repeating.
 */
export function warn(...args) {
  try {
    console.warn(PREFIX, ...args)
  } catch (error) {
    /* ignore */
  }
}
