# 会话速度胶囊 · dsh-session-speed-pill

给 DeepSeek Harness 的**每一轮对话**（一问一答）加一枚小读数，回答官方用量**回答不了**的问题：**这一轮吐字快不快、时间花在哪。**

```
⚡ 264 tok/s · 12.3秒
```

它落在每轮回复下方那条消息操作行里——就是官方放「复制 · 点赞 · 分享 · 用量 · 时间」的那一行，位置在**用量右侧、时间左侧**；胶囊与它的弹层都照抄官方控件（用量触发器 + 统计弹层）的度量与主题 token，读起来是同一套 UI。

> 官方用量给的是**会话级**的 token 与缓存；这枚胶囊给的是**单轮**的时间构成与速度，并在弹层末尾汇总本轮用量。它不做缓存命中率、上下文占用与费用的推断——那些交给官方用量，免得两个数字互相打架。

---

## 一、胶囊上的两个数字

| 位置 | 显示 | 定义 |
|---|---|---|
| 左 | 本轮解码速度 | `Σ 本轮有效输出 token ÷ Σ 本轮解码耗时`（按 token 加权） |
| 右 | 总耗时 | `turn/end − turn/start`，这一问一答实际花掉的时间（含首字延迟与工具执行） |

时长格式：不足 1 分钟显示 `12.3秒`，不足 1 小时显示 `7分49秒`，**超过 1 小时只显示 `1小时05分`，不再带秒**。

速度低于 100 保留一位小数，否则取整；分母不成立一律 `—`，**永远不会出现 `0 tok/s`、`NaN` 或 `Infinity`**。

## 二、点开以后：本轮指标

弹层沿用官方统计弹层的样式（同一个 `--dsw-specific-menu` 背景、`--dsw-radius-lg` 圆角、`backdrop-filter`、`--dsw-elevation-prominent` 阴影、16px 内边距、`grid minmax(76px,auto)` 两列布局）。

**标题行**：左侧「本轮对话」，右侧「共 12 步」。

| 行 | 值 |
|---|---|
| 回答耗时 | 模型 · 工具 · 总耗时 |
| 首字延迟 | 最大 · 最小 · 平均 |
| 解码输出 | 平均 tok/s · 合计耗时 |
| 预填充输入（估算） | 平均 tok/s · 合计耗时 |
| 本轮解码速度（估算） | p10 ~ p90（tok/s） |
| 本轮预填充速度（估算） | p10 ~ p90（tok/s） |
| 总用量 | 输入 tok · 输出 tok（`≈8.4K` / `≈1.1M` 这种量级） |

> 注：输入 token 均为未缓存输入，估算数值受网络延迟影响很大，仅供参考。

口径：

- **回答耗时**：总 = `turn/end − turn/start`；模型 = Σ `末块 − step 开始`；**工具 = 总 − 模型**（残差，含工具执行与其间的调度、审批、重试）。
- **首字延迟**：每步 `首个输出块 − step 开始` 的 最大 / 最小 / **算术平均**。
- **解码输出**：平均 = `Σ token ÷ Σ 解码耗时`（token 加权，**与胶囊左侧同一个数**）；合计 = Σ `末块 − 首块`。
- **预填充（估算）**：`未缓存输入 ÷ 首字延迟`。分母必然 ≥ 真正的预填充时间，所以这是**下界**。回归拟合（`R²=0.044`）太弱，不采用；用 `block-start` 当分母相关系数只有 `0.008`，是网络抖动，也不用。
- **本轮解码速度**：各步纯解码速度的 **p10 ~ p90**，只看解码窗口 ≥ 100ms 的步。用 min~max 时区间会被单个最好/最坏的一步撑开（实测 114×），换成分位数后是 2.2×。单步时显示单值。
- **本轮预填充速度**：同样取 **p10 ~ p90**。注意它的宽度主要反映**输入规模差异**（`corr(输入, 速度) = 0.884`），不是速度波动，读平均更有意义。
- **总用量**：输入 = Σ 未缓存输入；输出 = Σ 输出 token。用 `K` / `M` 量级显示，约分时加 `≈`。

实现里锁定了两条恒等关系，任何一条不成立都是 bug：

```
平均解码速度 × 解码合计 = 输出 token
模型耗时 + 工具耗时      = 总耗时
```

每一项从原始事件到显示值的完整推导、时间线语义的证据、以及一轮 21 步真实对话的逐项算例，见 **[docs/metrics.md](docs/metrics.md)**。

每一项从原始事件到显示值的完整推导、时间线语义的证据、以及一轮 21 步真实对话的逐项算例，见 **[docs/metrics.md](docs/metrics.md)**。

## 三、设置：始终显示消息操作行

官方行为是：**只有最新一轮**的操作行常驻，更早轮次在新消息出现后会被 `opacity: 0` 隐藏、要悬停才出现；你发出去的消息，一旦有更新的消息，它的「复制 · 时间」同样会隐藏。

设置 → 通用 里多了一行：

> **始终显示消息操作行**（Always show message actions）
> 开启后常驻显示每条消息的操作行（复制、点赞、分享、用量、时间等内容）；默认为关闭，仅常驻显示最新一轮的，其余需要悬停才会显示

**一个开关同时管两处**：助手回复下方的整行，以及你自己发出的消息下方的「复制 · 时间」行。

实现上不改官方组件，只加 CSS：

```css
@media (hover: hover) {
  [data-actions-reveal="hover"] [class*="_actions"],
  [data-chat-flow-kind="user"] [class*="_actions"],
  [data-chat-flow-kind="steering"] [class*="_actions"] { opacity: 1 !important }
}
```

- `data-actions-reveal` 是官方 `TurnTailNodeView` 自己写下的属性（`always` = 最新一轮且有回复，`hover` = 其余）；
- `data-chat-flow-kind` 是消息节点上的官方属性，用户消息那条规则原本用 `:has(~ …)` 隐藏；
- 操作行类名是 CSS Modules 生成的 `_<hash>_actions`，hash 每次构建都变，所以匹配**类名后缀**而非 hash。

开关状态存 `localStorage`（`dsh-session-speed-pill:always-show-actions`）。它是纯客户端显示偏好，而 `settings.general.item` 这个槽位既不给会话座位也不给投影，为存一个布尔值建 Host 通道不划算。**代价**：按浏览器独立。

## 四、位置是怎么摆到用量与时间之间的

官方那一行的结构是：

```jsx
<div class="_<hash>_actions" data-clock="end">
  [复制] [插件槽位 ← 本插件] [分支] <span class="_<hash>_endInfo"> [用量] [时间] </span>
</div>
```

槽位只能落在 `[分支]` 与 `endInfo` 之间，进不到 `endInfo` 内部。所以插件用一条 CSS 把 `endInfo` 变成 `display: contents`——它的两个子元素因此成为整行的 flex 项——再用 `order` 排成「… 复制 / 分支 → 用量(20) → 速度胶囊(21) → 时间(22)」：

```css
[data-clock="end"] > span:last-child { display: contents }
[data-clock="end"] > span:last-child > :first-child { order: 20; margin-left: 8px }
[data-actions-reveal] [class*="_actions"] [data-dsh-ssp] { order: 21 }
[data-clock="end"] > span:last-child > :last-child { order: 22 }
```

最后那条胶囊规则用的是**后代选择器**，不是 `>`。槽位条目的 DOM 父节点是 outlet 锚点 `<div data-slot=… style="display:contents">`：锚点不生成盒子，但**仍然在 DOM 树里**。所以胶囊只是「盒子树上的 flex 项」，`>` 子选择器永远匹配不到它——这一点写错过一次，位置就一直停在槽位原地。

`.actions` 本身有 `gap: 8px`，把 `endInfo` 的 `margin-left: 8px` 移到用量控件上，间距与原来完全一致。规则只作用于 `[data-clock="end"]`（只有轮尾行带这个属性），不影响用户消息行。另有一条 `:has(>[data-dsh-ssp])` 兜底，用于宿主把槽位条目再包一层的情况。

> 注入的样式表标记为 `data-plugin="dsh-session-speed-pill"` 与 `data-plugin-css="dsh-session-speed-pill/styles"`，方便在 DevTools 里定位、或临时删掉验证原行为。
>
> 它还带一个「代际令牌」（`data-plugin-instance`）。热重载时新模块会先于旧模块卸载运行，两代共用同一个 tag id；没有这个令牌，旧模块的 disposer 会把新模块刚写的样式表删掉——位置就会「莫名其妙回到老地方」。现在只有令牌匹配的那一代才会删除它。

## 五、语言

跟随 **设置 → 语言**：官方 locale 服务把当前语言写到 `<html lang>`（`zh` 写成 `zh-CN`），插件在渲染时读它。

| `<html lang>` | 文案 |
|---|---|
| `zh` / `zh-CN` / `zh-Hant` … | 中文（含中文单位：秒 / 分 / 小时） |
| `en` / `en-US` … | English |
| 其他任何语言 | **English**（尚未翻译，按要求回落英文） |

标签兼具通俗与专业：中文带通用英文缩写，例如「预填充速度 (Prefill)」，英文侧为 "Prefill speed"。

## 六、数据从哪来

时间与速度**不靠客户端计时**，全部从会话日志里已提交的事件推导——所以重放、刷新、冷启动读到的数字完全一致。

- `turn/start` / `turn/end` → 轮次边界与墙钟
- `step/start` → 每次模型请求的起点（首字延迟的分母）
- `assistant/message` → `usage.outputTokens` / `usage.inputTokens`，以及
  `stream: AssistantStreamRecord[]`：每条记录带 `time0` 与逐块 `dt`（毫秒），
  首块与末块的绝对时间就是该步精确的解码窗口

因此插件**不需要**订阅 `session/event`、不需要重扫 `session.events`、更不需要在客户端 fold 事件。

```
Host (Node)                                   Client (Web)
────────────────────────────────────────      ──────────────────────────────
ctx.sessionProjections.register('sessionSpeed')
  init()           空状态
  apply(state, ev) 纯函数折叠；忽略的事件返回同一引用
  wire.view()      每轮算好的指标 ───────────▶ useProjection('sessionSpeed')
                                               conversation.chat.assistant-actions
                                               id: session-speed-pill, order: 5
```

视图是一条 `turnStats` 数组，每项由**该轮最后一个 step 的助手消息 id** 作键——正好是动作行收到的 `messageId`，一次查表即可。

## 七、结局与异常

因为面板只看单轮，所以**不对结局做任何加权取舍**：这一轮测到什么就显示什么。中途中断、失败、截断都照实给出已产出的部分。

无论哪种情况都不会出现 `0 tok/s`、`NaN`、`Infinity`；分母不成立时一律 `—`（例如中断时未出首字，速度为 `—`，但本轮耗时照常显示）。

## 八、兼容性、版本与共存

### 8.1 兼容性设计

| 风险 | 处理 |
|---|---|
| 宿主包版本漂移 | 运行时**不 import 任何 `@deepseek-ai/*`**；客户端只用 `react`，`react-dom` 拿不到时自动退化为就地渲染 |
| 官方主题 token 改名 | 颜色只用 `--dsw-alias-*`；圆角与阴影用 `--dsw-radius-*` / `--dsw-elevation-*`。唯一的字面色是开关滑块（须与品牌色轨道对比） |
| 槽位契约变化 | 注册进 **list 槽位**、用**自己的 id**（`replaceRisk: none`），只追加不替换 |
| 拿不到 `useProjection` 座位 | 退化为渲染空，调用顺序保持稳定，不会触发 React 的 hooks 报错 |
| `__ModuleLoader__` 不存在 | 整段客户端代码退化为空操作，不会在启动路径上抛异常 |
| 槽位服务缺失 | `apply` 入口先检查 `ctx.slots`，不存在就直接返回 |
| 某一轮测不出来 | 该轮渲染为 `null`；有统计但无速度时显示 `—` |
| 任一界面抛错（胶囊或设置行） | 各自的外层错误边界兜住，只让该条目消失，控制台给出 `[dsh-session-speed-pill]` 前缀日志 |
| **折叠函数抛错** | `apply` 外层 try/catch，失败即「跳过该事件、保留上一状态」并只提示一次 |
| 热重载覆盖样式表 | 样式表带代际令牌，只由创建它的那一代删除 |

最后一条不是形式主义。投影的 `apply` 运行在**每一次 `session/event` 派发**里，它抛异常不会只是「少显示一个数」——它会中断触发该事件的那一轮对话。这个插件的前一版就是这样把会话打成 `turn/end: { kind: 'error', error: { message: '<fn> is not defined' } }` 的。所以 `fold` 写成不会抛，外层 `apply` 再包一层 try/catch 作为不可破的兜底。

### 8.2 兼容的 DSH 版本

开发与验证环境是 **DeepSeek Harness `0.2.1-rc.5`**（`dsh-session-projection`、`dsh-client-ui-chat`、`dsh-client-ui-settings-general` 同为 `0.2.1-rc.5`）。

| 侧 | 依赖的公开契约 |
|---|---|
| Host | `ctx.sessionProjections.register({ key, stateVersion, stateSchema, init, apply, wire: { viewSchema, view } })`；读取 `assistant/message` 的 `usage` 与 `stream` |
| Client | `ctx.slots.inject` / `ctx.slots.register`；槽位 `conversation.chat.assistant-actions`（owner prop `messageId`）与 `settings.general.item`；座位属性 `useProjection` |
| DOM | 官方写下的 `data-actions-reveal`、`data-clock`、`data-chat-flow-kind` 属性，以及 CSS Modules 的 `_actions` 类名后缀 |
| 语言 | `<html lang>` |
| 主题 | `--dsw-alias-*`、`--dsw-radius-*`、`--dsw-elevation-*`、`--dsw-specific-menu`、`--dsw-menu-backdrop-filter`、`--dsw-alias-interactive-bg-hover` |

- **0.2.x**：预期整系可用（上表都是 0.2 的稳定面）。
- **0.3.x 及以后**：契约不变则应继续可用，但未验证；`data-actions-reveal` / `data-clock` / `data-chat-flow-kind` 一旦改名，对应效果会静默失效（退回默认位置与悬停行为，不报错）。
- **0.1.x**：**未验证，不保证**。

### 8.3 与其他插件的共存

**设计上不冲突的部分：** 不注册任何 Host 服务、工具、命令、事件或 Web 路由；不订阅 `session/event`、不追加事件类型；两个槽位都用自己的 id 只追加；全局只有一条 CSS 且作用域锁在官方属性上；`localStorage` 键带包名前缀。

**窄面的、如实的冲突可能：**

| # | 情形 | 后果 |
|---|---|---|
| 1 | 别的插件也注册投影键 `sessionSpeed` | `stateVersion` 相同则共享同一单元（后注册者的 `apply` 不生效）；不同则第二个注册直接抛错，后装的那个无法激活 |
| 2 | 别的插件在同一槽位用 id `session-speed-pill` / `session-speed-pill-actions` | list 槽位按 id 归并，后注册者会替换先前的 |
| 3 | 别的插件往动作行塞带 CSS Modules 类名（`*_actions`）的元素 | 会一并被「始终显示」的 `!important` 强制可见 |
| 4 | 同一插件被装两次 | 两次注册同样的 id，最终只保留一个 |

本机（同一 profile）已装插件的实测交集：

- **`dsh-live-token-stats`**：注册在 `conversation.composer.dock`（输入框下方），投影键 `liveTokenStats`，组件只用内联样式、没有 `className`。与本插件无键名、无槽位、无样式交集。
- **`dshmarket`**：插件市场与应用内安装器，读写 profile 的 bundle 列表与自己的 `.dsh-market/state.json`，不碰上述槽位与投影键。
- **`dsh-armory`**：面板类插件，不碰上述槽位与投影键。

### 8.4 遵循的插件规则

- 运行时不 `import` 任何 `@deepseek-ai/*`；客户端只 `require('react')`，`react-dom` 可选。
- 不新造 session 事件类型，不订阅 `session/event`，不重扫 `session.events`。
- 不替换应用根，不往 `document.body` 挂第二个应用。
- 颜色只用主题 token；唯一的字面色是开关滑块。
- 所有资源（样式表、偏好监听、面板的滚动/尺寸监听）都挂在 `ctx.effect` 或组件生命周期上，卸载即清理。

**一处刻意的偏离**：全局样式表通过 `document.head` 注入，而不是渲染成 React 元素。原因是它必须在任何动作行渲染之前、且即使你从不打开设置页也生效；官方 `ui-chat` / `ui-settings-general` 注入 CSS Modules 用的正是同一套 `document.head.appendChild(style[data-plugin-css=…])`。安全性由三点保证：按 `data-plugin-css` 去重、代际令牌防止误删、内容清空即等于无规则。

## 九、性能（实测）

合成会话压测（每轮 10 步、每步 250 token）：

| 会话规模 | 折叠总耗时 | 单次 `view()` | 线上视图体积 | 投影状态体积 |
|---|---|---|---|---|
| 10 轮 × 5 步 | 1.0 ms | 0.17 ms | 2.2 KiB | 6.3 KiB |
| 50 轮 × 10 步 | 3.4 ms | 0.25 ms | 11.2 KiB | 58.9 KiB |
| 200 轮 × 10 步 | 4.7 ms | 0.49 ms | 44.8 KiB | 236.8 KiB |

- **每个事件的边际成本约 1.14 微秒**；会话每秒最多个位数事件，可忽略。
- `view()` 只在状态真的变化时由框架调用。
- 线上视图随**轮数**线性增长（只发每轮汇总，不发每步明细）；真实会话 26 轮为 6.6 KiB。

## 十、调试

默认完全静默。需要时在启动 Harness 前设置：

```bash
DSH_SESSION_SPEED_PILL_DEBUG=1
```

每次投影推送会打一行摘要。投影折叠失败时无论如何都会打一条 `console.warn`（每进程一次），前缀固定为 `[dsh-session-speed-pill]`。

## 十一、安装与卸载

先把仓库取到本地（位置随意）：

```bash
git clone https://github.com/wzsx150/dsh-session-speed-pill.git
```

再用 `plugin_manager` 以本地目录方式安装（profile 里会生成指向该目录的链接，改代码后无需重装）：

```js
plugin_manager({ action: 'install_bundle', target: '<仓库绝对路径>' })
```

卸载：`plugin_manager({ action: 'remove_bundle', target: 'dsh-session-speed-pill' })`。卸载后投影键消失、胶囊消失，无残留节点。

**改动生效范围**：`index.js` / `lib/*` 是 Host 半身，改动需要重启 Harness；`client.js` 是浏览器半身，刷新页面即可。

## 十二、已知限制

1. **只测日志里记下来的东西。** 如果某个 provider 没有回写 `dt` 时间线，该轮仍有胶囊与耗时，但速度类指标为 `—`。
2. **数值在本轮提交后才落定。** 动作行只在本轮收尾后渲染，所以胶囊不会随 token 跳动；这与官方所有投影的行为一致。
3. **分叉会话计入继承前缀。** fork 继承父会话的事件，那些轮次同样被折叠。
4. **schema 是本地实现，不是 Zod。** `register()` 声明的是 Zod schema，但运行时只调用 `.parse()`。本插件以目录链接方式安装，`import 'zod'` 会从链接的真实路径解析而找不到 `node_modules`，因此 [`lib/schema.js`](lib/schema.js) 提供了只暴露 `parse` / `safeParse` 的最小契约对象。
5. **文案跟随 `<html lang>`**，在渲染时读取；不重载页面切换语言，下一帧即生效。插件管理器里的标题与描述由 [`locale/zh.json`](locale/zh.json) 与 [`locale/en.json`](locale/en.json) 提供（仅中英）。
6. **客户端半身不会热替换。** 改了 `client.js` 需要刷新页面才会加载新一代模块。
7. **设置开关按浏览器存储，且标签页之间不实时同步。** 换设备或清理站点数据会回到默认关闭。
8. **位置与「始终显示」都依赖官方的 DOM 属性。** 若未来版本改掉 `data-actions-reveal` / `data-clock` / `data-chat-flow-kind`，对应效果会**静默失效**（退回默认位置与悬停行为，不报错）。

## 十三、文件结构

| 文件 | 作用 |
|---|---|
| [`index.js`](index.js) | Host 入口：`inject: ['sessionProjections']`，注册投影 |
| [`lib/projection.js`](lib/projection.js) | 折叠逻辑、按轮派生指标、字段语义 |
| [`lib/metrics.js`](lib/metrics.js) | 加权平均、最近秩分位数、极值等纯函数（全部 `null` 安全） |
| [`lib/schema.js`](lib/schema.js) | 投影契约需要的 `parse` / `safeParse` 最小实现 |
| [`lib/debug.js`](lib/debug.js) | 可选诊断日志开关 |
| [`client.js`](client.js) | 浏览器入口：动作行胶囊 + 统计弹层 + 设置项 + 语言与样式表 |
| [`cordis.patch.yml`](cordis.patch.yml) | 挂载 patch 行 |
| [`locale/zh.json`](locale/zh.json) · [`locale/en.json`](locale/en.json) | 插件管理器中的标题与描述 |
| [`icon.svg`](icon.svg) | 插件图标（矢量，原创） |
| [`assets/icon-180.png`](assets/icon-180.png) | 市场卡片图（180×180 位图，与 icon.svg 同一图形；市场只收 GitHub 托管的位图） |
| [`docs/metrics.md`](docs/metrics.md) | 每个数字从原始事件到显示值的完整推导与真实算例 |

## 十四、许可

[MIT](LICENSE)
