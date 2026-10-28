import { useState, type DragEvent } from "react";
import {
  addDays,
  blankTask,
  habitStreak,
  loadDays,
  newId,
  parseDay,
  remainingH,
  type BoardTask,
} from "@shared/board";
import { cx } from "../ui/atoms";
import { Icon } from "../ui/icons";
import { useBoardCtx } from "./context";
import {
  Dot,
  PRIORITY_DOT,
  Panel,
  TopicChip,
  btn,
  input,
  taskMatches,
} from "./parts";
import { fmtDay, fmtH } from "./strings";

const DRAG_MIME = "application/x-cbw-plan";

/** 排期: the next 14 days, each with what it asks of you against the daily capacity, plus the
 *  tasks with no day yet. Dropping a task on a day sets its planned day. */
export function ScheduleTab({ query }: { query: string }) {
  const { doc, s, today, update, openTask } = useBoardCtx();
  const [over, setOver] = useState<string | null>(null);
  const days = loadDays(doc, today, 14);
  const byId = new Map(doc.tasks.map((t) => [t.id, t]));
  const unscheduled = doc.tasks.filter(
    (t) =>
      t.status !== "done" && !t.due && !t.plannedDate && taskMatches(t, query),
  );

  const plan = (e: DragEvent, date: string | null) => {
    const id = e.dataTransfer.getData(DRAG_MIME);
    setOver(null);
    if (!id) return;
    e.preventDefault();
    update((d) => ({
      ...d,
      tasks: d.tasks.map((t) =>
        t.id === id ? { ...t, plannedDate: date } : t,
      ),
    }));
  };
  const dragOver = (key: string) => (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    setOver(key);
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(220px,280px)_minmax(0,1fr)] gap-3 px-5 pb-4">
      <Panel
        title={s.unscheduled}
        lede={s.unscheduledHint}
        className={cx(
          "min-h-0",
          over === "none" && "border-(--ui-stroke-primary)",
        )}
      >
        <div
          className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2"
          onDragOver={dragOver("none")}
          onDragLeave={() => setOver(null)}
          onDrop={(e) => plan(e, null)}
        >
          {unscheduled.map((t) => (
            <PlanChip key={t.id} task={t} onOpen={() => openTask(t.id)} />
          ))}
        </div>
      </Panel>
      <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto">
        {days.map((d) => {
          const date = parseDay(d.date);
          const ratio = d.hours / doc.capacityH;
          const tasks = d.taskIds
            .map((id) => byId.get(id))
            .filter((t): t is BoardTask => !!t && taskMatches(t, query));
          const isToday = d.date === today;
          return (
            <div
              key={d.date}
              onDragOver={dragOver(d.date)}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node))
                  setOver(null);
              }}
              onDrop={(e) => plan(e, d.date)}
              className={cx(
                "grid grid-cols-[72px_120px_minmax(0,1fr)] items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors duration-100",
                over === d.date
                  ? "border-(--ui-stroke-primary) bg-ink-925"
                  : "border-ink-800 bg-ink-925",
                !d.workday && "opacity-60",
              )}
            >
              <div>
                <p
                  className={cx(
                    "font-mono text-body tabular-nums",
                    isToday ? "font-semibold text-fg" : "text-fg-muted",
                  )}
                >
                  {fmtDay(d.date)}
                </p>
                <p className="text-meta text-fg-faint">
                  {isToday ? s.today : s.weekday[date.getDay()]}
                </p>
              </div>
              <div className="pt-1">
                <div className="h-1.5 overflow-hidden rounded-full bg-(--ui-bg-tertiary)">
                  <div
                    className={cx(
                      "h-full rounded-full",
                      ratio > 1.001 ? "bg-danger" : "bg-fg/70",
                    )}
                    style={{ width: `${Math.min(100, ratio * 100)}%` }}
                  />
                </div>
                <p
                  className={cx(
                    "mt-1 font-mono text-meta tabular-nums",
                    ratio > 1.001 ? "text-danger" : "text-fg-faint",
                  )}
                >
                  {fmtH(d.hours)} / {fmtH(doc.capacityH)}
                </p>
              </div>
              <div className="flex min-w-0 flex-wrap gap-1.5">
                {tasks.length === 0 && (
                  <span className="pt-1 text-meta text-fg-faint">
                    {s.noTasksDay}
                  </span>
                )}
                {tasks.map((t) => (
                  <PlanChip
                    key={t.id}
                    task={t}
                    onOpen={() => openTask(t.id)}
                    hours={dayShare(t, d.date, today, doc)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** How much of a task's remaining hours falls on `date` (same spread as loadDays). */
function dayShare(
  t: BoardTask,
  date: string,
  today: string,
  doc: Parameters<typeof loadDays>[0],
): number {
  const one = loadDays(
    { ...doc, tasks: [t] },
    today,
    Math.max(
      1,
      Math.round(
        (parseDay(date).getTime() - parseDay(today).getTime()) / 864e5,
      ) + 1,
    ),
  );
  return one[one.length - 1]?.hours ?? 0;
}

function PlanChip({
  task: t,
  onOpen,
  hours,
}: {
  task: BoardTask;
  onOpen: () => void;
  hours?: number;
}) {
  const { s, topics } = useBoardCtx();
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, t.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={onOpen}
      className="flex max-w-full items-center gap-1.5 rounded-md border border-(--ui-stroke-secondary) bg-ink-950 px-2 py-1 text-left text-aux text-fg hover:border-(--ui-stroke-primary)"
    >
      <Dot className={PRIORITY_DOT[t.priority]} />
      <span className="min-w-0 truncate">{t.title || s.untitled}</span>
      <TopicChip topic={t.topic ? topics[t.topic] : undefined} />
      <span className="shrink-0 font-mono text-meta tabular-nums text-fg-faint">
        {fmtH(hours ?? remainingH(t))}
      </span>
    </button>
  );
}

/** 灵感: jot first, sort later. An idea can become a task in one click. */
export function IdeasTab({ query }: { query: string }) {
  const { doc, s, update, topics, openTask, defaultTopic } = useBoardCtx();
  const [text, setText] = useState("");
  const [topic, setTopic] = useState(defaultTopic ?? "");
  const q = query.toLowerCase();
  const ideas = doc.ideas.filter((i) => !q || i.text.toLowerCase().includes(q));
  const open = ideas.filter((i) => !i.taskId);
  const done = ideas.filter((i) => i.taskId);

  const save = () => {
    const t = text.trim();
    if (!t) return;
    update((d) => ({
      ...d,
      ideas: [
        {
          id: newId(),
          text: t,
          topic: topic || null,
          createdAt: Date.now(),
          taskId: null,
        },
        ...d.ideas,
      ],
    }));
    setText("");
  };

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-5 pb-6">
      <div className="flex flex-col gap-2 rounded-xl border border-ink-800 bg-ink-925 p-3">
        <textarea
          value={text}
          rows={2}
          placeholder={s.ideaPlaceholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              save();
            }
          }}
          className="w-full resize-none bg-transparent text-body leading-relaxed text-fg outline-none placeholder:text-fg-faint"
        />
        <div className="flex items-center gap-2">
          <select
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className={cx(input, "w-auto")}
          >
            <option value="">{s.fNoTopic}</option>
            {Object.values(topics).map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={save}
            disabled={!text.trim()}
            className={cx(btn.primary, "ml-auto")}
          >
            <Icon name="lightbulb" size={13} />
            {s.ideaSave}
          </button>
        </div>
      </div>

      {ideas.length === 0 && (
        <p className="py-8 text-center text-aux text-fg-faint">{s.ideaEmpty}</p>
      )}
      {open.length > 0 && (
        <IdeaGroup title={s.ideasOpen} count={open.length}>
          {open.map((i) => (
            <div
              key={i.id}
              className="group flex items-start gap-3 rounded-lg border border-ink-800 bg-ink-925 px-3 py-2.5"
            >
              <Icon
                name="lightbulb"
                size={14}
                className="mt-0.5 shrink-0 text-accent"
              />
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap text-body leading-relaxed text-fg">
                  {i.text}
                </p>
                <p className="mt-1 flex items-center gap-2 text-meta text-fg-faint">
                  {new Date(i.createdAt).toLocaleDateString()}
                  <TopicChip topic={i.topic ? topics[i.topic] : undefined} />
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const task = blankTask(
                      doc,
                      i.text.split("\n")[0].slice(0, 80),
                      {
                        topic: i.topic,
                        notes: i.text.includes("\n") ? i.text : "",
                      },
                    );
                    update((d) => ({
                      ...d,
                      tasks: [...d.tasks, task],
                      ideas: d.ideas.map((x) =>
                        x.id === i.id ? { ...x, taskId: task.id } : x,
                      ),
                    }));
                    openTask(task.id);
                  }}
                  className={btn.outline}
                >
                  {s.ideaToTask}
                </button>
                <button
                  type="button"
                  aria-label="delete"
                  onClick={() =>
                    update((d) => ({
                      ...d,
                      ideas: d.ideas.filter((x) => x.id !== i.id),
                    }))
                  }
                  className={cx(btn.ghost, "opacity-0 group-hover:opacity-100")}
                >
                  <Icon name="trash" size={13} />
                </button>
              </div>
            </div>
          ))}
        </IdeaGroup>
      )}
      {done.length > 0 && (
        <IdeaGroup title={s.ideasDone} count={done.length}>
          {done.map((i) => (
            <button
              key={i.id}
              type="button"
              onClick={() =>
                i.taskId &&
                doc.tasks.some((t) => t.id === i.taskId) &&
                openTask(i.taskId)
              }
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-left text-aux text-fg-faint hover:bg-(--ui-row-hover-background)"
            >
              <Icon name="check" size={13} className="text-ok" />
              <span className="min-w-0 flex-1 truncate">{i.text}</span>
              <span>{s.ideaDone}</span>
            </button>
          ))}
        </IdeaGroup>
      )}
    </div>
  );
}

function IdeaGroup({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <h2 className="flex items-center gap-2 px-1 text-aux font-medium text-fg-faint">
        {title}
        <span className="font-mono tabular-nums">{count}</span>
      </h2>
      {children}
    </div>
  );
}

/** 日常: daily habits with a 14-day strip; click a cell to toggle that day. */
export function HabitsTab() {
  const { doc, s, today, update } = useBoardCtx();
  const [name, setName] = useState("");
  const [minutes, setMinutes] = useState("");
  const span = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const doneToday = doc.habits.filter((h) => h.days.includes(today)).length;

  const toggle = (id: string, day: string) =>
    update((d) => ({
      ...d,
      habits: d.habits.map((h) =>
        h.id !== id
          ? h
          : {
              ...h,
              days: h.days.includes(day)
                ? h.days.filter((x) => x !== day)
                : [...h.days, day].sort(),
            },
      ),
    }));
  const add = () => {
    const n = name.trim();
    if (!n) return;
    update((d) => ({
      ...d,
      habits: [
        ...d.habits,
        {
          id: newId(),
          name: n,
          minutes: Math.max(0, Number(minutes) || 0),
          days: [],
          createdAt: Date.now(),
        },
      ],
    }));
    setName("");
    setMinutes("");
  };

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-4 px-5 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-aux text-fg-muted">
          {doc.habits.length > 0 && s.habitToday(doneToday, doc.habits.length)}
        </p>
        <div className="flex items-center gap-1.5">
          <input
            value={name}
            placeholder={s.habitName}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" && !e.nativeEvent.isComposing && add()
            }
            className={cx(input, "w-44")}
          />
          <input
            value={minutes}
            placeholder={s.habitMinutes}
            inputMode="numeric"
            onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && add()}
            className={cx(input, "w-20 font-mono")}
          />
          <button
            type="button"
            onClick={add}
            disabled={!name.trim()}
            className={btn.primary}
          >
            <Icon name="plus" size={13} />
            {s.habitAdd}
          </button>
        </div>
      </div>
      {doc.habits.length === 0 && (
        <p className="py-8 text-center text-aux text-fg-faint">
          {s.habitEmpty}
        </p>
      )}
      {doc.habits.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-ink-800 bg-ink-925">
          <div className="grid min-w-[640px] grid-cols-[minmax(140px,1fr)_auto_96px_88px] items-center gap-x-4 px-4">
            <span />
            <div className="flex gap-1 pb-1 pt-3">
              {span.map((d) => (
                <span
                  key={d}
                  className={cx(
                    "w-5 text-center font-mono text-tiny tabular-nums",
                    d === today ? "text-fg" : "text-fg-faint",
                  )}
                >
                  {parseDay(d).getDate()}
                </span>
              ))}
            </div>
            <span />
            <span />
            {doc.habits.map((h) => {
              const checked = h.days.includes(today);
              const streak = habitStreak(h, today);
              return (
                <div key={h.id} className="group contents">
                  <div className="flex min-w-0 items-center gap-2 border-t border-ink-850 py-3">
                    <Icon
                      name="repeat"
                      size={13}
                      className="shrink-0 text-fg-faint"
                    />
                    <span className="truncate text-body text-fg">{h.name}</span>
                    {h.minutes > 0 && (
                      <span className="shrink-0 font-mono text-meta text-fg-faint">
                        {h.minutes}m
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label="delete"
                      onClick={() =>
                        update((d) => ({
                          ...d,
                          habits: d.habits.filter((x) => x.id !== h.id),
                        }))
                      }
                      className="ml-auto text-fg-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-fg"
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  </div>
                  <div className="flex gap-1 border-t border-ink-850 py-3">
                    {span.map((d) => {
                      const on = h.days.includes(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          aria-pressed={on}
                          title={d}
                          onClick={() => toggle(h.id, d)}
                          className={cx(
                            "size-5 rounded-[3px] border transition-colors duration-100",
                            on
                              ? "border-transparent bg-ok"
                              : "border-(--ui-stroke-secondary) hover:border-(--ui-stroke-primary)",
                            d === today &&
                              !on &&
                              "border-(--ui-stroke-primary)",
                          )}
                        />
                      );
                    })}
                  </div>
                  <span
                    className={cx(
                      "border-t border-ink-850 py-3 text-meta",
                      streak > 0 ? "text-fg-muted" : "text-fg-faint",
                    )}
                  >
                    {s.habitStreak(streak)}
                  </span>
                  <div className="border-t border-ink-850 py-2.5">
                    <button
                      type="button"
                      onClick={() => toggle(h.id, today)}
                      className={cx(
                        checked ? btn.ghost : btn.outline,
                        "w-full justify-center",
                        checked && "text-ok",
                      )}
                    >
                      <Icon name="check" size={13} />
                      {checked ? s.habitChecked : s.habitCheck}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
