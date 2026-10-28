import { useEffect, useState } from "react";
import type {
  SkillCheck,
  SkillCheckStatus,
  SkillInfo,
  SkillsData,
} from "@shared/skills";
import { cx } from "../../ui/atoms";
import { Icon } from "../../ui/icons";

const TONE: Record<SkillCheckStatus, string> = {
  latest: "text-ok",
  behind: "text-accent",
  differs: "text-accent",
  custom: "text-(--ui-text-tertiary)",
  unknown: "text-(--ui-text-quaternary)",
  error: "text-danger",
};

/** Checks survive switching tabs and sessions within one app run. */
const checks = new Map<string, SkillCheck>();

const smallBtn =
  "inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-xs text-(--ui-text-tertiary) transition-colors duration-100 hover:bg-(--ui-control-hover-background) hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent";

/**
 * Right sidebar → Skills (fork feature, 2026-10-28): every skill installed here (merged across the
 * folders Claude Code, Codex and cc-switch read) and the Claude Code plugins, with an update check
 * per skill or for all of them. "Update" runs only where it is safe in place (git, own updater).
 */
export function SkillsPage() {
  const [data, setData] = useState<SkillsData | null>(null);
  const [, rerender] = useState(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const zh = navigator.language.startsWith("zh");
  const L = zh
    ? {
        skills: "Skill",
        plugins: "插件",
        checkAll: "全部检查",
        check: "检查",
        update: "更新",
        upstream: "上游",
        copies: (n: number) => `${n} 份拷贝`,
        kind: {
          git: "git",
          script: "自带更新",
          upstream: "对比上游",
          custom: "本地定制",
          local: "本地",
        },
        summary: (n: number, u: number) =>
          `${n} 个` + (u ? ` · ${u} 个待看` : ""),
        differsHint:
          "和上游的 SKILL.md 不一样：可能上游出了新版，也可能本地改过。点「上游」对照。",
        loading: "读取中…",
      }
    : {
        skills: "Skills",
        plugins: "Plugins",
        checkAll: "Check all",
        check: "Check",
        update: "Update",
        upstream: "Upstream",
        copies: (n: number) => `${n} copies`,
        kind: {
          git: "git",
          script: "self-updating",
          upstream: "vs upstream",
          custom: "customized",
          local: "local",
        },
        summary: (n: number, u: number) =>
          `${n}` + (u ? ` · ${u} to review` : ""),
        differsHint:
          "Differs from upstream SKILL.md: a newer version, or local edits. Open Upstream to compare.",
        loading: "Loading…",
      };

  useEffect(() => {
    void window.api.listSkills().then(setData);
  }, []);

  const run = async (name: string, fn: "checkSkill" | "updateSkill") => {
    setBusy((b) => new Set(b).add(name));
    try {
      checks.set(name, await window.api[fn](name));
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        n.delete(name);
        return n;
      });
      rerender((x) => x + 1);
    }
  };

  if (!data)
    return (
      <p className="px-4 py-4 text-xs text-(--ui-text-quaternary)">
        {L.loading}
      </p>
    );

  const flagged = data.skills.filter((s) => {
    const c = checks.get(s.name);
    return c && (c.status === "behind" || c.status === "differs");
  }).length;

  return (
    <div className="flex flex-col gap-1 px-2.5 pb-3 pt-1">
      <div className="flex items-center justify-between gap-2 px-1 pb-1">
        <p className="text-xs text-(--ui-text-tertiary)">
          {L.summary(data.skills.length, flagged)}
        </p>
        <button
          type="button"
          disabled={busy.size > 0}
          onClick={() => {
            // A few at a time: git fetches and GitHub reads shouldn't all fire at once.
            const names = data.skills.map((s) => s.name);
            const next = async (): Promise<void> => {
              const n = names.shift();
              if (!n) return;
              await run(n, "checkSkill");
              return next();
            };
            void Promise.all([next(), next(), next()]);
          }}
          className={cx(
            smallBtn,
            "shrink-0 whitespace-nowrap border border-(--ui-stroke-tertiary)",
          )}
        >
          <Icon
            name={busy.size > 0 ? "loader-circle" : "rotate-ccw"}
            size={12}
            className={busy.size > 0 ? "animate-spin" : ""}
          />
          {L.checkAll}
        </button>
      </div>

      {data.skills.map((s) => (
        <SkillRow
          key={s.name}
          skill={s}
          check={checks.get(s.name)}
          busy={busy.has(s.name)}
          expanded={open === s.name}
          onToggle={() => setOpen((o) => (o === s.name ? null : s.name))}
          onCheck={() => void run(s.name, "checkSkill")}
          onUpdate={() => void run(s.name, "updateSkill")}
          L={L}
        />
      ))}

      {data.plugins.length > 0 && (
        <>
          <p className="px-1 pb-1 pt-3 text-xs font-medium text-(--ui-text-tertiary)">
            {L.plugins}
          </p>
          {data.plugins.map((p) => (
            <div
              key={`${p.name}@${p.marketplace}`}
              className="flex items-center gap-2 rounded-md px-2 py-1 text-[0.8125rem]"
            >
              <Icon
                name="square-code"
                size={12}
                className="text-(--ui-text-quaternary)"
              />
              <span className="min-w-0 flex-1 truncate text-(--ui-text-secondary)">
                {p.name}
              </span>
              <span className="truncate font-mono text-xs text-(--ui-text-quaternary)">
                {p.version ?? ""}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function SkillRow({
  skill: s,
  check,
  busy,
  expanded,
  onToggle,
  onCheck,
  onUpdate,
  L,
}: {
  skill: SkillInfo;
  check: SkillCheck | undefined;
  busy: boolean;
  expanded: boolean;
  onToggle: () => void;
  onCheck: () => void;
  onUpdate: () => void;
  L: {
    check: string;
    update: string;
    upstream: string;
    copies: (n: number) => string;
    differsHint: string;
    kind: Record<SkillInfo["source"]["kind"], string>;
  };
}) {
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
        className="flex w-full items-center gap-2 text-left"
      >
        <span
          aria-hidden
          className={cx(
            "size-1.5 shrink-0 rounded-full",
            !check
              ? "bg-(--ui-stroke-primary)"
              : check.status === "latest"
                ? "bg-ok"
                : check.status === "behind" || check.status === "differs"
                  ? "bg-accent"
                  : check.status === "error"
                    ? "bg-danger"
                    : "bg-idle",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-(--ui-text-secondary)">
          {s.name}
        </span>
        <span className="shrink-0 text-[0.6875rem] text-(--ui-text-quaternary)">
          {L.kind[s.source.kind]}
        </span>
      </button>
      {check && (
        <p
          className={cx("mt-0.5 truncate pl-3.5 text-xs", TONE[check.status])}
          title={check.status === "differs" ? L.differsHint : check.detail}
        >
          {check.detail}
        </p>
      )}
      {expanded && (
        <div className="mt-1 flex flex-col gap-1 pl-3.5">
          {s.description && (
            <p className="line-clamp-3 text-xs leading-snug text-(--ui-text-tertiary)">
              {s.description}
            </p>
          )}
          <p
            className="truncate font-mono text-[0.6875rem] text-(--ui-text-quaternary)"
            title={s.paths.join("\n")}
          >
            {s.paths[0]}
            {s.paths.length > 1 && ` · ${L.copies(s.paths.length)}`}
          </p>
          <div className="flex gap-0.5">
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
                className={cx(smallBtn, "text-accent")}
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
          </div>
        </div>
      )}
    </div>
  );
}
