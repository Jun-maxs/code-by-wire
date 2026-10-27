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
  Ring,
  STATUS_BG,
  STATUS_VAR,
  TopicChip,
  btn,
  riskLevel,
} from "./parts";
import { fmtDay, fmtH } from "./strings";

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
  const focus = focusOrder(doc.tasks, today).slice(0, 5);
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

  return (
    <div className="flex flex-col gap-4 px-5 pb-6">
      <div className="flex flex-wrap items-end justify-between gap-3 pt-1">
        <div>
          <p className="flex items-center gap-1.5 text-meta text-fg-faint">
            <Dot className="bg-ok" />
            {today} {s.weekday[now.getDay()]}
          </p>
          <h1 className="mt-1 text-heading font-semibold tracking-tight text-fg">
            {s.greet(now.getHours())}，{s.todayHead(todayLoad.taskIds.length)}
          </h1>
          <p className="mt-1 text-aux text-fg-faint">
            {workday
              ? s.todayLede(
                  fmtH(todayLoad.hours),
                  fmtH(doc.capacityH),
                  nextDue ? fmtDay(nextDue) : null,
                )
              : s.weekend}
          </p>
        </div>
        <div className="flex gap-1.5">
          <Chip>
            <Icon name="clock" size={11} />
            {s.capacity(fmtH(doc.capacityH))}
          </Chip>
          <Chip>
            <Icon name="check" size={11} />
            {s.weekDone(
              done.filter((t) => (t.doneAt ?? 0) > Date.now() - 7 * 864e5)
                .length,
            )}
          </Chip>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Tile label={s.tileActive} icon="square-kanban">
          <Big value={String(open.length)} unit={s.unit} />
          <p className="text-meta text-fg-faint">
            <span className="text-working">
              {s.status.doing} {counts.doing}
            </span>
            {" · "}
            {s.status.todo} {counts.todo}
            {" · "}
            <span className={counts.decide ? "text-accent" : ""}>
              {s.status.decide} {counts.decide}
            </span>
          </p>
          <div className="mt-auto flex h-1 gap-[2px] overflow-hidden rounded-full">
            {(["doing", "todo", "decide"] as const).map((st) =>
              counts[st] ? (
                <div
                  key={st}
                  className={cx("h-full rounded-full", STATUS_BG[st])}
                  style={{ flex: counts[st] }}
                />
              ) : null,
            )}
            {open.length === 0 && (
              <div className="h-full flex-1 rounded-full bg-(--ui-bg-tertiary)" />
            )}
          </div>
        </Tile>
        <Tile
          label={s.tileProgress}
          icon="chart-column"
          aside={
            <Ring value={progress} size={46} color="var(--color-ok)">
              <span className="font-mono text-[10px] tabular-nums text-fg-muted">
                {done.length}/{doc.tasks.length}
              </span>
            </Ring>
          }
        >
          <Big value={(progress * 100).toFixed(1)} unit="%" />
          <p className="text-meta text-fg-faint">
            {s.tileProgressSub(done.length, doc.tasks.length)}
          </p>
        </Tile>
        <Tile label={s.tileLeft} icon="clock">
          <Big value={(Math.round(leftH * 10) / 10).toString()} unit="h" />
          <p className="text-meta text-fg-faint">
            {s.tileLeftSub(fmtH(totalEst), fmtH(doneH))}
          </p>
        </Tile>
        <Tile label={s.tileEta} icon="flag">
          <Big value={leftH > 0 ? fmtDay(eta) : "—"} />
          <p className="text-meta text-fg-faint">
            <span className={risky.length ? "text-danger" : ""}>
              {risky.length}
            </span>
            {s
              .tileEtaSub(risky.length, workdays, fmtH(doc.capacityH))
              .replace(/^\d+/, "")}
          </p>
        </Tile>
      </div>

      <InsightSummary onOpen={onOpenInsight} />

      <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel
          title={s.loadTitle}
          lede={s.loadLede}
          right={
            <Chip tone={todayLoad.hours > doc.capacityH ? "high" : "plain"}>
              {s.loadToday(fmtH(todayLoad.hours))}
            </Chip>
          }
        >
          <LoadChart days={load} capacity={doc.capacityH} />
        </Panel>
        <Panel title={s.distTitle} lede={s.distLede}>
          <StatusDonut counts={counts} hours={hoursByStatus(doc.tasks)} />
        </Panel>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title={s.focusTitle} lede={s.focusLede}>
          <div className="flex flex-col px-2 pb-2 pt-2">
            {focus.length === 0 && (
              <p className="px-2 py-3 text-aux text-fg-faint">{s.focusEmpty}</p>
            )}
            {focus.map((t) => (
              <FocusRow key={t.id} task={t} onOpen={() => openTask(t.id)} />
            ))}
          </div>
        </Panel>
        <Panel
          title={s.riskTitle}
          right={
            risky.length > 0 ? (
              <span className="font-mono text-meta text-fg-faint">
                {risky.length}
              </span>
            ) : undefined
          }
        >
          <div className="flex flex-col px-2 pb-2 pt-2">
            {waiting.length > 0 && (
              <button
                type="button"
                onClick={() => openSession(waiting[0].id)}
                className="flex items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-(--ui-row-hover-background)"
              >
                <Icon name="terminal" size={13} className="text-accent" />
                <span className="min-w-0 flex-1 truncate text-body text-fg">
                  {s.waitingTitle(waiting.length)}
                </span>
                <span className="truncate text-meta text-fg-faint">
                  {ctx.sessionTitle(waiting[0])}
                </span>
              </button>
            )}
            {risky.length === 0 && waiting.length === 0 && (
              <p className="px-2 py-3 text-aux text-fg-faint">{s.riskEmpty}</p>
            )}
            {risky.slice(0, 6).map(({ t, risks }) => (
              <RiskRow
                key={t.id}
                task={t}
                risk={risks[0]}
                onOpen={() => openTask(t.id)}
              />
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function hoursByStatus(tasks: BoardTask[]) {
  const out = { todo: 0, doing: 0, decide: 0, done: 0 };
  for (const t of tasks)
    out[t.status] += t.status === "done" ? t.estimateH : remainingH(t);
  return out;
}

function Tile({
  label,
  icon,
  aside,
  children,
}: {
  label: string;
  icon: "square-kanban" | "chart-column" | "clock" | "flag";
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[118px] flex-col gap-1.5 rounded-xl border border-ink-800 bg-ink-925 px-4 py-3.5">
      <div className="flex items-center justify-between">
        <span className="text-aux text-fg-faint">{label}</span>
        <Icon name={icon} size={14} className="text-fg-faint" />
      </div>
      <div className="flex flex-1 items-end justify-between gap-2">
        <div className="flex h-full min-w-0 flex-1 flex-col gap-1.5">
          {children}
        </div>
        {aside}
      </div>
    </div>
  );
}

function Big({ value, unit }: { value: string; unit?: string }) {
  return (
    <p className="flex items-baseline gap-1">
      <span className="font-mono text-display font-semibold tabular-nums tracking-tight text-fg">
        {value}
      </span>
      {unit && <span className="text-aux text-fg-faint">{unit}</span>}
    </p>
  );
}

function InsightSummary({ onOpen }: { onOpen: () => void }) {
  const { doc, s, run, runInsight } = useBoardCtx();
  const last = doc.insights[0];
  return (
    <section className="flex items-start gap-4 rounded-xl border border-ink-800 bg-ink-925 px-4 py-3.5">
      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-(--ui-bg-tertiary) text-fg">
        <Icon name="sparkles" size={17} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-meta text-fg-faint">
          {s.insight}
          <Dot
            className={
              run.running
                ? "bg-working animate-pulse"
                : last
                  ? "bg-ok"
                  : "bg-idle"
            }
          />
          {run.running
            ? s.insightRunning
            : last
              ? s.insightLast(
                  s.agoMin(Math.floor((Date.now() - last.at) / 60000)),
                )
              : s.insightNone}
        </p>
        <h2 className="mt-1 text-title font-semibold text-fg">
          {last ? last.headline : s.insightNone}
        </h2>
        <p className="mt-1 line-clamp-2 text-aux leading-relaxed text-fg-muted">
          {last ? last.summary : s.insightNoneHint}
        </p>
        {run.error && !run.running && (
          <p className="mt-1 line-clamp-2 text-meta text-danger">
            {s.failed(run.error)}
          </p>
        )}
        {last && last.risks.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {last.risks.slice(0, 4).map((r, i) => (
              <Chip key={i} tone={r.level}>
                {r.title}
              </Chip>
            ))}
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        {last && (
          <Ring value={last.score / 100} size={46} color="var(--color-fg)">
            <span className="font-mono text-body font-semibold tabular-nums text-fg">
              {last.score}
            </span>
          </Ring>
        )}
        {last ? (
          <button type="button" onClick={onOpen} className={btn.ghost}>
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
    </section>
  );
}

/** Daily demand bars against the capacity line; over-capacity days turn danger. */
function LoadChart({ days, capacity }: { days: LoadDay[]; capacity: number }) {
  const { s } = useBoardCtx();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(capacity * 1.25, ...days.map((d) => d.hours));
  const H = 150;
  const capY = H - (capacity / max) * H;
  return (
    <div className="px-4 pb-3 pt-3">
      <div className="relative" style={{ height: H + 34 }}>
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
                      "w-full max-w-[28px] rounded-t-[4px] transition-opacity duration-100",
                      over ? "bg-danger" : "bg-fg/70",
                      d.hours === 0 && "bg-(--ui-stroke-secondary)!",
                      hover !== null && hover !== i && "opacity-50",
                    )}
                    style={{ height: Math.max(2, h) }}
                  />
                </div>
                <span
                  className={cx(
                    "mt-1.5 font-mono text-[10px] tabular-nums",
                    i === 0 ? "text-fg" : "text-fg-faint",
                  )}
                >
                  {fmtDay(d.date)}
                </span>
                <span
                  className={cx(
                    "text-[10px]",
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
      <div className="mt-2 flex gap-4 text-meta text-fg-faint">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-fg/70" />
          {s.loadPlanned}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-danger" />
          {s.loadOver}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 border-t border-dashed border-(--ui-stroke-primary)" />
          {s.loadCap}
        </span>
      </div>
    </div>
  );
}

function StatusDonut({
  counts,
  hours,
}: {
  counts: Record<"todo" | "doing" | "decide" | "done", number>;
  hours: Record<"todo" | "doing" | "decide" | "done", number>;
}) {
  const { s } = useBoardCtx();
  const total = TASK_STATUSES.reduce((a, st) => a + counts[st], 0);
  const size = 128;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const gap = total > 1 ? 3 : 0;
  let acc = 0;
  return (
    <div className="flex items-center gap-5 px-4 pb-4 pt-3">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--ui-bg-tertiary)"
            strokeWidth={stroke}
          />
          {total > 0 &&
            TASK_STATUSES.map((st) => {
              const len = (counts[st] / total) * c;
              const el =
                len > 0 ? (
                  <circle
                    key={st}
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    fill="none"
                    stroke={STATUS_VAR[st]}
                    strokeWidth={stroke}
                    strokeDasharray={`${Math.max(0, len - gap)} ${c}`}
                    strokeDashoffset={-acc}
                  />
                ) : null;
              acc += len;
              return el;
            })}
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="font-mono text-display font-semibold tabular-nums text-fg">
              {total}
            </p>
            <p className="text-meta text-fg-faint">{s.distCenter}</p>
          </div>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {TASK_STATUSES.map((st) => (
          <div key={st} className="flex items-center gap-2 text-aux">
            <Dot className={STATUS_BG[st]} />
            <span className="min-w-0 flex-1 truncate text-fg-muted">
              {s.status[st]}
            </span>
            <span className="font-mono tabular-nums text-fg">{counts[st]}</span>
            <span className="w-12 text-right font-mono text-meta tabular-nums text-fg-faint">
              {fmtH(hours[st])}
            </span>
          </div>
        ))}
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
      className="flex items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-(--ui-row-hover-background)"
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
      className="flex items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-(--ui-row-hover-background)"
    >
      <Icon name="triangle-alert" size={13} className={LEVEL_TEXT[level]} />
      <span className="min-w-0 flex-1 truncate text-body text-fg">
        {t.title || s.untitled}
      </span>
      <Chip tone={level}>{s.risk[risk]}</Chip>
    </button>
  );
}
