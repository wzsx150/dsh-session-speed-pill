/**
 * Host half of `dsh-session-speed-pill`.
 *
 * It contributes exactly one thing: the `sessionSpeed` session projection. The
 * projection registry owns the `session/event` subscription, the per-session
 * watermark cache, and the wire publication, so this plugin never subscribes,
 * never rescans `session.events`, and never appends events.
 *
 * @module dsh-session-speed-pill
 */

import { debug, debugEnabled } from './lib/debug.js'
import { SESSION_SPEED_KEY, sessionSpeedProjection } from './lib/projection.js'

/** Loader entry id, also used by the bundle patch. */
export const name = 'dsh-session-speed-pill'

/**
 * Hard dependency: without the projection registry this plugin has nothing to
 * contribute, so it stays inactive instead of throwing.
 */
export const inject = ['sessionProjections']

/**
 * Register the projection. `register()` is itself an effect on this plugin's
 * fiber, so unloading the plugin removes the key and clients read it as
 * capability absence.
 *
 * @param ctx Plugin context.
 */
export function apply(ctx) {
  ctx.sessionProjections.register(sessionSpeedProjection)

  // Opt-in only (`DSH_SESSION_SPEED_PILL_DEBUG=1`): one line per published view,
  // which is enough to explain any number the pill shows.
  if (debugEnabled) {
    ctx.sessionProjections.onChanged((session, key, value) => {
      if (key !== SESSION_SPEED_KEY) return
      const stats = value !== null && typeof value === 'object' && Array.isArray(value.turnStats) ? value.turnStats : []
      const last = stats.length > 0 ? stats[stats.length - 1] : null
      debug(
        `session=${session.id}`,
        `v=${value?.v}`,
        `turns=${stats.length}`,
        `lastSteps=${last?.steps}`,
        `lastTps=${last?.tps}`,
        `lastDurMs=${last?.dur}`,
      )
    })
  }
}
