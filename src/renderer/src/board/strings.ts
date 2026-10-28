import type { Locale } from "@shared/locale";
import type { RiskLevel, TaskRisk, TaskStatus } from "@shared/board";

/** The board's copy. Kept beside the board (fork feature) instead of in the app catalog, so upstream
 *  catalog changes never conflict with it; same shape for both locales. */
const zh = {
  title: "看板",
  tabs: {
    overview: "总览",
    kanban: "看板",
    schedule: "排期",
    ideas: "灵感",
    habits: "日常",
  },
  status: {
    todo: "待办",
    doing: "进行中",
    decide: "等我决定",
    done: "已完成",
  } satisfies Record<TaskStatus, string>,
  risk: {
    overdue: "已超期",
    tight: "时间偏紧",
    stale: "3 天没动",
  } satisfies Record<TaskRisk, string>,
  level: { high: "高", mid: "中", low: "低" } satisfies Record<
    RiskLevel,
    string
  >,
  search: "搜索任务、标签…",
  newTask: "新建任务",
  insight: "AI 洞察",
  importTopics: "从主题导入",
  filterAll: "全部",
  filterRisk: "有风险",
  addTo: (col: string) => `添加任务到「${col}」`,
  addPlaceholder: "任务名，回车添加",
  totalLine: (n: number, h: string) => `共 ${n} 项 · 剩余 ${h}`,
  dragHint: "拖动卡片换状态",
  left: (h: string) => `剩 ${h}`,
  est: (h: string) => `预估 ${h}`,
  due: (d: string) => `${d} 截止`,
  overdueBy: (n: number) => `超期 ${n} 天`,
  dueIn: (n: number) => (n === 0 ? "今天截止" : `剩 ${n} 天`),
  doneOn: (d: string) => `完成于 ${d}`,
  weekDone: (n: number) => `本周完成 ${n}`,
  colLeft: (h: string) => `剩余 ${h}`,
  running: "运行中",
  waitingYou: "等你回复",
  sessions: (n: number) => `${n} 个会话`,
  emptyBoard: "看板还是空的",
  emptyBoardHint:
    "把手上的事记成任务，再把 agent 会话挂上去，就能在这里看到每件事做到哪。",
  // overview
  greet: (h: number): string =>
    h < 5
      ? "夜深了"
      : h < 11
        ? "早上好"
        : h < 13
          ? "中午好"
          : h < 18
            ? "下午好"
            : "晚上好",
  todayHead: (n: number) => (n ? `今天有 ${n} 项重点任务` : "今天暂无排期"),
  todayLede: (planned: string, cap: string, next: string | null) =>
    `已排入 ${planned} / ${cap} 工作量` + (next ? ` · 最近截止 ${next}` : ""),
  weekend: "今天是休息日，排期从下个工作日继续。",
  capacity: (h: string) => `每日容量 ${h}`,
  tileActive: "在办任务",
  tileProgress: "整体进度",
  tileProgressSub: (d: number, n: number) =>
    `按预估工时加权 · 已完成 ${d} / ${n} 项`,
  tileLeft: "剩余工作量",
  tileLeftSub: (total: string, spent: string) =>
    `总预估 ${total} · 已完成 ${spent}`,
  tileEta: "预计全部完成",
  tileEtaSub: (risky: number, days: number, cap: string) =>
    `${risky} 项风险 · 约 ${days} 个工作日 · 每日 ${cap}`,
  unit: "项",
  insightLast: (ago: string) => `上次分析 ${ago}`,
  insightNone: "还没有分析",
  insightNoneHint:
    "AI 会读看板、会话和日常打卡，告诉你哪些事在拖、哪些等你拍板。",
  insightRun: "立即生成分析",
  insightRunning: "分析中…",
  insightOpen: "查看完整报告",
  scoreLabel: "节奏分",
  loadTitle: "未来 14 天工作负荷",
  loadLede: "按截止日期倒推的每日需求，含超期积压",
  loadToday: (h: string) => `今日需求 ${h}`,
  loadPlanned: "计划需求",
  loadOver: "超出容量",
  loadCap: "每日容量",
  distTitle: "任务状态分布",
  distLede: "按状态统计任务数和剩余工时",
  distCenter: "项任务",
  focusTitle: "今日聚焦",
  focusLede: "按超期、优先级、截止日排出今天先做的",
  focusEmpty: "没有待做的任务。",
  riskTitle: "风险与提醒",
  riskEmpty: "暂时没有风险。",
  waitingTitle: (n: number) => `${n} 个会话在等你回复`,
  // schedule
  unscheduled: "未排期",
  unscheduledHint: "拖到某一天，或在任务里设截止日",
  noTasksDay: "空闲",
  today: "今天",
  over: "超出",
  // ideas
  ideaPlaceholder: "记下一个想法，回车保存",
  ideaSave: "记下",
  ideaToTask: "转成任务",
  ideaDone: "已转成任务",
  ideaEmpty: "还没有灵感。想到什么先记在这里。",
  ideasOpen: "待处理",
  ideasDone: "已转任务",
  // habits
  habitAdd: "添加习惯",
  habitName: "习惯名，例如 健身",
  habitMinutes: "分钟/天",
  habitStreak: (n: number) => `连续 ${n} 天`,
  habitToday: (d: number, n: number) => `今天完成 ${d} / ${n}`,
  habitEmpty: "还没有日常习惯。加一个每天要做的事，比如健身、写作。",
  habitCheck: "打卡",
  habitChecked: "已打卡",
  // drawer
  fTitle: "任务名",
  fStatus: "状态",
  fPriority: "优先级",
  fTopic: "主题",
  fNoTopic: "无主题",
  fEstimate: "预估（小时）",
  fDue: "截止日",
  fPlanned: "计划哪天做",
  fTags: "标签（逗号分隔）",
  fSubtasks: "子任务",
  fSubtaskAdd: "添加子任务，回车",
  fSessions: "会话",
  fSessionsEmpty: "还没挂会话。",
  fLink: "挂上已有会话",
  fNewSession: "开新会话",
  fOpen: "打开",
  fUnlink: "取下",
  fSuggest: "同主题的会话",
  fNotes: "备注",
  fDelete: "删除任务",
  fDeleteConfirm: "再点一次删除",
  untitled: "未命名任务",
  // import
  importTitle: "从主题导入",
  importLede:
    "产品卡里「没收尾」进待办，「等你决定」进等我决定。勾选后加入看板。",
  importAdd: (n: number) => `加入 ${n} 项`,
  importExists: "已在看板",
  importEmpty: "主题卡里没有「没收尾」或「等你决定」。",
  // insight panel
  panelSub: "读看板、会话和日常打卡",
  good: "做得不错",
  risks: "风险预警",
  suggestions: "建议",
  history: "历史",
  manual: "手动",
  auto: "自动",
  disclaimer: "AI 分析仅供参考，不会自动修改任务",
  settings: "AI 设置",
  sCapacity: "每日容量（小时）",
  sHour: "每天自动分析",
  sOff: "关闭",
  sWeekends: "周末算工作日",
  failed: (m: string) => `分析失败：${m}`,
  aiTitle: "AI 接入",
  aiClaude: "Claude 命令行",
  aiOpenai: "OpenAI 兼容接口",
  aiModel: "模型",
  aiClaudeHint:
    "用 rec 跑 claude -p，不带工具、不留会话；走你当前的 reclaude 账号额度。",
  aiBaseUrl: "接口地址（到 /v1）",
  aiKey: "密钥",
  aiKeyHint: "本地 Ollama 可以不填",
  aiTest: "测试连接",
  aiTestOk: (ms: number) => `连接正常，${(ms / 1000).toFixed(1)} 秒回复`,
  aiTestFail: (m: string) => `连接失败：${m}`,
  aiSave: "保存",
  aiSaved: "已保存",
  topicsTitle: "主题",
  topicsAll: "全部",
  topicsNone: "无主题",
  topicsManage: "管理主题词",
  topicsLede: "主题的关键词决定会话归到哪个主题；看板任务也按主题分组。",
  autoAt: (h: number | null) =>
    h === null ? "自动分析已关" : `自动分析：每天 ${h}:00`,
  agoMin: (m: number) =>
    m < 1
      ? "刚刚"
      : m < 60
        ? `${m} 分钟前`
        : m < 1440
          ? `${Math.floor(m / 60)} 小时前`
          : `${Math.floor(m / 1440)} 天前`,
  weekday: ["日", "一", "二", "三", "四", "五", "六"],
};

export type BoardStrings = typeof zh;

const en: BoardStrings = {
  ...zh,
  title: "Board",
  tabs: {
    overview: "Overview",
    kanban: "Board",
    schedule: "Schedule",
    ideas: "Ideas",
    habits: "Daily",
  },
  status: { todo: "To do", doing: "Doing", decide: "Needs me", done: "Done" },
  risk: { overdue: "Overdue", tight: "Tight", stale: "Idle 3 days" },
  level: { high: "High", mid: "Med", low: "Low" },
  search: "Search tasks, tags…",
  newTask: "New task",
  insight: "AI insight",
  importTopics: "Import from topics",
  filterAll: "All",
  filterRisk: "At risk",
  addTo: (col) => `Add to “${col}”`,
  addPlaceholder: "Task name, Enter to add",
  totalLine: (n, h) => `${n} tasks · ${h} left`,
  dragHint: "Drag cards to change status",
  left: (h) => `${h} left`,
  est: (h) => `Est ${h}`,
  due: (d) => `Due ${d}`,
  overdueBy: (n) => `${n}d overdue`,
  dueIn: (n) => (n === 0 ? "Due today" : `${n}d left`),
  doneOn: (d) => `Done ${d}`,
  weekDone: (n) => `${n} done this week`,
  colLeft: (h) => `${h} left`,
  running: "Running",
  waitingYou: "Waiting for you",
  sessions: (n) => `${n} sessions`,
  emptyBoard: "The board is empty",
  emptyBoardHint:
    "Write down what you're working on as tasks and attach agent sessions to see how far each one is.",
  greet: (h) =>
    h < 5
      ? "Late night"
      : h < 12
        ? "Good morning"
        : h < 18
          ? "Good afternoon"
          : "Good evening",
  todayHead: (n) => (n ? `${n} focus tasks today` : "Nothing scheduled today"),
  todayLede: (planned, cap, next) =>
    `${planned} of ${cap} planned` + (next ? ` · next due ${next}` : ""),
  weekend: "Day off — the schedule resumes on the next workday.",
  capacity: (h) => `Daily capacity ${h}`,
  tileActive: "Open tasks",
  tileProgress: "Progress",
  tileProgressSub: (d, n) => `Weighted by estimate · ${d} / ${n} done`,
  tileLeft: "Work left",
  tileLeftSub: (total, spent) => `Estimated ${total} · done ${spent}`,
  tileEta: "All done by",
  tileEtaSub: (risky, days, cap) =>
    `${risky} at risk · ~${days} workdays · ${cap}/day`,
  unit: "",
  insightLast: (ago) => `Last run ${ago}`,
  insightNone: "No analysis yet",
  insightNoneHint:
    "AI reads the board, sessions and habits and tells you what's slipping.",
  insightRun: "Analyze now",
  insightRunning: "Analyzing…",
  insightOpen: "Full report",
  scoreLabel: "Pace",
  loadTitle: "Load, next 14 days",
  loadLede: "Daily demand worked back from deadlines, overdue included",
  loadToday: (h) => `Today ${h}`,
  loadPlanned: "Planned",
  loadOver: "Over capacity",
  loadCap: "Capacity",
  distTitle: "By status",
  distLede: "Task count and hours left per status",
  distCenter: "tasks",
  focusTitle: "Today's focus",
  focusLede: "Overdue, priority, then nearest deadline",
  focusEmpty: "Nothing to do.",
  riskTitle: "Risks",
  riskEmpty: "No risks right now.",
  waitingTitle: (n) => `${n} sessions waiting for you`,
  unscheduled: "Unscheduled",
  unscheduledHint: "Drag onto a day, or set a deadline",
  noTasksDay: "Free",
  today: "Today",
  over: "over",
  ideaPlaceholder: "Jot an idea, Enter to save",
  ideaSave: "Save",
  ideaToTask: "Make task",
  ideaDone: "Became a task",
  ideaEmpty: "No ideas yet.",
  ideasOpen: "Open",
  ideasDone: "Turned into tasks",
  habitAdd: "Add habit",
  habitName: "Habit, e.g. Workout",
  habitMinutes: "min/day",
  habitStreak: (n) => `${n}-day streak`,
  habitToday: (d, n) => `${d} / ${n} done today`,
  habitEmpty: "No daily habits yet.",
  habitCheck: "Check",
  habitChecked: "Done",
  fTitle: "Title",
  fStatus: "Status",
  fPriority: "Priority",
  fTopic: "Topic",
  fNoTopic: "No topic",
  fEstimate: "Estimate (h)",
  fDue: "Due",
  fPlanned: "Planned day",
  fTags: "Tags (comma separated)",
  fSubtasks: "Subtasks",
  fSubtaskAdd: "Add subtask, Enter",
  fSessions: "Sessions",
  fSessionsEmpty: "No sessions yet.",
  fLink: "Attach a session",
  fNewSession: "New session",
  fOpen: "Open",
  fUnlink: "Detach",
  fSuggest: "Same topic",
  fNotes: "Notes",
  fDelete: "Delete task",
  fDeleteConfirm: "Click again to delete",
  untitled: "Untitled task",
  importTitle: "Import from topics",
  importLede: "Loose ends go to To do, decisions to Needs me.",
  importAdd: (n) => `Add ${n}`,
  importExists: "On board",
  importEmpty: "No loose ends or decisions in the topic cards.",
  panelSub: "Reads the board, sessions and habits",
  good: "Going well",
  risks: "Risks",
  suggestions: "Suggestions",
  history: "History",
  manual: "manual",
  auto: "auto",
  disclaimer: "AI analysis is advisory; it never edits tasks",
  settings: "AI settings",
  sCapacity: "Daily capacity (h)",
  sHour: "Daily auto analysis",
  sOff: "Off",
  sWeekends: "Weekends are workdays",
  failed: (m) => `Analysis failed: ${m}`,
  aiTitle: "AI provider",
  aiClaude: "Claude CLI",
  aiOpenai: "OpenAI-compatible",
  aiModel: "Model",
  aiClaudeHint:
    "Runs claude -p through rec with no tools and no saved session.",
  aiBaseUrl: "Base URL (up to /v1)",
  aiKey: "API key",
  aiKeyHint: "Optional for local Ollama",
  aiTest: "Test",
  aiTestOk: (ms) => `Connected, answered in ${(ms / 1000).toFixed(1)}s`,
  aiTestFail: (m) => `Failed: ${m}`,
  aiSave: "Save",
  aiSaved: "Saved",
  topicsTitle: "Topics",
  topicsAll: "All",
  topicsNone: "No topic",
  topicsManage: "Manage topic words",
  topicsLede:
    "A topic's keywords decide which sessions it collects; board tasks group by topic too.",
  autoAt: (h) => (h === null ? "Auto analysis off" : `Auto: daily ${h}:00`),
  agoMin: (m) =>
    m < 1
      ? "just now"
      : m < 60
        ? `${m}m ago`
        : m < 1440
          ? `${Math.floor(m / 60)}h ago`
          : `${Math.floor(m / 1440)}d ago`,
  weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};

export function boardStrings(locale: Locale): BoardStrings {
  return locale === "zh" ? zh : en;
}

/** Hours as a short label: 4.5h, 12h. */
export function fmtH(h: number): string {
  const r = Math.round(h * 10) / 10;
  return `${r}h`;
}

/** `2026-10-28` → `10/28`. */
export function fmtDay(key: string): string {
  const [, m, d] = key.split("-").map(Number);
  return `${m}/${d}`;
}
