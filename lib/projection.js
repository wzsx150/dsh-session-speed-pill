/**
 * The `sessionSpeed` session projection: a pure fold over committed session
 * events that answers "how fast did this message's model output actually
 * stream, how stable was it, and where did the time go".
 *
 * Design notes (all load-bearing):
 *
 * 1. **Token counts are published, but only as per-turn totals** (`inTok`,
 *    `outTok`), so the panel can show usage without recomputing tokenizer math.
 *    Everything else is rates and durations, which is what the shipped reply row
 *    does not report.
 * 2. **Decode timing comes from the committed stream record**, not from wall
 *    clock deltas between events. Every `assistant/message` carries
 *    `stream: AssistantStreamRecord[]`, each record holding `time0` and a
 *    per-chunk `dt: number[]` (milliseconds). The first and last chunk
 *    timestamps therefore give an exact per-message decode window, so TTFT and
 *    tokens/second need no process-local measurement and survive replay.
 * 3. **`apply` is pure and returns the same reference for ignored events**, so
 *    the registry's `Object.is` check costs nothing downstream.
 * 4. **`view` maps every non-finite number to `null`.** A throwing `viewSchema`
 *    would abort the projection snapshot for every other unit, so the view is
 *    sanitized rather than trusted.
 *
 * @module dsh-session-speed-pill/projection
 */

import { average, isFiniteNumber, maxOf, minOf, percentile, ratio, round } from './metrics.js'
import { createSchema } from './schema.js'
import { warn } from './debug.js'

/** Registry key. Also the client-side `useProjection()` argument. */
export const SESSION_SPEED_KEY = 'sessionSpeed'

/**
 * Bump when a field's meaning or the fold's semantics change. The projection
 * cache keys checkpoints by this number and discards rows that do not match.
 *
 * v2: each step records the assistant message id it produced, so a turn can be
 * looked up from the message id its action row receives.
 *
 * v4: the `block-start` anchor was dropped again. Measured over 151 steps,
 * `corr(prompt tokens, step-start → block-start) = 0.008`: the interval is
 * network and queueing, not prefill, so any "prefill rate" built on it divided
 * tokens by an unrelated latency (it could exceed 1e6 tok/s).
 *
 * v5: the measured tool table is gone again. Tool time is defined as
 * `总耗时 − 模型耗时`, which deliberately folds scheduling, approvals and retries
 * into it — measured over a full session, that residual was 98% actual tool
 * execution anyway, and a separate "其他" row was more confusing than useful.
 */
export const STATE_VERSION = 5

/**
 * A decode window shorter than this cannot carry a meaningful rate: the provider
 * can deliver a whole short answer in one burst, and the "window" then measures
 * arrival jitter. Only the reported p10~p90 range is filtered by it; the weighted
 * average still uses every token-bearing window, where the effect is negligible.
 * Over 644 recorded steps the floor drops under 1% of them and removes every
 * rate above 1000 tok/s.
 */
export const MIN_RATE_WINDOW_MS = 100

/* -------------------------------------------------------------------------- */
/* state schema                                                               */
/* -------------------------------------------------------------------------- */

function isStepRecord(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    isFiniteNumber(value.step) &&
    isFiniteNumber(value.start) &&
    (value.first === null || isFiniteNumber(value.first)) &&
    (value.last === null || isFiniteNumber(value.last)) &&
    isFiniteNumber(value.out) &&
    isFiniteNumber(value.inp) &&
    (value.mid === null || value.mid === undefined || typeof value.mid === 'string')
  )
}

function isTurnRecord(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    isFiniteNumber(value.turn) &&
    isFiniteNumber(value.start) &&
    (value.end === null || isFiniteNumber(value.end)) &&
    (value.reason === null || typeof value.reason === 'string') &&
    Array.isArray(value.steps) &&
    value.steps.every(isStepRecord)
  )
}

const stateSchema = createSchema('state', (value) => {
  if (value === null || typeof value !== 'object') return 'not an object'
  if (value.stateVersion !== STATE_VERSION) return `stateVersion must be ${STATE_VERSION}`
  if (!Array.isArray(value.turns)) return 'turns must be an array'
  if (!value.turns.every(isTurnRecord)) return 'turns contains a malformed turn record'
  return null
})

const viewSchema = createSchema('view', (value) => {
  if (value === null || typeof value !== 'object') return 'not an object'
  if (value.v !== STATE_VERSION) return `v must be ${STATE_VERSION}`
  if (!Array.isArray(value.turnStats)) return 'turnStats must be an array'
  return null
})

/* -------------------------------------------------------------------------- */
/* fold                                                                       */
/* -------------------------------------------------------------------------- */

/** Fresh empty state. */
function init() {
  return { stateVersion: STATE_VERSION, turns: [] }
}

/** Whole-number turn/step discriminators, or `null` when the event is unusable. */
function toIndex(value) {
  return Number.isInteger(value) && value >= 0 ? value : null
}

/**
 * The envelope timestamp, or `null`.
 *
 * Every stored record holds absolute millisecond timestamps and `stateSchema`
 * requires them to be finite. Coercing a missing or corrupted `event.time` to
 * `null` here skips such an event instead of poisoning the state, which would
 * otherwise make a later `restore()` throw on schema validation and force a full
 * refold.
 */
function timeOf(event) {
  return isFiniteNumber(event.time) ? event.time : null
}

function indexOfTurn(turns, turn) {
  for (let i = 0; i < turns.length; i++) if (turns[i].turn === turn) return i
  return -1
}

/** Replace one turn, preserving the `state` identity when nothing changed. */
function replaceTurn(state, index, nextTurn) {
  const previous = state.turns[index]
  if (previous === nextTurn) return state
  const turns = state.turns.slice()
  turns[index] = nextTurn
  return { stateVersion: STATE_VERSION, turns }
}

/** Append one turn. */
function appendTurn(state, turnRecord) {
  return { stateVersion: STATE_VERSION, turns: state.turns.concat([turnRecord]) }
}

/**
 * Exact bounds of one message's stream.
 *
 * Each record's own `time0` is its anchor and `dt[i]` the gap before chunk `i`,
 * so the absolute time of chunk `i` is `time0 + sum(dt[0..i])`. The same block
 * index can appear in several records (a record per delta batch), so the bounds
 * are the min/max across all of them.
 *
 * @param stream `AssistantStreamRecord[]` as committed on `assistant/message`.
 * @returns `{ first, last }` with `null` for absent timestamps.
 */
function chunkBounds(stream) {
  let first = null
  let last = null
  if (!Array.isArray(stream)) return { first, last }
  for (const record of stream) {
    if (record === null || typeof record !== 'object') continue
    // `chunk` records are the raw provider chunks without a delta timeline.
    if (record.type === 'chunk') continue
    const time0 = record.time0
    const dt = record.dt
    if (!isFiniteNumber(time0) || !Array.isArray(dt) || dt.length === 0) continue
    let accumulated = 0
    for (let i = 0; i < dt.length; i++) {
      const delta = dt[i]
      if (!isFiniteNumber(delta)) continue
      accumulated += delta
      const at = time0 + accumulated
      if (first === null || at < first) first = at
      if (last === null || at > last) last = at
    }
  }
  return { first, last }
}

/** Lower of two nullable timestamps. */
function earliest(left, right) {
  if (left === null) return right
  if (right === null) return left
  return Math.min(left, right)
}

/** Higher of two nullable timestamps. */
function latest(left, right) {
  if (left === null) return right
  if (right === null) return left
  return Math.max(left, right)
}

/** Upsert one step inside a turn, copying only the arrays that actually change. */
function updateStep(turn, stepNumber, mutator) {
  const steps = turn.steps
  let index = -1
  for (let i = 0; i < steps.length; i++) if (steps[i].step === stepNumber) index = i
  const previous = index === -1 ? null : steps[index]
  const next = mutator(previous)
  if (next === previous) return turn
  if (index === -1) return { ...turn, steps: steps.concat([next]) }
  const copy = steps.slice()
  copy[index] = next
  return { ...turn, steps: copy }
}

/**
 * A fresh step record.
 *
 * `first` is the first *content* chunk and `last` the last one; both are absolute
 * timestamps reconstructed from the delta timeline.
 */
function newStep(step, start) {
  return { step, start, first: null, last: null, out: 0, inp: 0, mid: null }
}

/** A fresh turn record. */
function newTurnRecord(turn, start, steps) {
  return { turn, start, end: null, reason: null, steps }
}

/**
 * Pure, synchronous fold. Returns the identical `state` reference for every
 * event this unit does not care about, which is most of them.
 */
function fold(state, event) {
  const data = event.data
  if (data === null || typeof data !== 'object') return state

  switch (event.type) {
    case 'turn/start': {
      const turn = toIndex(data.turn)
      const at = timeOf(event)
      if (turn === null || at === null) return state
      const index = indexOfTurn(state.turns, turn)
      if (index === -1) {
        return appendTurn(state, newTurnRecord(turn, at, []))
      }
      const previous = state.turns[index]
      // A closed turn is never reopened, and its folded steps are never dropped.
      // The only legitimate second start is a real one arriving after the
      // synthetic turn that `step/start` had to create, and it can only move the
      // start earlier.
      if (previous.end !== null) return state
      const start = Math.min(previous.start, at)
      if (start === previous.start) return state
      return replaceTurn(state, index, { ...previous, start })
    }

    case 'step/start': {
      const turn = toIndex(data.turn)
      const step = toIndex(data.step)
      const at = timeOf(event)
      if (turn === null || step === null || at === null) return state
      const index = indexOfTurn(state.turns, turn)
      if (index === -1) {
        // A forked or compacted session can resume inside a turn whose
        // `turn/start` is not in this log; keep the step rather than drop it.
        return appendTurn(state, newTurnRecord(turn, at, [newStep(step, at)]))
      }
      const nextTurn = updateStep(state.turns[index], step, (previous) => {
        if (previous !== null) return previous
        return newStep(step, at)
      })
      return replaceTurn(state, index, nextTurn)
    }

    case 'assistant/message': {
      const turn = toIndex(data.turn)
      const step = toIndex(data.step)
      const at = timeOf(event)
      if (turn === null || step === null || at === null) return state
      const index = indexOfTurn(state.turns, turn)
      if (index === -1) return state
      const bounds = chunkBounds(data.stream)
      const usage = data.usage !== null && typeof data.usage === 'object' ? data.usage : null
      const outputTokens = usage !== null && isFiniteNumber(usage.outputTokens) ? usage.outputTokens : 0
      const inputTokens = usage !== null && isFiniteNumber(usage.inputTokens) ? usage.inputTokens : 0
      const message = data.message !== null && typeof data.message === 'object' ? data.message : null
      const messageId = message !== null && typeof message.id === 'string' ? message.id : null
      const nextTurn = updateStep(state.turns[index], step, (previous) => {
        if (previous === null) {
          return {
            step,
            start: at,
            first: bounds.first,
            last: bounds.last,
            out: Math.max(0, outputTokens),
            inp: Math.max(0, inputTokens),
            mid: messageId,
          }
        }
        // A retried step reports again: widen the window, keep the larger count.
        const out = Math.max(previous.out, outputTokens)
        const inp = Math.max(previous.inp, inputTokens)
        const first = earliest(previous.first, bounds.first)
        const last = latest(previous.last, bounds.last)
        const mid = messageId === null ? previous.mid : messageId
        if (
          out === previous.out &&
          inp === previous.inp &&
          first === previous.first &&
          last === previous.last &&
          mid === previous.mid
        ) {
          return previous
        }
        return { step, start: previous.start, first, last, out, inp, mid }
      })
      return replaceTurn(state, index, nextTurn)
    }

    case 'turn/end': {
      const turn = toIndex(data.turn)
      const at = timeOf(event)
      if (turn === null || at === null) return state
      const index = indexOfTurn(state.turns, turn)
      if (index === -1) return state
      const previous = state.turns[index]
      const reason = data.reason !== null && typeof data.reason === 'object' && typeof data.reason.kind === 'string'
        ? data.reason.kind
        : null
      if (previous.end !== null && previous.reason === reason) return state
      return replaceTurn(state, index, { ...previous, end: at, reason })
    }

    default:
      return state
  }
}

let foldFailureReported = false

/**
 * The unit's `apply`, wrapped so this plugin can never break its caller.
 *
 * This function runs inside the committed `session/event` dispatch of every
 * session, so a throw here does not merely hide a number: it aborts the turn
 * that emitted the event. (Observed in practice — an earlier build's
 * `ReferenceError` surfaced as a `turn/end` with
 * `{ kind: 'error', error: { message: '<fn> is not defined' } }`.)
 *
 * So a fold failure degrades to "ignore this event, keep the previous state",
 * reports itself once, and leaves the session untouched. `fold` is written to
 * never throw; this is the backstop that makes that claim unbreakable.
 */
function apply(state, event) {
  try {
    return fold(state, event)
  } catch (error) {
    if (!foldFailureReported) {
      foldFailureReported = true
      warn('投影折叠失败，已跳过该事件并保持上一次状态（本进程只提示一次）：', error)
    }
    return state
  }
}

/* -------------------------------------------------------------------------- */
/* client view                                                                */
/* -------------------------------------------------------------------------- */

/**
 * One entry per turn, keyed by the assistant message id of that turn's final
 * step — exactly the `messageId` the action row receives.
 *
 * Every figure is scoped to this one turn (one question plus its answer).
 * Only the values the panel actually prints are emitted, which keeps the wire
 * payload proportional to the number of turns rather than the number of steps.
 *
 * @param turn One folded turn record.
 * @returns The turn's statistics, or `null` when no step produced a message.
 */
function turnStat(turn) {
  let id = null
  for (const step of turn.steps) {
    if (typeof step.mid === 'string' && step.mid !== '') id = step.mid
  }
  if (id === null) return null

  const ttfts = []
  const decodeSpeeds = []
  const prefills = []
  let tokens = 0
  let decodeMs = 0
  let speedDecodeMs = 0
  let modelMs = 0
  let prefillTokens = 0
  let prefillMs = 0
  // Usage totals count every step, including ones with no usable stream record.
  let inTokens = 0
  let outTokens = 0

  for (const step of turn.steps) {
    const hasFirst = isFiniteNumber(step.first)
    const hasLast = isFiniteNumber(step.last)
    const hasWindow = hasFirst && hasLast && step.last > step.first

    inTokens += step.inp
    outTokens += step.out

    if (hasFirst) {
      const ttftMs = step.first - step.start
      if (ttftMs >= 0) ttfts.push(ttftMs)
      // Estimated prompt throughput. TTFT = fixed latency + prefill + first-token,
      // so `uncached / TTFT` can only UNDERSTATE the real prefill rate — it is a
      // lower bound, which is why the panel labels it 估算.
      if (step.inp > 0 && ttftMs > 0) {
        prefills.push(step.inp / (ttftMs / 1000))
        prefillTokens += step.inp
        prefillMs += ttftMs
      }
      // Model time accrues from the request, not from the first chunk: a step
      // that emitted a single chunk (`last === first`) still had the model busy
      // since `start`. Skipping those would push their whole duration into the
      // tool residual.
      const end = hasLast && step.last >= step.first ? step.last : step.first
      modelMs += Math.max(0, end - step.start)
    }

    if (!hasWindow) continue
    const span = step.last - step.first
    decodeMs += span
    if (step.out > 0) {
      tokens += step.out
      // Only windows that actually produced tokens may enter the rate's
      // denominator, so an empty window can never depress the average.
      speedDecodeMs += span
      // The *range* additionally ignores sub-100 ms windows: when the provider
      // delivers a whole answer in one burst, `last - first` measures network
      // jitter rather than generation, and 69 tokens over 23 ms would read as
      // 3000 tok/s. Measured over 606 steps, a 100 ms floor removes every
      // >1000 tok/s artifact and keeps 601 of them.
      if (span >= MIN_RATE_WINDOW_MS) decodeSpeeds.push(step.out / (span / 1000))
    }
  }

  const duration = turn.end === null ? null : Math.max(0, turn.end - turn.start)
  // Tool time is the residual: everything the turn spent outside model requests,
  // which in practice is tool execution plus the scheduling around it.
  const toolMs = duration === null ? null : Math.max(0, duration - modelMs)

  return {
    id,
    steps: turn.steps.length,
    dur: round(duration, 0),
    modelMs: round(modelMs, 0),
    toolMs: round(toolMs, 0),
    decodeMs: round(decodeMs, 0),
    ttftMin: round(minOf(ttfts), 0),
    ttftAvg: round(average(ttfts), 0),
    ttftMax: round(maxOf(ttfts), 0),
    tps: round(ratio(tokens, speedDecodeMs / 1000)),
    // p10..p90 rather than min..max: with 21 samples the extremes are one lucky
    // and one unlucky step, which read as a 114x spread instead of the real 2.2x.
    tpsMin: round(percentile(decodeSpeeds, 10)),
    tpsMax: round(percentile(decodeSpeeds, 90)),
    /** Estimated prompt throughput; a lower bound (see the fold's comment). */
    preMin: round(percentile(prefills, 10)),
    preAvg: round(ratio(prefillTokens, prefillMs / 1000)),
    preMax: round(percentile(prefills, 90)),
    /** Sum of the first-token latency over the steps that carried uncached input. */
    preMs: round(prefillMs, 0),
    /** Uncached input tokens, summed over every step of the turn. */
    inTok: round(inTokens, 0),
    /** Output tokens, summed over every step of the turn. */
    outTok: round(outTokens, 0),
  }
}

/**
 * Derived, already-computed values for the client. The client renders these
 * directly and never folds session events itself.
 */
function view(state) {
  const turnStats = []
  for (const turn of state.turns) {
    const stat = turnStat(turn)
    if (stat !== null) turnStats.push(stat)
  }
  return { v: STATE_VERSION, turnStats }
}

/** The complete `register()` argument. */
export const sessionSpeedProjection = {
  key: SESSION_SPEED_KEY,
  stateVersion: STATE_VERSION,
  stateSchema,
  init,
  apply,
  wire: {
    viewSchema,
    view,
  },
}
