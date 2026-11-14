# CLI ⇄ Work 双视图改造验收与独立盲审记录（2026-11-14）

定型：老项目改造 · 改流程与加新功能 · 阶段：实现与验证完成

## 1. 范围与目标

将原有的只读「`<Agent> ⇄ 记录`」面板升级为可全程闭环操作的 **`CLI ⇄ Work` 双视图切换**，不改 `claude` / `claude-r` / `codex` / `agy` 底层进程启动契约，同时覆盖单屏与分屏（最窄 350px 格）。

- **跨 Agent 统一轮次归约（`@shared/transcript` + `parse-worker`）**：基于本机 Claude JSONL、Codex rollout JSONL、Antigravity SQLite/protobuf 与 `@xterm/headless` 终端屏幕快照采样，建立 `projectWorkTurns` 纯函数归约层，统一提取每轮人类指令（含排队追加指令 `queuedPrompts`）、单行实时执行脊（`Turn Execution Spine`）、报错冒泡步骤（`errorSteps`）、文件改动胶囊（`files` + `+M -N` Diff）、最终交付正文及 `waiting` 结构化单选/多选/权限阻塞态。
- **零切回 CLI 交互闭环**：在 `Work` 视图内提供带防重放令牌校验（`workDispatch`）的 `WorkWaitingCard` 决策卡与 `WorkComposer` 原生输入框，支持括号粘贴与 `\r` 拆帧防吞键、运行中排队发话、剪贴板粘贴图片落盘、拖入文件路径、一键中断（`\x03`）及 `ended` 会话自动调起 `gateResume` 原地续接。
- **保活切换与身份锚点**：切换 `CLI ⇄ Work`（快捷键 `Alt+W`）时，`TerminalView` 在 `terminalStore` 中保持挂载存活不丢回滚与光标，`Work` 视图按会话持久化草稿、展开态与滚动位置；决策卡与输入区固定锚定「产品 2px 小方块 + 关联看板待办 + 分支/目录 + 账号标号」。

## 2. 外部客观门禁结果

| 门禁                          | 结果       | 证据摘要                                                                                                                                                                                                         |
| ----------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Vitest 语料与协议测试      | 通过       | `tests/shared/work-view.test.ts`、`tests/terminal/work-dispatch.test.ts`、`tests/renderer/split-view.test.ts` 及全量测试套件通过；52 步工具轮次默认纵向节点压缩率 > 80%，报错工具 100% 冒泡。                    |
| 2. 真机 `node-pty` 闭环验证   | 通过       | 离屏 Electron 真机全程停留在 `Work` 视图完成多行发话、单选 + 多选连续提交、过期令牌防重放拦截、Bash 权限审批与 `ended` 自动续接，切回 `CLI` 核验 `xterm` 屏幕一致无乱码（`cli-after-work-roundtrip-1440.png`）。 |
| 3. 静态与几何门禁             | 通过       | `pnpm typecheck` 0 报错，`pnpm lint` 0 新增报错，`node scripts/ui-audit.mjs --files ...` 0 违规令牌；13 张离屏实机图实测 `maxDocOverflowPx: 0`、`anyElementOverflow: false`。                                    |
| 4. `ui-blind-critic` 独立盲审 | 通过可交付 | 首轮检出 4 项细节问题并全部修净，二轮复审 13 张实机图判定 0 阻断项、0 退化项。                                                                                                                                   |

## 3. 独立盲审闭环记录（Round 1 → Round 2）

### 首轮盲审发现与修复

1. **分屏 340–350px 窄格标题栏切换器挤压会话标题**：将分屏格标题栏 `CLI / Work` 切换器在窄容器下紧缩内边距与字号，保留会话标题充裕可读宽度（复核图：`work-split-narrow-350.png`、`work-split-1084.png`）。
2. **`Work` 正文行高与中文字体行距**：将人类指令与交付 Markdown 正文行高统一调至 `leading-[1.75]`，代码块与执行脊维持紧凑等宽行高（复核图：`work-overview-1440.png`、`work-spine-expanded-1440.png`）。
3. **身份锚点分隔符与反引号代码胶囊**：全面移除 `Work` 视图内元数据中点 `·` 分隔符，改用 `gap-2` / `gap-2.5` 留白分组；在 `WorkWaitingCard` 决策题干、选项说明与命令预览中接入无描边 `ink-900` 反引号等宽短片（复核图：`work-waiting-question-1440.png`、`work-waiting-permission-1440.png`）。
4. **多选复选框、多步骤与附件草稿状态补证**：新增多选勾选 + 多步骤切换 + 图片附件草稿离屏实机图 `work-waiting-multiselect-attach-1440.png` 与 350px 窄格图 `work-split-narrow-350.png`，同步修复连点勾选与连续贴图时的闭包覆盖边界及多题题头重复展示。

### 二轮复审结论

`ui-blind-critic` 对全部 13 张刷新后的实机截图复核后给出 **`定级：通过可交付`**（阻断项 0、退化检查全部保持干净、静态证据缺口 0）。

## 4. 实机截图清单（`docs/ui-review/2026-11-14-work-view/`）

- `work-overview-1440.png`：1440×900 单屏 `Work` 多轮完成态（执行脊收敛、报错冒泡胶囊、文件 Diff 胶囊、底部身份锚点输入框）
- `work-spine-expanded-1440.png`：1440×900 执行脊按需展开步骤明细与子代理行
- `work-diff-modal-1440.png`：1440×900 点击文件改动胶囊打开 `ink-900` Diff 对照弹层
- `work-live-working-1440.png`：1440×900 运行中实时脉冲执行脊与底部排队输入态
- `work-waiting-question-1440.png`：1440×900 结构化单选待拍板卡（全页唯一琥珀色落点）
- `work-waiting-multiselect-attach-1440.png`：1440×900 多步多选勾选态 + 底部图片附件草稿胶囊
- `work-waiting-permission-1440.png`：1440×900 终端权限确认卡（命令预览 + 批准/拒绝按钮）
- `work-codex-1440.png`：1440×900 Codex 会话跨 Agent 统一 `Work` 归约展示
- `work-compact-1084.png`：1084×760 紧凑单屏窗口布局
- `work-split-1440.png`：1440×900 分屏混合 `Work` + `CLI` 并行工作台
- `work-split-1084.png`：1084×760 紧凑窗口分屏布局
- `work-split-narrow-350.png`：350px 窄分屏格（标题栏不挤占会话名、排队/中断/发送不折行溢出）
- `cli-after-work-roundtrip-1440.png`：真机 `Work` 全闭环操作后切回 `CLI` 的 `xterm` 屏幕一致性核验
