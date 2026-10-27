import { describe, expect, it } from "vitest";
import {
  blankTask,
  emptyBoard,
  finishEstimate,
  loadDays,
  normalizeBoard,
  parseInsightReply,
  taskRisks,
} from "../../src/shared/board";

// 2026-10-26 is a Monday.
const MON = "2026-10-26";

function board(tasks: Parameters<typeof blankTask>[2][]) {
  const doc = emptyBoard();
  for (const p of tasks) doc.tasks.push(blankTask(doc, "t", p));
  return doc;
}

describe("loadDays", () => {
  it("spreads remaining hours over the workdays up to the deadline", () => {
    const doc = board([{ estimateH: 6, due: "2026-10-28" }]);
    const days = loadDays(doc, MON, 4);
    expect(days.map((d) => d.hours)).toEqual([2, 2, 2, 0]);
  });

  it("skips weekends unless they count", () => {
    const doc = board([{ estimateH: 4, due: "2026-11-02" }]); // Fri 10-30 .. Mon 11-02
    const days = loadDays(doc, "2026-10-30", 4);
    expect(days.map((d) => d.hours)).toEqual([2, 0, 0, 2]);
    expect(
      loadDays({ ...doc, weekends: true }, "2026-10-30", 4).map((d) => d.hours),
    ).toEqual([1, 1, 1, 1]);
  });

  it("puts overdue work on today and leaves undated work off the calendar", () => {
    const doc = board([
      { estimateH: 5, due: "2026-10-20" },
      { estimateH: 3 },
      { estimateH: 2, plannedDate: "2026-10-27" },
    ]);
    expect(loadDays(doc, MON, 2).map((d) => d.hours)).toEqual([5, 2]);
  });
});

describe("taskRisks / finishEstimate", () => {
  it("flags overdue and tight deadlines", () => {
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
  });

  it("fills capacity day by day on workdays", () => {
    const doc = board([{ estimateH: 13 }]); // 6h/day → Mon, Tue, Wed
    expect(finishEstimate(doc, MON)).toBe("2026-10-28");
  });
});

describe("normalizeBoard / parseInsightReply", () => {
  it("reads garbage as an empty board", () => {
    expect(normalizeBoard("x")).toEqual(emptyBoard());
    expect(
      normalizeBoard({ tasks: [{ status: "nope", due: "soon" }] }).tasks[0],
    ).toMatchObject({ status: "todo", due: null });
  });

  it("pulls the JSON out of a chatty reply", () => {
    const i = parseInsightReply(
      '好的：\n```json\n{"score":72.4,"headline":"节奏还行","risks":[{"level":"high","title":"超期"}]}\n```',
      1,
      "manual",
    );
    expect(i).toMatchObject({
      score: 72,
      headline: "节奏还行",
      risks: [{ level: "high", title: "超期" }],
    });
    expect(parseInsightReply("没有 JSON", 1, "manual")).toBeNull();
  });
});
