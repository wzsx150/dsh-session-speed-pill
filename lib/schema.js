/**
 * Minimal runtime schema objects for the `sessionProjections` contract.
 *
 * `ctx.sessionProjections.register()` declares `stateSchema` and `viewSchema`
 * as Zod schemas, and the registry only ever calls `.parse()` on them:
 *
 *   - `restore()`          → `stateSchema.parse(storedRow)`
 *   - `drive()`            → `viewSchema.parse(view(state))`
 *   - `viewCell()`         → `viewSchema.parse(view(state))`
 *
 * A Zod schema cannot be imported here: this package is installed by linking a
 * checkout, so a bare `import 'zod'` resolves from the checkout's real path and
 * finds no `node_modules`. Rather than ship a duplicate of Zod, this module
 * provides the same observable contract — `parse()` throws on a contract
 * violation, `safeParse()` reports it structurally.
 *
 * Validation is deliberately shallow: a single throwing `viewSchema` would
 * abort the *whole* projection snapshot for every other unit, so these checks
 * gate structure (the shape the fold owns) and leave arithmetic to
 * `lib/metrics.js`, which already maps every non-finite result to `null`.
 *
 * @module dsh-session-speed-pill/schema
 */

/**
 * Build a schema object exposing the Zod subset the projection registry uses.
 * @param label Human-readable name used in thrown messages.
 * @param validate `(value) => string | null` — `null` means accepted.
 */
export function createSchema(label, validate) {
  /**
   * @param value Candidate value.
   * @returns the exact input value on success.
   * @throws {Error} when the value violates this schema.
   */
  function parse(value) {
    const problem = validate(value)
    if (problem !== null) {
      throw new Error(`[dsh-session-speed-pill] ${label} schema rejected the value: ${problem}`)
    }
    return value
  }

  /**
   * Non-throwing variant, shaped like Zod's result object.
   * @param value Candidate value.
   */
  function safeParse(value) {
    const problem = validate(value)
    return problem === null
      ? { success: true, data: value }
      : { success: false, error: new Error(problem) }
  }

  return { label, parse, safeParse }
}
