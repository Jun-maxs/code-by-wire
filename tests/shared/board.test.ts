import { describe, expect, it } from "vitest";
import {
  blankBrief,
  blankTask,
  buildInsightPrompt,
  completeTaskWithBrief,
  dismissBrief,
  dismissTask,
  emptyBoard,
  finishEstimate,
  formatDayMarkdown,
  loadDays,
  mergedDailyBriefs,
  normalizeBoard,
  parseInsightReply,
  reopenTask,
  splitPendingQueue,
  taskRisks,
  upsertBriefText,
} from "../../src/shared/board";

// 2026-10-26 is a Monday.
const MON = "2026-10-26";

function board(tasks: Parameters<typeof blankTask>[2][]) {
  const doc = emptyBoard();
  for (const p of tasks) doc.tasks.push(blankTask(doc, "t", p));
  return doc;
}

describe("loadDays & legacy helpers", () => {
  it("spreads remaining hours over the workdays up to the deadline", () => {
    const doc = board([{ estimateH: 6, due: "2026-10-28" }]);
    const days = loadDays(doc, MON, 4);
    expect(days.map((d) => d.hours)).toEqual([2, 2, 2, 0]);
  });

  it("skips weekends unless they count", () => {
    const doc = board([{ estimateH: 4, due: "2026-11-02" }]);
    const days = loadDays(doc, "2026-10-30", 4);
    expect(days.map((d) => d.hours)).toEqual([2, 0, 0, 2]);
    expect(
      loadDays({ ...doc, weekends: true }, "2026-10-30", 4).map((d) => d.hours),
    ).toEqual([1, 1, 1, 1]);
  });

  it("flags overdue and tight deadlines and estimates completion", () => {
    const doc = board([
      { estimateH: 2, due: "2026-10-25" },
      { estimateH: 20, due: "2026-10-27" },
      { estimateH: 2, due: "2026-10-27" },
    ]);
    expect(doc.tasks.map((t) => taskRisks(t, MON, doc))).toEqual([
      ["overdue"],
      ["tight"],
      [],
    ]);
    expect(finishEstimate(board([{ estimateH: 13 }]), MON)).toBe("2026-10-28");
  });
});

describe("pending confirmations & execution queue", () => {
  it("elevates decide tasks and waiting-session tasks into confirm, ordering running/P0 first in execute", () => {
    let doc = emptyBoard();
    const tTodoP2 = blankTask(doc, "Todo P2", {
      status: "todo",
      priority: "P2",
      order: 1,
    });
    doc = { ...doc, tasks: [...doc.tasks, tTodoP2] };
    const tDecide = blankTask(doc, "Need call", {
      status: "decide",
      priority: "P1",
      order: 2,
    });
    doc = { ...doc, tasks: [...doc.tasks, tDecide] };
    const tWaiting = blankTask(doc, "Agent waiting", {
      status: "doing",
      priority: "P2",
      order: 3,
    });
    doc = { ...doc, tasks: [...doc.tasks, tWaiting] };
    const tTodoP0 = blankTask(doc, "Urgent P0", {
      status: "todo",
      priority: "P0",
      order: 4,
    });
    doc = { ...doc, tasks: [...doc.tasks, tTodoP0] };
    const tDoing = blankTask(doc, "Actively doing", {
      status: "doing",
      priority: "P2",
      order: 5,
    });
    doc = { ...doc, tasks: [...doc.tasks, tDoing] };

    const live = new Map([
      [tWaiting.id, { working: 0, waiting: 1 }],
      [tDoing.id, { working: 1, waiting: 0 }],
    ]);
    const groups = splitPendingQueue(doc.tasks, "2026-11-13", live);
    expect(groups.confirm.map((t) => t.title)).toEqual([
      "Agent waiting",
      "Need call",
    ]);
    expect(groups.execute.map((t) => t.title)).toEqual([
      "Actively doing",
      "Urgent P0",
      "Todo P2",
    ]);
  });

  it("completes a task into dailyLog and cleans up when reopened or dismissed", () => {
    let doc = emptyBoard();
    const t = blankTask(doc, "重构左侧看板", {
      summary: "重构左侧看板为待确认队列与每日实现简述清单",
      topic: "cockpit",
      sourceKey: "wb:card:cockpit:decide:abc",
      sessionIds: ["sess-1"],
    });
    doc = { ...doc, tasks: [t] };

    doc = completeTaskWithBrief(doc, t.id, "2026-11-13", 1700000000000);
    expect(doc.tasks[0].status).toBe("done");
    expect(doc.dailyLog).toHaveLength(1);
    expect(doc.dailyLog[0]).toMatchObject({
      date: "2026-11-13",
      topic: "cockpit",
      text: "重构左侧看板为待确认队列与每日实现简述清单",
      source: "task",
      sessionId: "sess-1",
      taskId: t.id,
    });

    doc = reopenTask(doc, t.id, "todo");
    expect(doc.tasks[0].status).toBe("todo");
    expect(doc.dailyLog).toHaveLength(0);

    doc = dismissTask(doc, t.id);
    expect(doc.tasks).toHaveLength(0);
    expect(doc.dismissedSyncKeys).toContain("wb:card:cockpit:decide:abc");
  });
});

describe("daily implementation digest", () => {
  it("merges dailyLog + autoBriefs, prefers deploys, applies user wording overrides, and formats Markdown", () => {
    let doc = emptyBoard();
    doc.autoBriefs = [
      blankBrief("2026-11-13", "新增词屿标准发布脚本", {
        id: "auto-commit",
        topic: "ciyu",
        source: "commit",
        ref: "4a937cf",
        syncKey: "wb:git:ciyu:4a937cf",
        createdAt: 100,
      }),
      blankBrief("2026-11-13", "新增词屿标准发布脚本", {
        id: "auto-deploy",
        topic: "ciyu",
        source: "deploy",
        ref: "cet.yuanai.best",
        syncKey: "wb:rel:deploy:ciyu:4a937cf",
        createdAt: 200,
      }),
      blankBrief("2026-11-12", "归档评审走查记录", {
        id: "auto-nido",
        topic: "nido",
        source: "commit",
        ref: "8c8ba12",
        syncKey: "wb:git:nido:8c8ba12",
        createdAt: 50,
      }),
    ];

    // Override wording on the nido entry and dismiss nothing yet.
    doc = upsertBriefText(
      doc,
      doc.autoBriefs[2],
      "Nido 归档 11-01 至 11-06 应用管理评审记录",
    );

    const merged = mergedDailyBriefs(doc);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      date: "2026-11-13",
      source: "deploy",
      ref: "cet.yuanai.best",
    });
    expect(merged[1].text).toBe("Nido 归档 11-01 至 11-06 应用管理评审记录");

    const md = formatDayMarkdown("2026-11-13", [merged[0]], { ciyu: "词屿" });
    expect(md).toBe(
      "### 2026-11-13 任务实现简述清单\n- [词屿] 新增词屿标准发布脚本（上线 cet.yuanai.best）",
    );

    // Dismissing an auto item suppresses its syncKey.
    doc = dismissBrief(doc, merged[0]);
    expect(mergedDailyBriefs(doc).map((b) => b.date)).toEqual(["2026-11-12"]);
  });
});

describe("normalizeBoard / parseInsightReply / buildInsightPrompt", () => {
  it("reads garbage as an empty board and preserves dailyLog", () => {
    expect(normalizeBoard("x")).toEqual(emptyBoard());
    const normalized = normalizeBoard({
      tasks: [{ status: "nope", due: "soon", summary: "说明" }],
      dailyLog: [{ date: "2026-11-13", text: "完成重构", source: "manual" }],
      dismissedSyncKeys: ["k1", "k1"],
    });
    expect(normalized.tasks[0]).toMatchObject({
      status: "todo",
      due: null,
      summary: "说明",
    });
    expect(normalized.dailyLog).toHaveLength(1);
    expect(normalized.dismissedSyncKeys).toEqual(["k1"]);
  });

  it("builds insight prompt from pending queue & daily digest and parses reply", () => {
    const doc = emptyBoard();
    doc.dailyLog.push(
      blankBrief("2026-11-13", "完成看板全面重构", { topic: "cockpit" }),
    );
    const prompt = buildInsightPrompt(doc, "2026-11-13", [], {
      cockpit: "Jun-Code",
    });
    expect(prompt).toContain("完成看板全面重构");
    expect(prompt).not.toContain("每日容量");

    const i = parseInsightReply(
      '好的：\n```json\n{"score":86.4,"headline":"产出扎实","risks":[{"level":"mid","title":"待确认"}]}\n```',
      1,
      "manual",
    );
    expect(i).toMatchObject({
      score: 86,
      headline: "产出扎实",
      risks: [{ level: "mid", title: "待确认" }],
    });
    expect(parseInsightReply("没有 JSON", 1, "manual")).toBeNull();
  });
});
