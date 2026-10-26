# 合并 Agent HUD 到 Code-by-wire（Jun-maxs 分支）

目标：一个应用。Code-by-wire 为主体（会话、终端、对话记录、遥测、统计），
把 Agent HUD 精简版里用户在用的部分搬进来，HUD 的悬浮条和光晕保持现样。
搬完后 Agent HUD（Tauri + Rust 引擎）退役。

HUD 精简版源码：`E:\0项目\开发临时用\agent-hud\src`（只读参考，不再往里加功能）。

## 阶段 0：把本地补丁并入源码

`code-by-wire-patch/patch.mjs` 的 5 处改成源码修改，每处带测试（能测的）：

1. 终端开了鼠标跟踪时右键不再重复粘贴。
2. 剪贴板只有图片时发 Alt+V（Windows）；复制的文件按路径粘贴。
3. 拖入文件走括号粘贴。
4. pty 用 System32 绝对路径的 cmd.exe；启动时把注册表 Machine/User PATH 补回进程。
5. 拉起控制台程序统一 `windowsHide: true`。

## 阶段 1：数据层补齐

1. Claude 配置目录：未设 `CLAUDE_CONFIG_DIR` 时按 `~/.rec/claude/current` 取 reclaude 当前账号目录。
2. 中转额度：Codex `config.toml` / Pi `models.json` 指向 new-api 中转时，读
   `/api/usage/token/` 与公开 `/api/status`，按站点币种换算（不限额 key 只给已用金额）。
   参考 HUD `crates/agents/src/relay.rs`。
3. Pi：`AGENT_IDS` 加 `pi`，先只做会话列表 + 对话记录（读 `~/.pi/agent/sessions`），
   能力位按实际实现逐个打开。参考 HUD `crates/agents/src/pi/`。

## 阶段 2：HUD 悬浮窗

1. 把 HUD 的 `packages/hud`、`packages/ui`、`packages/protocol` 中用到的部分搬到
   `src/renderer/hud/`，作为第二个渲染入口（`hud.html`）。
2. 主进程新增 `src/main/hud/`：透明、置顶、跨工作区的 BrowserWindow，贴屏幕上沿；
   非悬停时鼠标穿透（`setIgnoreMouseEvents(true, { forward: true })`），悬停展开面板。
   参考 HUD `crates/host/src/hud/windows.rs` 的定位与命中规则。
3. 主进程把自己的数据（会话、额度窗口、token 时间线、中转金额）组装成 HUD 协议的
   `Snapshot` 形状，经 IPC 推给 HUD 窗口，HUD 组件原样复用。
4. HUD 面板里点会话 → 打开主窗口并定位到该会话。

## 阶段 3：收尾

设置页加"悬浮条"开关与显示器选择；打 Windows 安装包；卸载 Agent HUD 两个版本。

## 约定

- 遵循仓库 CLAUDE.md：pnpm、`pnpm typecheck`/`test`/`lint`/`format`，Conventional Commits，
  Windows 与 Linux 都要能过 CI。
- 每个阶段一个分支、一个 PR 到 `Jun-maxs/code-by-wire` 的 main；合并由用户决定。
