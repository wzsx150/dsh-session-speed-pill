/**
 * Browser half of `dsh-session-speed-pill`.
 *
 * Two contributions, both additive:
 *
 * 1. `conversation.chat.assistant-actions` — one entry in the row under every
 *    settled turn, sitting between the usage control and the clock. It shows
 *    **this turn's** decode speed and wall time, and opens a panel with the
 *    per-turn breakdown.
 * 2. `settings.general.item` — one preference row that pins every message's
 *    action row visible instead of revealing it on hover.
 *
 * The pill copies the shipped usage trigger's metrics, and the panel copies the
 * shipped stat dialog's metrics, so both read as part of the same UI.
 *
 * All statistics arrive pre-computed through `useProjection('sessionSpeed')`;
 * this module never folds session events and never imports a Host package.
 *
 * @module dsh-session-speed-pill/client
 */

// `window` is the loader's documented home; the guarded fallback exists only so
// a missing loader degrades to a no-op instead of a thrown error at boot.
;(typeof window !== 'undefined' ? window : globalThis).__ModuleLoader__?.load?.({
  id: 'dsh-session-speed-pill',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // `react-dom` is only needed to lift the panel out of the row's layout box.
    // Without it the panel still renders — `position: fixed` works in place as
    // long as no ancestor establishes a containing block.
    let createPortal = null
    try {
      const reactDom = require('react-dom')
      if (reactDom && typeof reactDom.createPortal === 'function') createPortal = reactDom.createPortal
    } catch (error) {
      createPortal = null
    }

    /* ---------------------------------------------------------------- */
    /* stylesheet: placement + "always show" preference                  */
    /* ---------------------------------------------------------------- */

    const PREF_KEY = 'dsh-session-speed-pill:always-show-actions'
    const STYLE_TAG = 'dsh-session-speed-pill/styles'

    /**
     * Identifies this module generation.
     *
     * A hot reload starts the new module before the old one is disposed, and both
     * share one style-tag id. Without this token the old disposer deletes the tag
     * the new module just wrote, leaving the page with no rules at all — which is
     * exactly how the placement silently stopped working once already.
     */
    const INSTANCE = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

    /**
     * Placement.
     *
     * The shipped row renders `[clock?][copy][slot entries][branch][usage][clock]`,
     * where usage and the clock share one `span` that is itself an `inline-flex`
     * cluster. A slot entry cannot be emitted inside that span, so the cluster is
     * turned into `display: contents` — its children become flex items of the row
     * — and `order` interleaves the pill between them. `.actions` already owns an
     * 8px gap, so spacing is preserved; the moved `margin-left` keeps the original
     * offset before the usage control.
     *
     * The second pill rule is a fallback for a host that wraps slot entries in an
     * extra element instead of the current `display: contents` anchor.
     */
    const ORDER_CSS = [
      '[data-clock="end"]>span:last-child{display:contents}',
      '[data-clock="end"]>span:last-child>:first-child{order:20;margin-left:8px}',
      // The slot outlet anchor is `display: contents`, so it generates no box but
      // IS still the pill's DOM parent. A child combinator (`>`) therefore never
      // matches — the pill is a flex item only in the box tree. This must be a
      // descendant selector; that mistake cost two rounds.
      '[data-actions-reveal] [class*="_actions"] [data-dsh-ssp]{order:21}',
      // Fallback for a host whose outlet anchor does generate a box: order the
      // wrapper instead of the pill.
      '[data-actions-reveal] [class*="_actions"]>:has(>[data-dsh-ssp]){order:21}',
      '[data-clock="end"]>span:last-child>:last-child{order:22}',
    ].join('')

    /**
     * "Always show" override.
     *
     * The shipped transcript hides a finished turn's row unless that turn is the
     * newest reply (`[data-actions-reveal="hover"]`), and hides a sent message's
     * copy/clock row once a later message exists
     * (`:is([data-chat-flow-kind=user]…):has(~ …)`). Both hide with plain
     * `opacity: 0` inside `@media (hover: hover)`. Class names are `<hash>_actions`
     * and the hash changes per build, so the selector matches the module suffix.
     */
    const REVEAL_CSS =
      '@media (hover: hover){' +
      '[data-actions-reveal="hover"] [class*="_actions"],' +
      '[data-chat-flow-kind="user"] [class*="_actions"],' +
      '[data-chat-flow-kind="steering"] [class*="_actions"]' +
      '{opacity:1 !important}}'

    function readPreference() {
      try {
        return window.localStorage.getItem(PREF_KEY) === '1'
      } catch (error) {
        return false
      }
    }

    function writePreference(value) {
      try {
        window.localStorage.setItem(PREF_KEY, value ? '1' : '0')
      } catch (error) {
        /* private mode or a blocked store: the toggle still applies to this page */
      }
    }

    let alwaysShowActions = readPreference()
    const preferenceListeners = new Set()
    let styleAsserted = false

    function setAlwaysShowActions(next) {
      const value = next === true
      if (value === alwaysShowActions) return
      alwaysShowActions = value
      writePreference(value)
      for (const listener of preferenceListeners) {
        try {
          listener()
        } catch (error) {
          /* one failing listener must not stop the others */
        }
      }
    }

    /** Local binding for the preference, shared by every component that reads it. */
    function useAlwaysShowActions() {
      const [value, setValue] = React.useState(alwaysShowActions)
      React.useEffect(() => {
        const listener = () => setValue(alwaysShowActions)
        preferenceListeners.add(listener)
        listener()
        return () => {
          preferenceListeners.delete(listener)
        }
      }, [])
      return value
    }

    /** The plugin's one deduplicated stylesheet. */
    function styleElement() {
      const selector = `style[data-plugin-css="${STYLE_TAG}"]`
      let tag = document.querySelector(selector)
      if (tag === null) {
        tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-session-speed-pill'
        tag.dataset.pluginCss = STYLE_TAG
        document.head.appendChild(tag)
      }
      tag.dataset.pluginInstance = INSTANCE
      return tag
    }

    function syncStyle() {
      try {
        styleElement().textContent = ORDER_CSS + (alwaysShowActions ? REVEAL_CSS : '')
      } catch (error) {
        /* a document without a head is not worth breaking the plugin over */
      }
    }

    function dropStyle() {
      try {
        const tag = document.querySelector(`style[data-plugin-css="${STYLE_TAG}"]`)
        // Another generation owns it now; deleting it would break that one.
        if (tag !== null && tag.dataset.pluginInstance === INSTANCE) tag.remove()
      } catch (error) {
        /* nothing to undo */
      }
    }

    /* ---------------------------------------------------------------- */
    /* copy                                                             */
    /* ---------------------------------------------------------------- */

    const ZH = {
      cjk: true,
      pillLabel: '本轮生成速度',
      panelTitle: '本轮对话',
      unitTps: 'tok/s',
      unitTok: 'tok',
      lblMax: '最大',
      lblMin: '最小',
      lblAvg: '平均',
      rowAnswerTime: '回答耗时',
      rowTtft: '首字延迟',
      rowDecodeOut: '解码输出',
      rowPrefillIn: '预填充输入（估算）',
      rowTurnSpeed: '本轮解码速度（估算）',
      rowPrefillSpeed: '本轮预填充速度（估算）',
      rowUsage: '总用量',
      timeModel: '模型',
      timeTool: '工具',
      totalTime: '总耗时',
      total: '合计',
      usageInput: '输入',
      usageOutput: '输出',
      titleMeta: (steps) => `共 ${steps} 步`,
      footnote: '注：输入 token 均为未缓存输入，估算数值受网络延迟影响很大，仅供参考。',
      settingTitle: '始终显示消息操作行',
      settingDescription:
        '开启后常驻显示每条消息的操作行（复制、点赞、分享、用量、时间等内容）；默认为关闭，仅常驻显示最新一轮的，其余需要悬停才会显示',
    }

    const EN = {
      cjk: false,
      pillLabel: 'Turn generation speed',
      panelTitle: 'This turn',
      unitTps: 'tok/s',
      unitTok: 'tok',
      lblMax: 'Max',
      lblMin: 'Min',
      lblAvg: 'Avg',
      rowAnswerTime: 'Response time',
      rowTtft: 'First-token latency',
      rowDecodeOut: 'Decode output',
      rowPrefillIn: 'Prefill input (estimated)',
      rowTurnSpeed: 'Turn decode speed (estimated)',
      rowPrefillSpeed: 'Turn prefill speed (estimated)',
      rowUsage: 'Total usage',
      timeModel: 'Model',
      timeTool: 'Tool',
      // Not "Total": `total` below is already the sum of the decode windows, and
      // two different "Total" values in one panel read as a contradiction.
      totalTime: 'Total time',
      total: 'Sum',
      usageInput: 'Input',
      usageOutput: 'Output',
      titleMeta: (steps) => `${steps} ${steps === 1 ? 'step' : 'steps'}`,
      footnote:
        'Note: input tokens are uncached input. Estimated figures are strongly affected by network latency; use them as a rough reference only.',
      settingTitle: 'Always show message actions',
      settingDescription:
        'Keep every message action row visible (copy, feedback, share, usage, time and more). Off by default: only the newest turn stays visible, the rest appear on hover.',
    }

    /**
     * The shipped locale service writes the active language onto `<html lang>`
     * (`zh` becomes `zh-CN`), so reading it keeps this plugin in step with
     * Settings → Language. Chinese gets Chinese; everything else — English and
     * any language without a translation — gets English.
     */
    function strings() {
      let lang = ''
      try {
        lang = String((document.documentElement && document.documentElement.lang) || '')
      } catch (error) {
        lang = ''
      }
      return lang.toLowerCase().startsWith('zh') ? ZH : EN
    }

    /* ---------------------------------------------------------------- */
    /* formatting                                                       */
    /* ---------------------------------------------------------------- */

    function isNumber(value) {
      return typeof value === 'number' && Number.isFinite(value)
    }

    const DASH = '—'

    /** `89.4` → `89.4`, `120.0` → `120`, anything unusable → `—`. */
    function formatTps(value) {
      if (!isNumber(value) || value < 0) return DASH
      const text = value < 100 ? value.toFixed(1) : String(Math.round(value))
      return text.replace(/\.0$/, '')
    }

    /**
     * `12.3秒` / `7分49秒` / `1小时05分`; English `12.3s` / `7m 49s` / `1h 05m`.
     * Past one hour the seconds are dropped, as requested.
     */
    function formatDuration(milliseconds, L) {
      if (!isNumber(milliseconds) || milliseconds < 0) return DASH
      const totalSeconds = Math.round(milliseconds / 1000)
      if (totalSeconds < 60) {
        const seconds = (milliseconds / 1000).toFixed(1).replace(/\.0$/, '')
        return L.cjk ? `${seconds}秒` : `${seconds}s`
      }
      const minutes = Math.floor(totalSeconds / 60)
      const seconds = totalSeconds % 60
      if (minutes < 60) {
        return L.cjk
          ? `${minutes}分${String(seconds).padStart(2, '0')}秒`
          : `${minutes}m ${String(seconds).padStart(2, '0')}s`
      }
      const hours = Math.floor(minutes / 60)
      return L.cjk
        ? `${hours}小时${String(minutes % 60).padStart(2, '0')}分`
        : `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
    }

    /** `242 tok/s`, or a bare dash: `— tok/s` reads like a broken value. */
    function tpsText(L, value) {
      return isNumber(value) && value >= 0 ? `${formatTps(value)} ${L.unitTps}` : DASH
    }

    /** `最大 1.8秒 · 最小 0.6秒 · 平均 1.2秒` */
    function durationTriple(L, maxLabel, max, minLabel, min, avgLabel, avg) {
      return `${maxLabel} ${formatDuration(max, L)} · ${minLabel} ${formatDuration(min, L)} · ${avgLabel} ${formatDuration(avg, L)}`
    }

    /** `194 tok/s ~ 451 tok/s`; collapses to one value for a single-step turn. */
    function range(L, min, max) {
      if (!isNumber(min) || !isNumber(max)) return DASH
      if (Math.round(min * 10) === Math.round(max * 10)) return `${formatTps(min)} ${L.unitTps}`
      return `${formatTps(min)} ${L.unitTps} ~ ${formatTps(max)} ${L.unitTps}`
    }

    /**
     * Compact token counts, matching what the shipped usage pill shows (`11.4M`).
     * `8411` → `≈8.4K`, `1120` → `≈1.1K`, `745` → `745`, `8000` → `8K`.
     * The `≈` appears only when the printed value really is rounded, and a value
     * that rounds up across a unit boundary is promoted: `999950` → `≈1M`, never
     * `≈1000K`.
     */
    function formatTokens(value) {
      if (!isNumber(value)) return DASH
      const n = Math.abs(Math.round(value))
      if (n < 1000) return String(n)
      const units = [[1e3, 'K'], [1e6, 'M'], [1e9, 'B']]
      let index = 0
      for (;;) {
        const [scale, unit] = units[index]
        const scaled = n / scale
        const digits = scaled < 100 ? 1 : 0
        const text = String(Number(scaled.toFixed(digits)))
        if (Number(text) >= 1000 && index + 1 < units.length) {
          index += 1
          continue
        }
        const approx = Math.abs(Number(text) * scale - n) > 1e-9
        return `${approx ? '≈' : ''}${text}${unit}`
      }
    }

    /* ---------------------------------------------------------------- */
    /* per-turn index                                                   */
    /* ---------------------------------------------------------------- */

    /**
     * `view.turnStats` is keyed by the assistant message id the action row
     * receives. Index it once per view object and keep that index weak: the
     * projection replaces the whole view on change, so stale entries disappear
     * with it.
     */
    const indexCache = new WeakMap()

    function turnIndex(view) {
      if (view === null || typeof view !== 'object') return null
      let index = indexCache.get(view)
      if (index === undefined) {
        index = new Map()
        const stats = view.turnStats
        if (Array.isArray(stats)) {
          for (const stat of stats) {
            if (stat !== null && typeof stat === 'object' && typeof stat.id === 'string' && !index.has(stat.id)) {
              index.set(stat.id, stat)
            }
          }
        }
        indexCache.set(view, index)
      }
      return index
    }

    /* ---------------------------------------------------------------- */
    /* styles                                                           */
    /* ---------------------------------------------------------------- */

    /** The shipped usage trigger, reproduced. */
    const TRIGGER = {
      boxSizing: 'border-box',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      minWidth: 0,
      maxWidth: '100%',
      height: 'calc(28px + var(--dsh-content-font-delta, 0px))',
      padding: '6px 8px',
      border: 'none',
      background: '0 0',
      borderRadius: 'var(--dsw-radius-sm)',
      color: 'var(--dsw-alias-label-tertiary)',
      font: 'inherit',
      fontSize: 'calc(var(--dsh-content-font-size-secondary, 13px) - 1px)',
      lineHeight: 'calc(24px + var(--dsh-content-font-delta, 0px))',
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap',
      cursor: 'pointer',
    }

    const TRIGGER_HOVER = {
      background: 'var(--dsw-alias-interactive-bg-hover)',
      color: 'var(--dsw-alias-label-tertiary)',
    }

    const ICON = { flex: '0 0 auto', display: 'inline-flex' }

    const SEPARATOR = { color: 'var(--dsw-alias-border-l2)', margin: '0 1px' }

    const CLIP = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }

    /** The shipped stat dialog, reproduced. */
    const PANEL = {
      zIndex: 1100,
      boxSizing: 'border-box',
      borderRadius: 'var(--dsw-radius-lg)',
      background: 'var(--dsw-specific-menu)',
      // Wide enough for the longest English row ("Turn prefill speed (estimated)"
      // beside "210 tok/s ~ 4332 tok/s") and for the Chinese answer-time row, so
      // neither wraps mid-value; the panel still shrinks to content below this.
      width: 'max-content',
      minWidth: 'min(300px, 100vw - 24px)',
      maxWidth: 'min(520px, 100vw - 24px)',
      backdropFilter: 'var(--dsw-menu-backdrop-filter)',
      '--dsw-elevation-stroke-color': 'var(--dsw-alias-border-l1)',
      boxShadow: 'var(--dsw-elevation-prominent)',
      color: 'var(--dsw-alias-label-secondary)',
      cursor: 'default',
      border: 0,
      padding: 16,
      fontSize: 12,
      lineHeight: '18px',
      position: 'fixed',
    }

    const PANEL_MEASURE = { visibility: 'hidden', left: 0, top: 0 }

    const PANEL_TITLE = {
      display: 'flex',
      justifyContent: 'space-between',
      gap: 16,
      marginBottom: 8,
      fontWeight: 500,
      color: 'var(--dsw-alias-label-primary)',
    }

    const PANEL_TITLE_LABEL = { display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }

    const PANEL_TITLE_VALUE = {
      fontVariantNumeric: 'tabular-nums',
      color: 'var(--dsw-alias-label-secondary)',
      whiteSpace: 'nowrap',
    }

    const PANEL_TITLE_RULE = { borderTop: '0.5px solid var(--dsw-alias-border-l2)', marginBottom: 10 }

    const PANEL_DETAILS = {
      display: 'grid',
      gridTemplateColumns: 'minmax(76px, auto) minmax(0, 1fr)',
      gap: '6px 16px',
      margin: 0,
      color: 'var(--dsw-alias-label-tertiary)',
    }

    const PANEL_DT = { minWidth: 0, margin: 0 }

    const PANEL_DD = {
      minWidth: 0,
      margin: 0,
      color: 'var(--dsw-alias-label-secondary)',
      fontVariantNumeric: 'tabular-nums',
      textAlign: 'right',
    }

    const PANEL_NOTE = {
      margin: '10px 0 0',
      paddingTop: 8,
      borderTop: '0.5px solid var(--dsw-alias-border-l2)',
      color: 'var(--dsw-alias-label-tertiary)',
      fontSize: 11,
      lineHeight: '16px',
    }

    /* Settings row: the same metrics the shipped DeveloperToolsRow uses. */
    const SETTINGS_ROW = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '24px',
      padding: '16px 0',
      borderBottom: '0.5px solid var(--dsw-alias-border-l2)',
    }

    const SETTINGS_TITLE = { fontSize: '14px', lineHeight: '20px' }

    const SETTINGS_DESCRIPTION = {
      marginTop: '4px',
      color: 'var(--dsw-alias-label-secondary)',
      fontSize: '12px',
      lineHeight: '18px',
    }

    const SWITCH = {
      position: 'relative',
      flex: '0 0 auto',
      boxSizing: 'border-box',
      width: '36px',
      height: '20px',
      padding: 0,
      border: 'none',
      borderRadius: '999px',
      cursor: 'pointer',
      transition: 'background 120ms',
    }

    const SWITCH_THUMB = {
      position: 'absolute',
      top: '2px',
      left: '2px',
      width: '16px',
      height: '16px',
      borderRadius: '50%',
      // The thumb must contrast with the brand-coloured track in both themes,
      // which is exactly what a literal white does and a theme token cannot.
      background: '#ffffff',
      transition: 'transform 120ms',
    }

    /* ---------------------------------------------------------------- */
    /* icon                                                             */
    /* ---------------------------------------------------------------- */

    /** A bolt on a 16px grid, sized like the shipped outline icons. */
    function BoltIcon({ size = 15 }) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          'aria-hidden': 'true',
          focusable: 'false',
          style: { display: 'block' },
        },
        h('path', { d: 'M9.1 1.4 3.3 9.25h3.72L6.35 14.6 12.7 7.05H8.8z', fill: 'currentColor' }),
      )
    }

    /* ---------------------------------------------------------------- */
    /* panel                                                            */
    /* ---------------------------------------------------------------- */

    /**
     * The overlay. Positioned near the trigger, clamped into the viewport, closed
     * by Escape or an outside pointer, and re-placed when its own size changes.
     */
    function Panel({ anchorRef, onClose, label, children }) {
      const panelRef = React.useRef(null)
      const [position, setPosition] = React.useState(null)

      React.useLayoutEffect(() => {
        const place = () => {
          const anchor = anchorRef.current
          const panel = panelRef.current
          if (!anchor || !panel) return
          const rect = anchor.getBoundingClientRect()
          const width = panel.offsetWidth
          const height = panel.offsetHeight
          const margin = 8
          const maxLeft = Math.max(margin, window.innerWidth - width - margin)
          const left = Math.max(margin, Math.min(rect.left, maxLeft))
          // Prefer above the action row; fall back below when there is no room.
          let top = rect.top - height - 6
          if (top < margin) {
            top = Math.min(rect.bottom + 6, Math.max(margin, window.innerHeight - height - margin))
          }
          setPosition({ left, top })
        }
        place()

        let frame = 0
        const request = typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame
          : (callback) => setTimeout(callback, 16)
        const cancel = typeof cancelAnimationFrame === 'function'
          ? cancelAnimationFrame
          : (handle) => clearTimeout(handle)
        const schedule = () => {
          if (frame !== 0) return
          frame = request(() => {
            frame = 0
            place()
          })
        }

        let observer = null
        try {
          const ResizeObserverImpl = window.ResizeObserver
          if (typeof ResizeObserverImpl === 'function' && panelRef.current !== null) {
            observer = new ResizeObserverImpl(() => schedule())
            observer.observe(panelRef.current)
          }
        } catch (error) {
          observer = null
        }

        window.addEventListener('resize', schedule)
        window.addEventListener('scroll', schedule, true)
        return () => {
          window.removeEventListener('resize', schedule)
          window.removeEventListener('scroll', schedule, true)
          if (observer !== null) observer.disconnect()
          if (frame !== 0) cancel(frame)
        }
      }, [anchorRef])

      React.useEffect(() => {
        const onPointerDown = (event) => {
          const target = event.target
          if (panelRef.current && panelRef.current.contains(target)) return
          if (anchorRef.current && anchorRef.current.contains(target)) return
          onClose()
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') onClose()
        }
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown)
        }
      }, [anchorRef, onClose])

      const style = position === null ? { ...PANEL, ...PANEL_MEASURE } : { ...PANEL, ...position }
      const node = h('div', { ref: panelRef, role: 'dialog', 'aria-label': label, style }, children)
      if (createPortal !== null) {
        try {
          return createPortal(node, document.body)
        } catch (error) {
          return node
        }
      }
      return node
    }

    /* ---------------------------------------------------------------- */
    /* pill                                                             */
    /* ---------------------------------------------------------------- */

    /** Keeps the hook call order identical when the slot does not offer the seat. */
    function useNoProjection() {
      React.useState(0)
      return undefined
    }

    function SpeedPill(props) {
      // Hooks run unconditionally, before any early return: a turn with no
      // measurement yet must not change this component's hook count later.
      const useProjection = typeof props.useProjection === 'function' ? props.useProjection : useNoProjection
      const projection = useProjection('sessionSpeed')
      const [open, setOpen] = React.useState(false)
      const [hovered, setHovered] = React.useState(false)
      const anchorRef = React.useRef(null)
      const close = React.useCallback(() => setOpen(false), [])
      const toggle = React.useCallback(() => setOpen((value) => !value), [])
      // Self-heal: if anything removed the stylesheet after apply ran (hot reload,
      // another generation, a stray devtools deletion), the first mounted pill puts
      // it back. Guarded so it costs one DOM query for the whole session.
      React.useEffect(() => {
        if (styleAsserted) return
        styleAsserted = true
        syncStyle()
      }, [])
      const L = strings()

      const index = turnIndex(projection !== null && typeof projection === 'object' ? projection : null)
      const stat = index !== null && typeof props.messageId === 'string' ? index.get(props.messageId) : undefined
      if (stat === undefined) return null

      const speedText = tpsText(L, stat.tps)
      const durationText = formatDuration(stat.dur, L)
      // Full-width punctuation only for Chinese; an English tooltip must not show 「：」.
      const accessible = L.cjk
        ? `${L.pillLabel}：${speedText}，${L.totalTime} ${durationText}`
        : `${L.pillLabel}: ${speedText}, ${L.totalTime} ${durationText}`
      const steps = isNumber(stat.steps) ? stat.steps : 0

      // `工具` is the residual 总 − 模型: in practice tool execution plus the
      // scheduling and approvals around it, which is why there is no separate
      // 其他 row.
      const timeParts = [
        `${L.timeModel} ${formatDuration(stat.modelMs, L)}`,
        `${L.timeTool} ${formatDuration(stat.toolMs, L)}`,
        `${L.totalTime} ${formatDuration(stat.dur, L)}`,
      ]

      const rows = [
        [L.rowAnswerTime, timeParts.join(' · ')],
        [L.rowTtft, durationTriple(L, L.lblMax, stat.ttftMax, L.lblMin, stat.ttftMin, L.lblAvg, stat.ttftAvg)],
        [
          L.rowDecodeOut,
          `${L.lblAvg} ${tpsText(L, stat.tps)} · ${L.total} ${formatDuration(stat.decodeMs, L)}`,
        ],
        [
          L.rowPrefillIn,
          `${L.lblAvg} ${tpsText(L, stat.preAvg)} · ${L.total} ${formatDuration(stat.preMs, L)}`,
        ],
        [L.rowTurnSpeed, range(L, stat.tpsMin, stat.tpsMax)],
        [L.rowPrefillSpeed, range(L, stat.preMin, stat.preMax)],
        [
          L.rowUsage,
          `${L.usageInput} ${formatTokens(stat.inTok)} ${L.unitTok} · ${L.usageOutput} ${formatTokens(stat.outTok)} ${L.unitTok}`,
        ],
      ]

      return h(
        'span',
        { 'data-dsh-ssp': '', style: { display: 'inline-flex', minWidth: 0 } },
        h(
          'button',
          {
            ref: anchorRef,
            type: 'button',
            style: hovered || open ? { ...TRIGGER, ...TRIGGER_HOVER } : TRIGGER,
            'aria-haspopup': 'dialog',
            'aria-expanded': open,
            'aria-label': accessible,
            title: accessible,
            onClick: toggle,
            onMouseEnter: () => setHovered(true),
            onMouseLeave: () => setHovered(false),
          },
          h('span', { style: ICON, 'aria-hidden': 'true' }, h(BoltIcon, null)),
          h('span', { style: CLIP }, speedText),
          h('span', { style: SEPARATOR, 'aria-hidden': 'true' }, '·'),
          h('span', null, durationText),
        ),
        open
          ? h(
              Panel,
              { anchorRef, onClose: close, label: `${L.panelTitle} · ${accessible}` },
              h(
                'div',
                { style: PANEL_TITLE },
                h(
                  'span',
                  { style: PANEL_TITLE_LABEL },
                  h('span', { style: ICON, 'aria-hidden': 'true' }, h(BoltIcon, { size: 14 })),
                  L.panelTitle,
                ),
                h('span', { style: PANEL_TITLE_VALUE }, L.titleMeta(steps)),
              ),
              h('div', { style: PANEL_TITLE_RULE, 'aria-hidden': 'true' }),
              h(
                'dl',
                { style: PANEL_DETAILS },
                rows.flatMap((row, index) => [
                  h('dt', { key: `t${index}`, style: PANEL_DT }, row[0]),
                  h('dd', { key: `d${index}`, style: PANEL_DD }, row[1]),
                ]),
              ),
              h('div', { style: PANEL_NOTE }, L.footnote),
            )
          : null,
      )
    }

    /** A switch drawn to the shipped settings rows: brand track, white thumb. */
    function Switch({ checked, onChange, label }) {
      const on = checked === true
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': on,
          'aria-label': label,
          title: label,
          onClick: () => onChange(!on),
          style: { ...SWITCH, background: on ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)' },
        },
        h('span', {
          'aria-hidden': 'true',
          style: { ...SWITCH_THUMB, transform: on ? 'translateX(16px)' : 'translateX(0)' },
        }),
      )
    }

    /**
     * The General preference row. `settings.general.item` supplies no label and no
     * props, so the row draws its own title, description, and control.
     */
    function AlwaysShowActionsRow() {
      const enabled = useAlwaysShowActions()
      const L = strings()
      return h(
        'div',
        { style: SETTINGS_ROW },
        h(
          'div',
          { style: { minWidth: 0 } },
          h('div', { style: SETTINGS_TITLE }, L.settingTitle),
          h('div', { style: SETTINGS_DESCRIPTION }, L.settingDescription),
        ),
        h(Switch, { checked: enabled, onChange: setAlwaysShowActions, label: L.settingTitle }),
      )
    }

    /**
     * Containment: a throw inside a slot entry blanks the whole entry, and the
     * console reports `slot entry crashed in '<slot>'`. This boundary degrades to
     * nothing instead, so the surrounding shipped UI keeps working.
     */
    class Guard extends React.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }

      static getDerivedStateFromError() {
        return { failed: true }
      }

      componentDidCatch(error) {
        console.error('[dsh-session-speed-pill] 界面渲染失败，已停用本条目：', error)
      }

      render() {
        if (this.state.failed) return null
        return this.props.children
      }
    }

    /** The boundary receives the slot props and forwards them to the pill. */
    function SessionSpeedPillEntry(props) {
      return h(Guard, null, h(SpeedPill, props))
    }

    /** The same containment for the settings row. */
    function SettingsRowEntry(props) {
      return h(Guard, null, h(AlwaysShowActionsRow, props))
    }

    return {
      // Naming the factory keeps this entry's registrant its own package rather
      // than the slot owner, so Slot inspection and crash reports stay readable.
      name: 'dsh-session-speed-pill',
      inject: ['slots'],
      apply(ctx) {
        // `inject: ['slots']` already gates activation on the slot service; this
        // keeps a host without it from throwing inside apply instead.
        if (!ctx || !ctx.slots || typeof ctx.slots.inject !== 'function') return

        // The stylesheet carries both the placement rules and the preference-driven
        // override; disposal removes it, restoring the shipped layout and hover
        // behaviour exactly.
        const attach = () => {
          syncStyle()
          preferenceListeners.add(syncStyle)
        }
        const detach = () => {
          preferenceListeners.delete(syncStyle)
          dropStyle()
        }
        if (typeof ctx.effect === 'function') {
          ctx.effect(() => {
            attach()
            return detach
          })
        } else {
          attach()
        }

        ctx.slots.inject('conversation.chat.assistant-actions', () =>
          ctx.slots.register(
            {
              name: 'conversation.chat.assistant-actions',
              // A fresh id adds an action beside the shipped ones; reusing a
              // shipped id would replace that cell instead.
              id: 'session-speed-pill',
              // The shipped feedback action sits at 10; this lands before it, and
              // the stylesheet moves it after the usage control.
              order: 5,
            },
            SessionSpeedPillEntry,
          ),
        )

        ctx.slots.inject('settings.general.item', () =>
          ctx.slots.register(
            {
              name: 'settings.general.item',
              id: 'session-speed-pill-actions',
              // After the chat preferences (transcript view 12, performance 30),
              // before the log and version rows at 90/100.
              order: 35,
            },
            SettingsRowEntry,
          ),
        )
      },
    }
  },
})
