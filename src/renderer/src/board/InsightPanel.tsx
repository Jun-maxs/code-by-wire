import { useState } from "react";
import { aiLabel, blankTask, type BoardTask } from "@shared/board";
import { AiSettings } from "./AiSettings";
import { cx } from "../ui/atoms";
import { Icon } from "../ui/icons";
import { useBoardCtx } from "./context";
import { Chip, LEVEL_TEXT, Ring, btn, input, shortTopicName } from "./parts";
import { Sheet } from "./TaskDrawer";

/** The AI insight report: score, one-line verdict, what went well, risks, suggestions; history and
 *  the run settings at the foot. */
export function InsightPanel({ onClose }: { onClose: () => void }) {
  const { doc, s, run, runInsight, update } = useBoardCtx();
  const [index, setIndex] = useState(0);
  const [settings, setSettings] = useState(false);
  const insight = doc.insights[Math.min(index, doc.insights.length - 1)];

  return (
    <Sheet onClose={onClose} label={s.insight} width={480}>
      <div className="flex items-center gap-3 border-b border-ink-850 px-4 py-3">
        <div className="grid size-8 place-items-center rounded-lg bg-(--ui-bg-tertiary) text-fg">
          <Icon name="sparkles" size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-subhead font-semibold text-fg">{s.insight}</h2>
          <p className="text-meta text-fg-faint">{s.panelSub}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className={btn.ghost}
          aria-label="close"
        >
          <Icon name="x" size={15} />
        </button>
      </div>
      <p className="flex items-center gap-2 border-b border-ink-850 px-4 py-1.5 text-meta text-fg-faint">
        <span
          className={cx(
            "size-1.5 rounded-full",
            run.running ? "animate-pulse bg-working" : "bg-ok",
          )}
        />
        {aiLabel(doc.ai)}
        <span className="opacity-50">·</span>
        {s.autoAt(doc.insightHour)}
      </p>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        {settings && (
          <div className="flex flex-col gap-3 rounded-lg border border-ink-800 bg-ink-950 p-3">
            <AiSettings />
            <div className="h-px bg-ink-850" />
            <label className="flex items-center justify-between gap-3 text-aux text-fg-muted">
              {s.sCapacity}
              <input
                type="number"
                min={1}
                max={16}
                step={0.5}
                value={doc.capacityH}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v > 0 && v <= 24) update((d) => ({ ...d, capacityH: v }));
                }}
                className={cx(input, "w-20 font-mono")}
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-aux text-fg-muted">
              {s.sHour}
              <select
                value={doc.insightHour ?? ""}
                onChange={(e) =>
                  update((d) => ({
                    ...d,
                    insightHour:
                      e.target.value === "" ? null : Number(e.target.value),
                  }))
                }
                className={cx(input, "w-24")}
              >
                <option value="">{s.sOff}</option>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {h}:00
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center justify-between gap-3 text-aux text-fg-muted">
              {s.sWeekends}
              <input
                type="checkbox"
                checked={doc.weekends}
                onChange={(e) =>
                  update((d) => ({ ...d, weekends: e.target.checked }))
                }
                className="size-3.5 accent-(--color-fg)"
              />
            </label>
          </div>
        )}
        {run.error && !run.running && (
          <p className="rounded-md border border-danger/40 bg-danger/8 px-3 py-2 text-aux text-danger">
            {s.failed(run.error)}
          </p>
        )}
        {!insight && !run.running && (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Icon name="sparkles" size={22} className="text-fg-faint" />
            <p className="text-body text-fg">{s.insightNone}</p>
            <p className="max-w-[36ch] text-aux text-fg-faint">
              {s.insightNoneHint}
            </p>
          </div>
        )}
        {insight && (
          <>
            <div className="flex items-center gap-3 rounded-lg border border-ink-800 bg-ink-950 px-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-meta text-fg-faint">
                  {new Date(insight.at).toLocaleString(undefined, {
                    month: "numeric",
                    day: "numeric",
                    weekday: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {" · "}
                  {insight.trigger === "auto" ? s.auto : s.manual}
                </p>
                <h3 className="mt-0.5 text-subhead font-semibold leading-snug text-fg">
                  {insight.headline}
                </h3>
              </div>
              <Ring value={insight.score / 100} size={48}>
                <span className="font-mono text-body font-semibold tabular-nums text-fg">
                  {insight.score}
                </span>
              </Ring>
            </div>
            <p className="text-body leading-relaxed text-fg-muted">
              {insight.summary}
            </p>

            {insight.good.length > 0 && (
              <Section title={s.good}>
                {insight.good.map((g, i) => (
                  <p
                    key={i}
                    className="flex items-start gap-2 text-body text-fg-muted"
                  >
                    <Icon
                      name="check"
                      size={13}
                      className="mt-1 shrink-0 text-ok"
                    />
                    {g}
                  </p>
                ))}
              </Section>
            )}

            {insight.risks.length > 0 && (
              <Section title={s.risks}>
                {insight.risks.map((r, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-ink-800 bg-ink-925 px-3 py-2.5"
                  >
                    <p className="flex items-center gap-2">
                      <span
                        className={cx(
                          "text-meta font-semibold",
                          LEVEL_TEXT[r.level],
                        )}
                      >
                        {s.level[r.level]}
                      </span>
                      <span className="text-body font-medium text-fg">
                        {r.title}
                      </span>
                    </p>
                    {r.detail && (
                      <p className="mt-1 text-aux leading-relaxed text-fg-muted">
                        {r.detail}
                      </p>
                    )}
                    {r.action && (
                      <p className="mt-1 flex items-start gap-1 text-aux text-fg">
                        <Icon
                          name="arrow-up-right"
                          size={12}
                          className="mt-0.5 shrink-0 text-fg-faint"
                        />
                        {r.action}
                      </p>
                    )}
                  </div>
                ))}
              </Section>
            )}

            {insight.suggestions.length > 0 && (
              <Section title={s.suggestions}>
                {insight.suggestions.map((g, i) => (
                  <SuggestionRow
                    key={i}
                    tag={g.tag}
                    title={g.title}
                    detail={g.detail}
                  />
                ))}
              </Section>
            )}

            {doc.insights.length > 1 && (
              <Section title={s.history}>
                <div className="flex flex-wrap gap-1">
                  {doc.insights.slice(0, 10).map((x, i) => (
                    <button
                      key={x.at}
                      type="button"
                      aria-pressed={i === index}
                      onClick={() => setIndex(i)}
                      className={cx(
                        "inline-flex h-6 items-center gap-1.5 rounded-sm border px-2 font-mono text-meta tabular-nums",
                        i === index
                          ? "border-(--ui-stroke-primary) text-fg"
                          : "border-(--ui-stroke-tertiary) text-fg-faint hover:text-fg",
                      )}
                    >
                      {new Date(x.at).getMonth() + 1}/{new Date(x.at).getDate()}
                      <span>{x.score}</span>
                    </button>
                  ))}
                </div>
              </Section>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-ink-850 px-4 py-2.5">
        <p className="min-w-0 flex-1 truncate text-meta text-fg-faint">
          {s.disclaimer}
        </p>
        <button
          type="button"
          onClick={() => setSettings((v) => !v)}
          aria-expanded={settings}
          className={btn.outline}
        >
          <Icon name="settings" size={13} />
          {s.settings}
        </button>
        <button
          type="button"
          disabled={run.running || doc.tasks.length === 0}
          onClick={() => {
            setIndex(0);
            runInsight("manual");
          }}
          className={btn.primary}
        >
          <Icon
            name={run.running ? "loader-circle" : "sparkles"}
            size={13}
            className={run.running ? "animate-spin" : ""}
          />
          {run.running ? s.insightRunning : s.insightRun}
        </button>
      </div>
    </Sheet>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-meta font-medium text-fg-faint">{title}</h4>
      {children}
    </div>
  );
}

function SuggestionRow({
  tag,
  title,
  detail,
}: {
  tag: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      {tag && <Chip>{tag}</Chip>}
      <div className="min-w-0">
        <p className="text-body font-medium text-fg">{title}</p>
        {detail && <p className="text-aux text-fg-muted">{detail}</p>}
      </div>
    </div>
  );
}

/** Pull candidate tasks from the topic cards: loose ends → 待办, decisions → 等我决定. */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const { doc, s, topics, update } = useBoardCtx();
  const existing = new Set(doc.tasks.map((t) => t.title.trim()));
  const rows = Object.values(topics).flatMap((p) => [
    ...p.loose.map((line) => ({ topic: p, line, status: "todo" as const })),
    ...p.decide.map((line) => ({ topic: p, line, status: "decide" as const })),
  ]);
  const keyOf = (r: (typeof rows)[number]) => `${r.topic.key}\u0000${r.line}`;
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const add = () => {
    update((d) => {
      const tasks: BoardTask[] = [...d.tasks];
      for (const r of rows) {
        if (!picked.has(keyOf(r))) continue;
        tasks.push(
          blankTask({ ...d, tasks }, r.line.slice(0, 120), {
            topic: r.topic.key,
            status: r.status,
          }),
        );
      }
      return { ...d, tasks };
    });
    onClose();
  };
  return (
    <Sheet onClose={onClose} label={s.importTitle} width={520}>
      <div className="border-b border-ink-850 px-4 py-3">
        <h2 className="text-subhead font-semibold text-fg">{s.importTitle}</h2>
        <p className="mt-0.5 text-aux text-fg-faint">{s.importLede}</p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-2">
        {rows.length === 0 && (
          <p className="px-2 py-6 text-center text-aux text-fg-faint">
            {s.importEmpty}
          </p>
        )}
        {rows.map((r) => {
          const k = keyOf(r);
          const exists = existing.has(r.line.slice(0, 120).trim());
          return (
            <label
              key={k}
              className={cx(
                "flex items-start gap-2.5 rounded-md px-2 py-2",
                exists
                  ? "opacity-50"
                  : "cursor-pointer hover:bg-(--ui-row-hover-background)",
              )}
            >
              <input
                type="checkbox"
                disabled={exists}
                checked={picked.has(k)}
                onChange={() =>
                  setPicked((p) => {
                    const n = new Set(p);
                    if (n.has(k)) n.delete(k);
                    else n.add(k);
                    return n;
                  })
                }
                className="mt-1 size-3.5 accent-(--color-fg)"
              />
              <span className="min-w-0 flex-1 text-body leading-snug text-fg">
                {r.line}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <Chip color={r.topic.color}>
                  {shortTopicName(r.topic.name)}
                </Chip>
                <Chip tone={r.status === "decide" ? "mid" : "plain"}>
                  {exists ? s.importExists : s.status[r.status]}
                </Chip>
              </span>
            </label>
          );
        })}
      </div>
      <div className="flex justify-end gap-2 border-t border-ink-850 px-4 py-2.5">
        <button type="button" onClick={onClose} className={btn.ghost}>
          <Icon name="x" size={14} />
        </button>
        <button
          type="button"
          disabled={picked.size === 0}
          onClick={add}
          className={btn.primary}
        >
          {s.importAdd(picked.size)}
        </button>
      </div>
    </Sheet>
  );
}
