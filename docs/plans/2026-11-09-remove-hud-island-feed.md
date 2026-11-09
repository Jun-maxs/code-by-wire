# Jun-Code：拆掉 HUD + 给均哥Ultra 顶部岛的本机接口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jun-Code 不再显示顶部 HUD 悬浮条及其设置/统计小窗；主进程改为在 127.0.0.1 上提供一个只读快照 + 打开会话的小接口，供均哥Ultra 的顶部岛使用。

**Architecture:** 纯函数 `buildIslandSnapshot`（shared）把 overview 会话、账号额度、主题和手机遥控状态压成岛要的小快照；`startIslandFeed`（main）用 Node `http` 起服务、写发现文件、校验令牌和 Host；`index.ts` 删掉 HUD 接线、接上接口。HUD 的代码、vendor、协议、设置卡整块删除，「开机启动」挪到主设置。

**Tech Stack:** Electron 41、TypeScript、Node `http`、vitest。

**Spec:** `E:\0项目\07.桌面整理-island\docs\superpowers\specs\2026-11-09-top-island-design.md`（第 5、6 节；第 6 节的 JSON 是接口契约）

## Global Constraints

- 工作树 `E:\0项目\开发临时用\cbw-wt-island`，分支 `feat/island-feed`（基于 `feat/session-accounts` 1b57c7c2）。`node_modules` 是指向 `cbw-wt-jun\node_modules` 的联接，**别删它里面的东西**；收尾删联接用 `cmd /c rmdir node_modules`。
- 命令：类型检查 `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json` 和 `-p tsconfig.web.json`；测试 `node node_modules/vitest/vitest.mjs run <文件>`；lint `node node_modules/eslint/bin/eslint.js <文件>`。跑测试前 `Remove-Item Env:CBW_CLAUDE_LAUNCHER -ErrorAction SilentlyContinue`。用户可能在玩游戏：不跑全量测试，只跑相关文件。
- `git config core.autocrlf false` 已设；AGENTS.md 是符号链接，提交前若被 prettier 改动就 `git checkout -- AGENTS.md`。
- 接口只绑 `127.0.0.1`；发现文件 `<userData>/island-feed.json` = `{"version":1,"port":<n>,"token":"<64 hex>","pid":<n>}`；请求头 `Authorization: Bearer <token>`；`Host` 必须等于 `127.0.0.1:<port>`。
- 快照 `version: 1`；会话最多 30 条，只给「未结束」或最近 24 小时有活动的；顺序 = `orderedSessions(sessions, "")`（侧栏同款）。
- 注释和代码风格跟现有文件（英文注释、`Fork (2026-11-09):` 前缀标出 fork 新增）。

## Review Focus

1. 均哥Ultra 每 1–2 秒轮询一次：读快照不能触发全量同步、不能阻塞主进程（超过 10 秒才异步 sync，沿用旧 HUD 做法）——Task 3 的接线测试/手测要看主进程不卡。
2. 别的本机网页（浏览器里的恶意页面）打这个端口：没令牌 401、`Host` 不对 403，`POST` 只认 JSON 小正文（>4 KB 413）——Task 2 的测试逐条钉住。
3. Jun-Code 崩溃后留下旧发现文件：岛靠 pid 判断；Jun-Code 下次启动必须覆盖写新文件（新端口、新令牌）——Task 2 测试「启动覆盖旧文件」。
4. 账号没有 reclaude 绑定（`accountSwitcher` 为空）时，快照退回单账号 `overview().account`，不是空列表——Task 1 测试钉住。
5. 删 HUD 后旧 `settings.json` 里的 `hud` / `hudPanel` 字段不能让设置读取报错——Task 3 的 app-settings 测试钉住。

---

### Task 1: 快照构建（纯函数）

**Files:**
- Create: `src/shared/island-feed.ts`
- Test: `tests/shared/island-feed.test.ts`

**Interfaces:**
- Consumes: `Session`、`Account`、`RateLimit`（`@shared/types`）；`AccountsOverview`、`windowPct`、`accountColor`（`@shared/account-switch`）；`ProductsData`、`productForSession`、`shortTopicName`（`@shared/products`）；`orderedSessions`（`@shared/overview`）。
- Produces:

```ts
export type IslandState = "working" | "waiting" | "idle" | "ended";
export interface IslandWindow { usedPct: number; resetsAt: number }
export interface IslandSession {
  id: string; agent: AgentId; state: IslandState;
  title: string;            // "主题短名 · 标题"，没有主题时就是标题
  project: string;          // repoLabel ?? project
  topicColor: string | null;
  lastActivity: number;     // lastActivityMs
  account: string | null;   // "#n"，按 accountDevice 找账号号码；找不到 null
  remote: boolean;
}
export interface IslandAccount {
  device: string; label: string /* "#n" */; color: string /* accountColor(n) */;
  email: string; current: boolean;
  fiveHour: IslandWindow | null; sevenDay: IslandWindow | null;
}
export interface IslandSnapshot {
  version: 1; now: number;
  sessions: IslandSession[];
  accounts: { smartSwitch: boolean; items: IslandAccount[] };
  remote: { online: boolean };
}
export interface IslandSnapshotInput {
  sessions: Session[];
  accounts: AccountsOverview | null;
  account: Account | null;        // 单账号退路（overview().account）
  products: ProductsData | null;
  remoteOnline: boolean;
  now: number;
}
export function buildIslandSnapshot(input: IslandSnapshotInput): IslandSnapshot;
```

- [ ] **Step 1: 写失败的测试** `tests/shared/island-feed.test.ts`，用现有测试里的会话工厂（`tests/helpers` 里有就用，没有就在文件内写一个最小 `session(over: Partial<Session>)`）：
  - `keeps live sessions and recent ended ones, at most 30`：35 个 working 会话 → 30 条；一个 ended 且 `lastActivityMs = now - 25h` 的被丢掉，`now - 23h` 的保留。
  - `orders like the sidebar`：waiting / working / idle / ended 各一条打乱输入 → 输出 state 顺序为 `["waiting","working","idle","ended"]`。
  - `titles carry the short topic name`：`products.bySession[id] = "jun-code"`、`products.products["jun-code"].name = "Jun-Code（多账号）"` → `title === \`${shortTopicName("Jun-Code（多账号）")} · 修切号\``，`topicColor === products.products["jun-code"].color`；无主题时 `title === "修切号"`、`topicColor === null`。
  - `numbers accounts and maps windows`：两个 `AccountQuota`（n=1 current、n=2）→ `items[0].label === "#1"`、`color === accountColor(1)`、`fiveHour.usedPct === windowPct(...)`、`resetsAt === fiveHour.resetsAt`；`seenAt` 缺失或窗口缺失 → `null`。会话 `accountDevice` 为第二个号的 deviceId → `account === "#2"`。
  - `falls back to the single account`：`accounts = null`、`account.fiveHour = {usedPct: 40, resetsAt}` → `items.length === 1`、`label === "#1"`、`current === true`、`smartSwitch === false`。
  - `remote flag passes through`：`remoteOnline = true` → `remote.online === true`。

- [ ] **Step 2: 跑测试确认失败**

Run: `node node_modules/vitest/vitest.mjs run tests/shared/island-feed.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `buildIslandSnapshot`**。主题用 `productForSession(s, products)`（侧栏同一判断；读它的签名对上参数）；`windowPct` 在窗口已重置时给 0、未知给 null——未知时整个窗口给 `null`。

- [ ] **Step 4: 跑测试确认通过**（同上命令，Expected: PASS）

- [ ] **Step 5: 提交**

```bash
git add src/shared/island-feed.ts tests/shared/island-feed.test.ts
git commit -m "feat(island): build the snapshot DeskTidy's top island reads"
```

---

### Task 2: 本机接口服务

**Files:**
- Create: `src/main/island-feed.ts`
- Test: `tests/main/island-feed.test.ts`

**Interfaces:**
- Consumes: `IslandSnapshot`（Task 1）。
- Produces:

```ts
export interface IslandFeedDeps {
  dir: string;                         // userData；发现文件写在这里
  snapshot: () => IslandSnapshot;
  open: (sessionId: string) => void;   // 主进程的 showMain(id)
  log?: (message: string, err?: unknown) => void;
}
export interface IslandFeed { port: number; stop(): Promise<void> }
export function startIslandFeed(deps: IslandFeedDeps): Promise<IslandFeed>;
export const ISLAND_FEED_FILE = "island-feed.json";
```

- [ ] **Step 1: 写失败的测试**（临时目录 `mkdtempSync`，真 `http` 请求打 127.0.0.1）：
  - `writes the discovery file`：启动后 `island-feed.json` 存在，`version===1`、`port===feed.port`、`token` 匹配 `/^[0-9a-f]{64}$/`、`pid===process.pid`。
  - `replaces a stale file`：先写一个旧文件 `{port:1,token:"x",pid:1,version:1}` → 启动后内容是新的 port/token。
  - `removes the file on stop`：`await feed.stop()` 后文件不存在。
  - `rejects a missing or wrong token with 401`。
  - `rejects a foreign Host with 403`：带正确令牌但 `Host: evil.test:<port>`。
  - `serves the snapshot`：`GET /v1/snapshot` → 200、`content-type` 含 `application/json`、正文等于 `deps.snapshot()`。
  - `opens a session`：`POST /v1/open` 正文 `{"sessionId":"abc"}` → 204，`open` 被调用一次，参数 `"abc"`。
  - `rejects bad open bodies`：非 JSON → 400；`sessionId` 不是字符串 → 400；正文 5000 字节 → 413（不调用 `open`）。
  - `404 for anything else`：`GET /v1/nope`。

- [ ] **Step 2: 跑测试确认失败**

Run: `node node_modules/vitest/vitest.mjs run tests/main/island-feed.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**。`http.createServer`，`listen(0, "127.0.0.1")`；令牌 `randomBytes(32).toString("hex")`；令牌比较用 `timingSafeEqual`；发现文件先写 `island-feed.json.tmp` 再 `renameSync`；`snapshot()` 抛错时回 500 并 `log`。`stop()` 关服务、删文件（文件里的 token 是自己的才删，免得删掉后起实例的）。

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: 提交**

```bash
git add src/main/island-feed.ts tests/main/island-feed.test.ts
git commit -m "feat(island): serve the snapshot and open-session on loopback for DeskTidy"
```

---

### Task 3: 接上接口、删掉 HUD、开机启动挪到主设置

**Files:**
- Move: `src/main/hud/remote-status.ts` → `src/main/remote-status.ts`（内容不变）
- Delete: `src/main/hud/`（其余全部）、`src/renderer/hud/`、`src/renderer/hud.html`、`src/shared/hud-protocol/`、`src/shared/hud-native.ts`、`tsconfig.hud.json`、`src/renderer/src/settings/HudCard.tsx`、`tests/main/hud-fullscreen-watch.test.ts`、`tests/main/hud-placement.test.ts`、`tests/main/hud-queries.test.ts`、`tests/main/hud-snapshot.test.ts`
- Modify: `src/main/index.ts`（删 HUD 块 ~893–1100 与相关 import；接 `startIslandFeed`）、`src/main/app-settings.ts`（删 `hud`、`hudPanel`、`hudSettings`、`setHud`、`setHudPanel`、`HudPanelSettings`）、`src/shared/ipc.ts`（删 `hudSettingsGet/Set`、`HudSettings`、`HudDisplayOption`、`HudSettingsView` 及 api 方法；加 `loginItemGet`/`loginItemSet` 与 `getLoginItem(): Promise<LoginItem>`、`setLoginItem(enabled: boolean): Promise<LoginItem>`，`interface LoginItem { supported: boolean; enabled: boolean }`）、`src/preload/index.ts`（删 HUD 方法和 `hudBridge`；加两个登录项方法）、`electron.vite.config.ts`（删 hud 别名、`hud` 入口）、`package.json`（typecheck 去掉第三段）、`src/renderer/src/settings/SettingsView.tsx`（`<HudCard />` → `<LaunchAtLoginCard />`）、i18n 文件（删 `settings.hud.*`，加 `settings.launchAtLogin.{title,enabled,enabledDesc}`：中文「开机启动」「登录 Windows 后自动打开 Jun-Code」，英文 "Launch at login" / "Open Jun-Code when you sign in to Windows"）、`tests/app-settings.test.ts`（删 HUD 用例，加一条）
- Create: `src/renderer/src/settings/LaunchAtLoginCard.tsx`

**Interfaces:**
- Consumes: `buildIslandSnapshot`（Task 1）、`startIslandFeed`（Task 2）、`remoteStatus()`、`readProducts(dirs.cardsDir, dirs.stateDir)`、`accountSwitcher?.view()`、现有 `overview()` 与 `showMain(sessionId)`。

- [ ] **Step 1: 写失败的测试**：`tests/app-settings.test.ts` 加 `ignores leftover HUD fields`——把 `{"hud":{"enabled":false},"hudPanel":{"language":"en"},"appLocale":"zh"}` 写进设置文件，`createAppSettingsStore(...).read().appLocale === "zh"` 且不抛错；同时删掉文件里引用 `hudSettings`/`setHud` 的旧用例。

- [ ] **Step 2: 删除与搬移**（上面 Files 列表），`git mv` 搬 remote-status。然后跑类型检查，按报错把 HUD 的残余引用清干净：

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json; node node_modules/typescript/bin/tsc --noEmit -p tsconfig.web.json`
Expected: 只剩与 HUD 无关的词（如有，逐条确认）

- [ ] **Step 6: 开发版冒烟**（不弹窗口）：`node node_modules/electron-vite/bin/electron-vite.js build`，用 `run_in_background` 起 `CBW_OFFSCREEN=1 CBW_USER_DATA_DIR=E:\build\cbw-dev-userdata node_modules/electron/dist/electron.exe .`（主窗口开在屏幕外、不进任务栏）。读 `E:\build\cbw-dev-userdata\island-feed.json`，`curl --noproxy '*' -H "Authorization: Bearer <token>" http://127.0.0.1:<port>/v1/snapshot` 拿到 JSON 且 `sessions` 有内容；不带令牌 401。结束只按 PID 停（`Stop-Process -Id`），不要按名字杀（会关掉用户的 Jun-Code）。

- [ ] **Step 7: 提交**

```bash
git add -A
git checkout -- AGENTS.md 2>/dev/null || true
git commit -m "feat(island): drop the HUD overlay; DeskTidy's top island takes over, launch-at-login moves to Settings"
```

---

### Task 4: 发版（等均哥Ultra 的岛装上以后）

- [ ] **Step 1:** 确认均哥Ultra 0.9.0 已经装到本机（`%LOCALAPPDATA%\Programs\DeskTidy\DeskTidy.exe` 文件版本 ≥ 0.9.0，或日志里有 `Island started`）。没装上就停在这里，等它装上。
- [ ] **Step 2:** `package.json` 版本 0.1.60 → 0.1.61，提交 `chore: 0.1.61`。
- [ ] **Step 3:** `npx -y pnpm@11.5.3 exec electron-builder --win --publish never`（在主工作树或已装依赖的工作树里打；联接的 node_modules 能用就用，不能用改到 `cbw-wt-jun` 合并后打）。
- [ ] **Step 4:** `bash scripts/publish-update.sh "顶部悬浮条搬到均哥Ultra 的顶部岛" "开机启动开关挪到设置 → 外观"`（SSH 被重置时加 `JUN_SSH_OPTS="-o ProxyJump=myhk"`）。
- [ ] **Step 5:** 推送分支 `git push -u origin feat/island-feed`。
