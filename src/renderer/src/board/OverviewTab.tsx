import { useState } from "react";
import {
  TASK_STATUSES,
  daysBetween,
  finishEstimate,
  focusOrder,
  isWorkday,
  loadDays,
  parseDay,
  remainingH,
  taskRisks,
  type BoardTask,
  type LoadDay,
  type TaskRisk,
} from "@shared/board";
import { cx } from "../ui/atoms";
import { Icon } from "../ui/icons";
import { taskLive, useBoardCtx } from "./context";
import {
  Chip,
  Dot,
  LEVEL_TEXT,
  PRIORITY_DOT,
  Panel,
  TopicChip,
  btn,
  riskLevel,
} from "./parts";
import { fmtDay, fmtH } from "./strings";

/**
 * The board's overview (2026-10-28 upgrade, DESIGN.md): what to do today leads. The four numbers sit in
 * one summary strip; the left column is "needs you" (sessions waiting, risky tasks) then "do first";
 * the right column carries the AI insight, the 14-day load and the status split. Colors only mark
 * state — bars and gauges are neutral.
 */
export function OverviewTab({ onOpenInsight }: { onOpenInsight: () => void }) {
  const ctx = useBoardCtx();
  const { doc, s, today, sessionsById, sessions, openSession, openTask } = ctx;
  const now = new Date();
  const open = doc.tasks.filter((t) => t.status !== "done");
  const done = doc.tasks.filter((t) => t.status === "done");
  const totalEst = doc.tasks.reduce((a, t) => a + t.estimateH, 0);
  const leftH = open.reduce((a, t) => a + remainingH(t), 0);
  const doneH = totalEst - leftH;
  const progress =
    totalEst > 0
      ? doneH / totalEst
      : done.length / Math.max(1, doc.tasks.length);
  const load = loadDays(doc, today, 14);
  const todayLoad = load[0];
  const risky = open
    .map((t) => ({
      t,
      risks: taskRisks(t, today, doc, taskLive(t, sessionsById).lastActivityMs),
    }))
    .filter((x) => x.risks.length > 0);
  const eta = finishEstimate(doc, today);
  let workdays = 0;
  for (const d of load) if (d.date <= eta && d.workday) workdays++;
  if (eta > load[load.length - 1].date)
    workdays = Math.max(workdays, Math.ceil(leftH / doc.capacityH));
  const focus = focusOrder(doc.tasks, today).slice(0, 7);
  const nextDue = open
    .map((t) => t.due)
    .filter((d): d is string => !!d && d >= today)
    .sort()[0];
  const counts = Object.fromEntries(
    TASK_STATUSES.map((st) => [
      st,
      doc.tasks.filter((t) => t.status === st).length,
    ]),
  ) as Record<(typeof TASK_STATUSES)[number], number>;
  const waiting = sessions.filter(
    (x) => x.state === "waiting" && !x.parentSessionId,
  );
  const workday = isWorkday(today, doc.weekends);
  const needsYou = waiting.length + risky.length;

  return (
    <div className="flex flex-col gap-4 px-5 pb-6">
      <header className="pt-1">
        <p className="text-meta text-fg-faint">
          {today} {s.weekday[now.getDay()]}
        </p>
        <h1 className="mt-1 text-heading font-semibold tracking-tight text-fg">
          {s.greet(now.getHours())}，{s.todayHead(todayLoad.taskIds.length)}
        </h1>
        <p className="mt-1 text-aux text-fg-muted">
          {workday
            ? s.todayLede(
                fmtH(todayLoad.hours),
                fmtH(doc.capacityH),
                nextDue ? fmtDay(nextDue) : null,
              )
            : s.weekend}
        </p>
      </header>

      <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-ink-800 bg-ink-925 md:grid-cols-4">
        <Stat label={s.tileActive} value={String(open.length)} unit={s.unit}>
          {s.status.doing} {counts.doing}
          {counts.todo > 0 && ` · ${s.status.todo} ${counts.todo}`}
          {counts.decide > 0 && (
            <>
              {" · "}
              <span className="text-accent">
                {s.status.decide} {counts.decide}
              </span>
            </>
          )}
        </Stat>
        <Stat
          label={s.tileProgress}
          value={Math.round(progress * 100).toString()}
          unit="%"
        >
          {s.doneOf(done.length, doc.tasks.length)}
        </Stat>
        <Stat
          label={s.tileLeft}
          value={(Math.round(leftH * 10) / 10).toString()}
          unit="h"
        >
          {s.ofTotal(fmtH(totalEst))}
        </Stat>
        <Stat label={s.tileEta} value={leftH > 0 ? fmtDay(eta) : "—"}>
          {leftH > 0 ? s.etaDays(workdays) : s.capacity(fmtH(doc.capacityH))}
        </Stat>
      </dl>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel>
            {needsYou > 0 && (
              <div className="border-b border-ink-850 px-2 pb-2 pt-3">
                <SectionLabel count={needsYou}>{s.needYou}</SectionLabel>
                {waiting.slice(0, 4).map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => openSession(w.id)}
                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-(--ui-row-hover-background)"
                  >
                    <Dot className="bg-accent" />
                    <span className="min-w-0 flex-1 truncate text-body text-fg">
                      {ctx.sessionTitle(w)}
                    </span>
                    <span className="shrink-0 text-meta text-fg-faint">
                      {s.waitingRow}
                    </span>
                    <Icon
                      name="chevron-right"
                      size={13}
                      className="text-fg-faint"
                    />
                  </button>
                ))}
                {risky.slice(0, 5).map(({ t, risks }) => (
                  <RiskRow
                    key={t.id}
                    task={t}
                    risk={risks[0]}
                    onOpen={() => openTask(t.id)}
                  />
                ))}
              </div>
            )}
            <div className="px-2 pb-2 pt-3">
              <SectionLabel>{s.doFirst}</SectionLabel>
              {focus.length === 0 && (
                <p className="px-2 py-3 text-aux text-fg-faint">
                  {s.focusEmpty}
                </p>
              )}
              {focus.map((t) => (
                <FocusRow key={t.id} task={t} onOpen={() => openTask(t.id)} />
              ))}
            </div>
          </Panel>
          <Panel
            title={s.loadTitle}
            right={
              <span
                className={cx(
                  "font-mono text-meta tabular-nums",
                  todayLoad.hours > doc.capacityH
                    ? "text-danger"
                    : "text-fg-faint",
                )}
              >
                {s.loadToday(fmtH(todayLoad.hours))}
              </span>
            }
          >
            <LoadChart days={load} capacity={doc.capacityH} />
          </Panel>
        </div>

        <InsightSummary onOpen={onOpenInsight} />
      </div>
    </div>
  );
}

function SectionLabel({
  children,
  count,
  hint,
}: {
  children: React.ReactNode;
  count?: number;
  hint?: string;
}) {
  return (
    <p className="flex items-baseline gap-2 px-2 pb-1">
      <span className="text-aux font-semibold text-fg">{children}</span>
      {count !== undefined && (
        <span className="font-mono text-meta tabular-nums text-accent">
          {count}
        </span>
      )}
      {hint && <span className="truncate text-meta text-fg-faint">{hint}</span>}
    </p>
  );
}

function Stat({
  label,
  value,
  unit,
  children,
}: {
  label: string;
  value: string;
  unit?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 border-ink-850 px-4 py-3 not-last:border-r max-md:nth-2:border-r-0 max-md:nth-[-n+2]:border-b">
      <dt className="text-meta text-fg-faint">{label}</dt>
      <dd className="flex items-baseline gap-1">
        <span className="font-mono text-title font-semibold tabular-nums text-fg">
          {value}
        </span>
        {unit && <span className="text-meta text-fg-faint">{unit}</span>}
      </dd>
      <dd className="truncate text-meta text-fg-faint">{children}</dd>
    </div>
  );
}

function InsightSummary({ onOpen }: { onOpen: () => void }) {
  const { doc, s, run, runInsight } = useBoardCtx();
  const last = doc.insights[0];
  return (
    <Panel>
      <div className="flex flex-col gap-1.5 px-4 py-3.5">
        <p className="flex items-baseline gap-2">
          <span className="text-subhead font-semibold text-fg">
            {s.insight}
          </span>
          <span className="truncate text-meta text-fg-faint">
            {run.running
              ? s.insightRunning
              : last
                ? s.insightLast(
                    s.agoMin(Math.floor((Date.now() - last.at) / 60000)),
                  )
                : s.insightNone}
          </span>
          {last && !run.running && (
            <span className="ml-auto font-mono tabular-nums text-fg-muted">
              {s.scoreLabel} {last.score}
            </span>
          )}
        </p>
        <h2 className="mt-1 text-body font-semibold text-fg">
          {last ? last.headline : s.insightNone}
        </h2>
        <p className="line-clamp-3 text-aux leading-relaxed text-fg-muted">
          {last ? last.summary : s.insightNoneHint}
        </p>
        {run.error && !run.running && (
          <p className="line-clamp-2 text-meta text-danger">
            {s.failed(run.error)}
          </p>
        )}
        <div className="mt-1">
          {last ? (
            <button
              type="button"
              onClick={onOpen}
              className={cx(btn.ghost, "-ml-2")}
            >
              {s.insightOpen}
              <Icon name="chevron-right" size={13} />
            </button>
          ) : (
            <button
              type="button"
              disabled={run.running || doc.tasks.length === 0}
              onClick={() => runInsight("manual")}
              className={btn.outline}
            >
              <Icon
                name={run.running ? "loader-circle" : "sparkles"}
                size={13}
                className={run.running ? "animate-spin" : ""}
              />
              {run.running ? s.insightRunning : s.insightRun}
            </button>
          )}
        </div>
      </div>
    </Panel>
  );
}

/** Daily demand bars against the capacity line; over-capacity days turn danger. */
function LoadChart({ days, capacity }: { days: LoadDay[]; capacity: number }) {
  const { s } = useBoardCtx();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(capacity * 1.25, ...days.map((d) => d.hours));
  const H = 88;
  const capY = H - (capacity / max) * H;
  return (
    <div className="px-4 pb-3 pt-3">
      <div className="relative" style={{ height: H + 30 }}>
        <div
          className="absolute inset-x-0 border-t border-dashed border-(--ui-stroke-primary)"
          style={{ top: capY }}
        >
          <span className="absolute -top-4 right-0 text-meta text-fg-faint">
            {s.loadCap} {fmtH(capacity)}
          </span>
        </div>
        <div className="absolute inset-x-0 top-0 flex h-full gap-1">
          {days.map((d, i) => {
            const h = (d.hours / max) * H;
            const over = d.hours > capacity + 0.01;
            const date = parseDay(d.date);
            return (
              <div
                key={d.date}
                className="relative flex min-w-0 flex-1 flex-col items-center"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <div
                  className="flex w-full flex-1 items-end justify-center"
                  style={{ height: H, maxHeight: H }}
                >
                  <div
                    className={cx(
                      "w-full max-w-[20px] rounded-t-[3px] transition-opacity duration-100",
                      over ? "bg-danger" : "bg-fg/40",
                      d.hours === 0 && "bg-(--ui-stroke-secondary)!",
                      hover !== null && hover !== i && "opacity-50",
                    )}
                    style={{ height: Math.max(2, h) }}
                  />
                </div>
                <span
                  className={cx(
                    "mt-1.5 font-mono text-tiny tabular-nums",
                    i === 0 ? "text-fg" : "text-fg-faint",
                  )}
                >
                  {/* Dates only where they help in a narrow column: today and each Monday. */}
                  {i === 0 || date.getDay() === 1 ? fmtDay(d.date) : " "}
                </span>
                <span
                  className={cx(
                    "text-tiny",
                    d.workday ? "text-fg-faint" : "text-fg-faint/50",
                  )}
                >
                  {i === 0 ? s.today : s.weekday[date.getDay()]}
                </span>
                {hover === i && (
                  <div
                    className="pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-md border border-ink-800 bg-ink-900 px-2 py-1 text-meta text-fg shadow-lg"
                    style={{ bottom: `calc(${Math.max(2, h)}px + 40px)` }}
                  >
                    {fmtDay(d.date)} ·{" "}
                    <span className="font-mono">{fmtH(d.hours)}</span>
                    {over && (
                      <span className="text-danger">
                        {" "}
                        · {s.over} {fmtH(d.hours - capacity)}
                      </span>
                    )}
                    <span className="text-fg-faint"> · {d.taskIds.length}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function FocusRow({
  task: t,
  onOpen,
}: {
  task: BoardTask;
  onOpen: () => void;
}) {
  const { s, today, topics, sessionsById } = useBoardCtx();
  const live = taskLive(t, sessionsById);
  const days = t.due ? daysBetween(today, t.due) : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-(--ui-row-hover-background)"
    >
      <Dot className={PRIORITY_DOT[t.priority]} />
      <span className="min-w-0 flex-1 truncate text-body text-fg">
        {t.title || s.untitled}
      </span>
      {live.working > 0 && (
        <span className="text-meta text-working">{s.running}</span>
      )}
      {live.working === 0 && live.waiting > 0 && (
        <span className="text-meta text-accent">{s.waitingYou}</span>
      )}
      <TopicChip topic={t.topic ? topics[t.topic] : undefined} />
      {days !== null && (
        <span
          className={cx(
            "w-16 text-right text-meta",
            days < 0
              ? "text-danger"
              : days <= 2
                ? "text-accent"
                : "text-fg-faint",
          )}
        >
          {days < 0 ? s.overdueBy(-days) : s.dueIn(days)}
        </span>
      )}
      <span className="w-10 text-right font-mono text-meta tabular-nums text-fg-faint">
        {fmtH(remainingH(t))}
      </span>
    </button>
  );
}

function RiskRow({
  task: t,
  risk,
  onOpen,
}: {
  task: BoardTask;
  risk: TaskRisk;
  onOpen: () => void;
}) {
  const { s } = useBoardCtx();
  const level = riskLevel(risk);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-(--ui-row-hover-background)"
    >
      <Icon name="triangle-alert" size={13} className={LEVEL_TEXT[level]} />
      <span className="min-w-0 flex-1 truncate text-body text-fg">
        {t.title || s.untitled}
      </span>
      <Chip tone={level}>{s.risk[risk]}</Chip>
    </button>
  );
}
