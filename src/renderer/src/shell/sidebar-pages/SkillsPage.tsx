import { useEffect, useRef, useState } from "react";
import {
  isIdleSkill,
  SKILL_IDLE_DAYS,
  type SkillCheck,
  type SkillCheckStatus,
  type SkillInfo,
  type SkillsData,
  type SkillUsage,
} from "@shared/skills";
import { cx } from "../../ui/atoms";
import { Icon } from "../../ui/icons";

/** Status text stays neutral; the row's dot carries the color (DESIGN.md). */
const TONE: Record<SkillCheckStatus, string> = {
  latest: "text-fg-faint",
  behind: "text-fg-muted",
  differs: "text-fg-muted",
  custom: "text-fg-faint",
  unknown: "text-fg-dim",
  error: "text-danger",
};

const smallBtn =
  "inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-aux text-fg-faint transition-colors duration-100 hover:bg-(--ui-control-hover-background) hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent";

const DAY = 86_400_000;
/** Checks older than this rerun by themselves when the page opens. */
const STALE_CHECK_MS = DAY;
/** Usage rescans by itself when the page opens and the last scan is older than this. */
const STALE_SCAN_MS = 6 * 3_600_000;

type Filter = "all" | "review" | "idle";

const needsReview = (s: SkillInfo, c: SkillCheck | undefined) =>
  s.copiesDiffer || c?.status === "behind" || c?.status === "differs";

const zh = navigator.language.startsWith("zh");
const L = zh
  ? {
      plugins: "插件",
      checkAll: "全部检查",
      check: "检查",
      update: "更新",
      upstream: "上游",
      remove: "移到回收站",
      confirmRemove: "确认移走",
      filters: { all: "全部", review: "待处理", idle: "长期不用" },
      kind: {
        git: "git 仓库",
        script: "自带更新",
        upstream: "对比上游",
        custom: "本地定制",
        local: "本地",
      },
      uses: (u: SkillUsage | undefined) =>
        !u?.count ? "没用过" : `${u.count} 次`,
      usedLine: (u: SkillUsage | undefined) =>
        !u?.count
          ? "记录里没用过"
          : `用过 ${u.count} 次，最近 ${ago(u.lastUsedAt)}`,
      scanned: (at: number | null, scanning: boolean) =>
        scanning
          ? "正在读会话记录统计用量…"
          : at
            ? `用量按会话记录统计，${ago(at)}更新`
            : "还没统计用量",
      rescan: "重新统计",
      copies: (n: number) => `${n} 份拷贝`,
      copiesDiffer: "几份拷贝的 SKILL.md 不一样，Claude 读的是第一份",
      inPlugin: (p: string) => `插件 ${p} 里也有同名 skill，这份是重复安装`,
      diff: { changed: "不同", added: "上游新增", localOnly: "只在本地" },
      idleHint: `${SKILL_IDLE_DAYS} 天以上没用过的（新装不满 ${SKILL_IDLE_DAYS} 天的不算）。移到回收站后可以从回收站还原。`,
      reviewHint: "和上游不同、有新版本，或几份拷贝不一致的。",
      removeIdle: (n: number) => `全部移到回收站（${n}）`,
      confirmIdle: (n: number) => `确认移走 ${n} 个`,
      customKept: (n: number) => `本地定制的 ${n} 个不在批量里，需要单独移`,
      empty: { review: "没有待处理的", idle: "没有长期不用的" },
      loading: "读取中…",
    }
  : {
      plugins: "Plugins",
      checkAll: "Check all",
      check: "Check",
      update: "Update",
      upstream: "Upstream",
      remove: "Move to Recycle Bin",
      confirmRemove: "Confirm",
      filters: { all: "All", review: "To review", idle: "Unused" },
      kind: {
        git: "git checkout",
        script: "self-updating",
        upstream: "vs upstream",
        custom: "customized",
        local: "local",
      },
      uses: (u: SkillUsage | undefined) =>
        !u?.count ? "never" : `${u.count}×`,
      usedLine: (u: SkillUsage | undefined) =>
        !u?.count
          ? "Never used in the transcripts"
          : `Used ${u.count}×, last ${ago(u.lastUsedAt)}`,
      scanned: (at: number | null, scanning: boolean) =>
        scanning
          ? "Reading transcripts for usage…"
          : at
            ? `Usage from transcripts, updated ${ago(at)}`
            : "Usage not counted yet",
      rescan: "Recount",
      copies: (n: number) => `${n} copies`,
      copiesDiffer: "The copies' SKILL.md differ; Claude reads the first one",
      inPlugin: (p: string) =>
        `The ${p} plugin ships a skill by this name; this copy duplicates it`,
      diff: {
        changed: "differs",
        added: "new upstream",
        localOnly: "local only",
      },
      idleHint: `Not used for ${SKILL_IDLE_DAYS}+ days (skills installed within ${SKILL_IDLE_DAYS} days excluded). Restorable from the Recycle Bin.`,
      reviewHint: "Behind or different from upstream, or copies that disagree.",
      removeIdle: (n: number) => `Move all to Recycle Bin (${n})`,
      confirmIdle: (n: number) => `Confirm moving ${n}`,
      customKept: (n: number) =>
        `${n} customized skills left out; move them one by one`,
      empty: { review: "Nothing to review", idle: "Nothing unused" },
      loading: "Loading…",
    };

function ago(ms: number | null): string {
  if (!ms) return "—";
  const d = Math.floor((Date.now() - ms) / DAY);
  if (zh) return d <= 0 ? "今天" : d === 1 ? "昨天" : `${d} 天前`;
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}

/** Two-click confirm: the first click arms the button for a few seconds. */
function useArm(): [boolean, () => boolean] {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return [
    armed,
    () => {
      if (armed) {
        setArmed(false);
        return true;
      }
      setArmed(true);
      return false;
    },
  ];
}

/**
 * Right sidebar → Skills (fork feature, 2026-10-28): every skill installed here (merged across the
 * folders Claude Code, Codex and cc-switch read) with how often it's used, an update check that
 * compares copied skills with their upstream folder file by file, and removal to the Recycle Bin.
 * Filters pick out what needs a look (behind/different/copies disagree) and what nobody uses.
 */
export function SkillsPage() {
  const [data, setData] = useState<SkillsData | null>(null);
  const [checks, setChecks] = useState<Record<string, SkillCheck>>({});
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [scanning, setScanning] = useState(false);
  const [bulkArmed, armBulk] = useArm();
  const started = useRef(false);

  const mark = (name: string, on: boolean) =>
    setBusy((b) => {
      const n = new Set(b);
      if (on) n.add(name);
      else n.delete(name);
      return n;
    });

  const run = async (name: string, fn: "checkSkill" | "updateSkill") => {
    mark(name, true);
    try {
      const c = await window.api[fn](name);
      setChecks((all) => ({ ...all, [name]: c }));
    } finally {
      mark(name, false);
    }
  };

  const checkMany = (names: string[]) => {
    // A few at a time: git fetches and GitHub reads shouldn't all fire at once.
    const queue = [...names];
    const next = async (): Promise<void> => {
      const n = queue.shift();
      if (!n) return;
      await run(n, "checkSkill");
      return next();
    };
    return Promise.all([next(), next(), next()]);
  };

  const rescan = () => {
    setScanning(true);
    void window.api
      .scanSkillUsage()
      .then((d) => setData(d))
      .finally(() => setScanning(false));
  };

  const remove = async (names: string[]) => {
    for (const n of names) mark(n, true);
    for (const n of names) await window.api.removeSkill(n);
    const fresh = await window.api.listSkills();
    setData(fresh);
    setChecks(fresh.checks);
    for (const n of names) mark(n, false);
    setOpen(null);
  };

  useEffect(() => {
    void window.api.listSkills().then((d) => {
      setData(d);
      setChecks(d.checks);
      if (started.current) return;
      started.current = true;
      if (!d.usageScannedAt || Date.now() - d.usageScannedAt > STALE_SCAN_MS)
        rescan();
      const stale = d.skills
        .filter((s) => {
          const c = d.checks[s.name];
          return !c || Date.now() - c.checkedAt > STALE_CHECK_MS;
        })
        .map((s) => s.name);
      if (stale.length) void checkMany(stale);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data)
    return <p className="px-4 py-4 text-aux text-fg-dim">{L.loading}</p>;

  const now = Date.now();
  const review = data.skills.filter((s) => needsReview(s, checks[s.name]));
  const idle = data.skills.filter((s) =>
    isIdleSkill(s, data.usage[s.name], now),
  );
  const shown =
    filter === "review" ? review : filter === "idle" ? idle : data.skills;
  const bulk = idle.filter((s) => s.source.kind !== "custom");
  const counts: Record<Filter, number> = {
    all: data.skills.length,
    review: review.length,
    idle: idle.length,
  };

  return (
    <div className="flex flex-col gap-1 px-2.5 pb-3 pt-1">
      <div className="flex items-center gap-1 px-0.5 pb-0.5">
        <div
          role="tablist"
          className="flex min-w-0 flex-1 items-center gap-0.5 rounded-sm border border-(--ui-stroke-tertiary) p-[2px]"
        >
          {(["all", "review", "idle"] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={cx(
                "flex h-6 min-w-0 flex-1 items-center justify-center gap-1 rounded-[3px] px-1 text-aux transition-colors duration-100",
                filter === f
                  ? "bg-(--ui-bg-quaternary) text-fg"
                  : "text-fg-faint hover:text-fg",
              )}
            >
              <span className="truncate">{L.filters[f]}</span>
              <span
                className={cx(
                  "tabular-nums",
                  f !== "all" && counts[f] > 0 ? "text-fg" : "text-fg-dim",
                )}
              >
                {counts[f]}
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={busy.size > 0}
          title={L.checkAll}
          aria-label={L.checkAll}
          onClick={() => void checkMany(data.skills.map((s) => s.name))}
          className={cx(smallBtn, "size-7 justify-center px-0")}
        >
          <Icon
            name={busy.size > 0 ? "loader-circle" : "rotate-ccw"}
            size={13}
            className={busy.size > 0 ? "animate-spin" : ""}
          />
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 px-1 pb-1">
        <p className="min-w-0 truncate text-meta text-fg-dim">
          {L.scanned(data.usageScannedAt, scanning || data.usageScanning)}
        </p>
        {!scanning && (
          <button
            type="button"
            onClick={rescan}
            className="shrink-0 text-meta text-fg-faint hover:text-fg"
          >
            {L.rescan}
          </button>
        )}
      </div>

      {filter !== "all" && (
        <div className="mx-1 mb-1 flex flex-col gap-1.5 rounded-md bg-(--ui-bg-quaternary) px-2.5 py-2">
          <p className="text-aux leading-snug text-fg-faint">
            {filter === "idle" ? L.idleHint : L.reviewHint}
          </p>
          {filter === "idle" && bulk.length > 0 && (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                disabled={busy.size > 0}
                onClick={() => {
                  if (armBulk()) void remove(bulk.map((s) => s.name));
                }}
                className={cx(
                  smallBtn,
                  "self-start border",
                  bulkArmed
                    ? "border-danger/60 text-danger"
                    : "border-(--ui-stroke-tertiary)",
                )}
              >
                <Icon name="trash" size={12} />
                {bulkArmed
                  ? L.confirmIdle(bulk.length)
                  : L.removeIdle(bulk.length)}
              </button>
              {idle.length > bulk.length && (
                <p className="text-meta text-fg-dim">
                  {L.customKept(idle.length - bulk.length)}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {shown.length === 0 && filter !== "all" && (
        <p className="px-2 py-3 text-aux text-fg-dim">{L.empty[filter]}</p>
      )}

      {shown.map((s) => (
        <SkillRow
          key={s.name}
          skill={s}
          usage={data.usage[s.name]}
          check={checks[s.name]}
          idle={isIdleSkill(s, data.usage[s.name], now)}
          busy={busy.has(s.name)}
          expanded={open === s.name}
          onToggle={() => setOpen((o) => (o === s.name ? null : s.name))}
          onCheck={() => void run(s.name, "checkSkill")}
          onUpdate={() => void run(s.name, "updateSkill")}
          onRemove={() => void remove([s.name])}
        />
      ))}

      {filter === "all" && data.plugins.length > 0 && (
        <>
          <p className="px-1 pb-1 pt-3 text-aux font-medium text-fg-faint">
            {L.plugins}
          </p>
          {data.plugins.map((p) => (
            <div
              key={`${p.name}@${p.marketplace}`}
              className="flex items-center gap-2 rounded-md px-2 py-1 text-body"
            >
              <Icon name="square-code" size={12} className="text-fg-dim" />
              <span className="min-w-0 flex-1 truncate text-fg-muted">
                {p.name}
              </span>
              <span className="truncate font-mono text-aux text-fg-dim">
                {p.version ?? ""}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function FileList({ label, files }: { label: string; files: string[] }) {
  if (!files.length) return null;
  const head = files.slice(0, 5);
  return (
    <div className="flex flex-col">
      <span className="text-meta text-fg-faint">
        {label} · {files.length}
      </span>
      {head.map((f) => (
        <span
          key={f}
          className="truncate font-mono text-meta text-fg-dim"
          title={f}
        >
          {f}
        </span>
      ))}
      {files.length > head.length && (
        <span className="text-meta text-fg-dim">…</span>
      )}
    </div>
  );
}

function SkillRow({
  skill: s,
  usage,
  check,
  idle,
  busy,
  expanded,
  onToggle,
  onCheck,
  onUpdate,
  onRemove,
}: {
  skill: SkillInfo;
  usage: SkillUsage | undefined;
  check: SkillCheck | undefined;
  idle: boolean;
  busy: boolean;
  expanded: boolean;
  onToggle: () => void;
  onCheck: () => void;
  onUpdate: () => void;
  onRemove: () => void;
}) {
  const [armed, arm] = useArm();
  const flagged = needsReview(s, check);
  const status = s.copiesDiffer && !check?.detail ? L.copiesDiffer : null;
  return (
    <div
      className={cx(
        "rounded-md px-2 py-1.5 transition-colors duration-100",
        expanded
          ? "bg-(--ui-bg-quaternary)"
          : "hover:bg-(--ui-row-hover-background)",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 text-left"
      >
        <span
          aria-hidden
          className={cx(
            "size-1.5 shrink-0 rounded-full",
            busy
              ? "animate-pulse bg-(--ui-text-tertiary)"
              : flagged
                ? "bg-accent"
                : !check
                  ? "bg-(--ui-stroke-primary)"
                  : check.status === "latest"
                    ? "bg-ok"
                    : check.status === "error"
                      ? "bg-danger"
                      : "bg-idle",
          )}
        />
        <span
          className={cx(
            "min-w-0 flex-1 truncate text-body",
            idle ? "text-fg-faint" : "text-fg-muted",
          )}
        >
          {s.name}
        </span>
        <span
          className={cx(
            "shrink-0 text-meta tabular-nums",
            usage?.count ? "text-fg-faint" : "text-fg-dim",
          )}
          title={L.usedLine(usage)}
        >
          {L.uses(usage)}
        </span>
      </button>
      {(check || status) && (
        <p
          className={cx(
            "mt-0.5 truncate pl-3.5 text-aux",
            check ? TONE[check.status] : "text-fg-muted",
          )}
          title={check?.detail ?? status ?? ""}
        >
          {check?.detail ?? status}
        </p>
      )}
      {expanded && (
        <div className="mt-1.5 flex flex-col gap-1.5 pl-3.5">
          {s.description && (
            <p className="line-clamp-3 text-aux leading-snug text-fg-faint">
              {s.description}
            </p>
          )}
          <p className="text-aux text-fg-faint">
            {L.usedLine(usage)} · {L.kind[s.source.kind]}
          </p>
          {s.alsoInPlugin && (
            <p className="text-aux text-fg-faint">
              {L.inPlugin(s.alsoInPlugin)}
            </p>
          )}
          {s.copiesDiffer && check?.detail && (
            <p className="text-aux text-fg-muted">{L.copiesDiffer}</p>
          )}
          {check?.diff && (
            <div className="flex flex-col gap-1">
              <FileList label={L.diff.changed} files={check.diff.changed} />
              <FileList label={L.diff.added} files={check.diff.added} />
              <FileList label={L.diff.localOnly} files={check.diff.localOnly} />
            </div>
          )}
          <p
            className="truncate font-mono text-meta text-fg-dim"
            title={s.locations.join("\n")}
          >
            {s.paths[0]}
            {s.locations.length > 1 && ` · ${L.copies(s.locations.length)}`}
          </p>
          <div className="flex flex-wrap gap-0.5">
            <button
              type="button"
              disabled={busy}
              onClick={onCheck}
              className={smallBtn}
            >
              <Icon
                name={busy ? "loader-circle" : "rotate-ccw"}
                size={12}
                className={busy ? "animate-spin" : ""}
              />
              {L.check}
            </button>
            {check?.canUpdate && (
              <button
                type="button"
                disabled={busy}
                onClick={onUpdate}
                className={cx(smallBtn, "text-fg")}
              >
                <Icon name="arrow-up-right" size={12} />
                {L.update}
              </button>
            )}
            {check?.url && (
              <button
                type="button"
                onClick={() => void window.api.openExternal(check.url!)}
                className={smallBtn}
              >
                <Icon name="github" size={12} />
                {L.upstream}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (arm()) onRemove();
              }}
              className={cx(
                smallBtn,
                "ml-auto",
                armed ? "text-danger hover:text-danger" : "",
              )}
            >
              <Icon name="trash" size={12} />
              {armed ? L.confirmRemove : L.remove}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
