import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dismissTask } from "../../src/shared/board";
import { createBoardStore } from "../../src/main/board-store";
import {
  cleanCommitSubject,
  parseReleasesJsonl,
  parseStatusNextSteps,
  resolveRepoTopic,
  splitCardLine,
} from "../../src/main/board-workbench";

describe("board-workbench helpers", () => {
  it("cleans conventional commit subjects and skips bookkeeping noise", () => {
    expect(cleanCommitSubject("Merge branch 'main' into feat/x")).toBeNull();
    expect(
      cleanCommitSubject(
        "wip: 封存 06.max 工作区未提交改动与 ui-review 记录（2026-11-12 收口留底）",
      ),
    ).toBeNull();
    expect(cleanCommitSubject("docs/status: 2026-11-11 上线记录")).toBeNull();
    expect(cleanCommitSubject("chore: 0.1.63")).toBeNull();
    expect(
      cleanCommitSubject(
        "feat(knowledge): 导图主题支持加粗、文字颜色和标记（docs/2026-11-11-maps）",
      ),
    ).toBe("导图主题支持加粗、文字颜色和标记");
  });

  it("maps worktree paths to canonical product topics", () => {
    const map = new Map<string, string>();
    expect(
      resolveRepoTopic(
        "E:/0项目/04.英语学习/ciyu-wcj-fam",
        "unclassified",
        map,
      ),
    ).toBe("ciyu");
    expect(resolveRepoTopic("E:/0项目/09.zhiyu", null, map)).toBe("zhiyu");
    expect(resolveRepoTopic("E:/0项目/开发临时用/cbw-wt-jun", null, map)).toBe(
      "cockpit",
    );
  });

  it("filters stale repo-dirty card lines and splits title/summary cleanly", () => {
    expect(splitCardLine("工作区约 35 个文件未提交（11-10）")).toBeNull();
    expect(
      splitCardLine("合并 feat/* 各功能分支进 main 的时机（11-03）"),
    ).toBeNull();
    expect(
      splitCardLine(
        "要掌握多少高频词：全部 1124（每天约 53 新词）/ 300 / 500（2026-11-11）",
      ),
    ).toEqual({
      title: "要掌握多少高频词",
      summary: "全部 1124（每天约 53 新词）/ 300 / 500",
      due: null,
    });
  });

  it("extracts dated milestones from STATUS.md next steps", () => {
    const md = [
      "# STATUS",
      "## 下一步（更新：2026-11-13）",
      "1. 2026-11-19 跑 workbench/bin/weekly.py 完成四周正式复盘",
      "2. 日常观察无日期",
    ].join("\n");
    const seeds = parseStatusNextSteps(md, "platform");
    expect(seeds).toHaveLength(1);
    expect(seeds[0]).toMatchObject({
      topic: "platform",
      status: "todo",
      due: "2026-11-19",
      title: "跑 workbench/bin/weekly.py 完成四周正式复盘",
    });
  });

  it("parses releases.jsonl commits and deploys within cutoff", () => {
    const jsonl = [
      JSON.stringify({
        ts: "2026-11-13T08:20:45+08:00",
        kind: "commit",
        product: "ciyu",
        repo: "E:/0项目/04.英语学习/ciyu",
        ref: "4a937cf123",
        subject: "chore(release): 新增词屿标准发布脚本 scripts/release-ciyu.sh",
      }),
      JSON.stringify({
        ts: "2026-11-10T22:38:43+08:00",
        kind: "deploy",
        product: "shiyu",
        repo: "E:/0项目/06.max-maps",
        ref: "4187bce",
        target: "max.yuanhk.top",
        subject: "feat(knowledge): 自由摆放的分支不盖住别的主题",
      }),
    ].join("\n");
    const items = parseReleasesJsonl(jsonl, "2026-11-01", new Map());
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({
      date: "2026-11-10",
      topic: "shiyu",
      source: "deploy",
      ref: "max.yuanhk.top",
    });
  });
});

describe("createBoardStore workbench sync integration", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("auto-syncs card items once, respects dismissedSyncKeys, and keeps autoBriefs off disk", () => {
    const root = mkdtempSync(join(tmpdir(), "cbw-board-wb-"));
    dirs.push(root);
    const userData = join(root, "user");
    const wbRoot = join(root, "workbench");
    const cardsDir = join(wbRoot, "cards");
    const dataDir = join(wbRoot, "data");
    mkdirSync(cardsDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });

    writeFileSync(
      join(cardsDir, "ciyu.md"),
      [
        "# 词屿",
        "## 等你决定",
        "- 先写主干下一步：今日页指向它 / 再加 30 句（2026-11-11）",
        "## 没收尾的",
        "- 本地有未提交改动：pnpm-lock.yaml（2026-11-12）",
        "- 看空定词性答题前后中文不一致（2026-11-11）",
      ].join("\n"),
      "utf8",
    );
    const todayIso = new Date().toISOString();
    writeFileSync(
      join(dataDir, "releases.jsonl"),
      JSON.stringify({
        ts: todayIso,
        kind: "commit",
        product: "ciyu",
        repo: "E:/0项目/04.英语学习/ciyu",
        ref: "4a937cf",
        subject: "feat(wcj): 新增先写主干练习页",
      }) + "\n",
      "utf8",
    );

    const store = createBoardStore({
      dir: userData,
      cardsDir,
      syncGit: false,
    });
    const first = store.read();
    expect(
      first.tasks.map((t) => ({ title: t.title, status: t.status })),
    ).toEqual([
      { title: "先写主干下一步", status: "decide" },
      { title: "看空定词性答题前后中文不一致", status: "todo" },
    ]);
    expect(first.autoBriefs).toHaveLength(1);

    // Disk file must NOT persist runtime `autoBriefs`.
    const onDisk = JSON.parse(
      readFileSync(join(userData, "board.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(onDisk.autoBriefs).toBeUndefined();

    // Dismissing a synced item keeps it from returning on subsequent reads.
    const afterDismiss = dismissTask(first, first.tasks[0].id);
    store.save(afterDismiss);
    const second = store.read();
    expect(second.tasks.map((t) => t.title)).toEqual([
      "看空定词性答题前后中文不一致",
    ]);
  });
});
