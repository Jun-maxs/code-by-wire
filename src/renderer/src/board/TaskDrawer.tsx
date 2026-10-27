import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  PRIORITIES,
  TASK_STATUSES,
  newId,
  type BoardTask,
} from "@shared/board";
import type { Session } from "@shared/types";
import { Lamp, cx } from "../ui/atoms";
import { Icon } from "../ui/icons";
import { useBoardCtx } from "./context";
import { Dot, PRIORITY_DOT, STATUS_BG, btn, input } from "./parts";

/** The task's detail, a right-side sheet over the board. Every field saves as you type. */
export function TaskDrawer({
  taskId,
  onClose,
}: {
  taskId: string;
  onClose: () => void;
}) {
  const ctx = useBoardCtx();
  const { doc, s, update, topics } = ctx;
  const task = doc.tasks.find((t) => t.id === taskId);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!task) return null;
  const set = (patch: Partial<BoardTask>) =>
    update((d) => ({
      ...d,
      tasks: d.tasks.map((t) =>
        t.id === task.id
          ? {
              ...t,
              ...patch,
              doneAt:
                patch.status === undefined
                  ? t.doneAt
                  : patch.status === "done"
                    ? (t.doneAt ?? Date.now())
                    : null,
            }
          : t,
      ),
    }));

  return (
    <Sheet onClose={onClose} label={task.title || s.untitled}>
      <div className="flex items-center gap-2 border-b border-ink-850 px-4 py-3">
        <input
          value={task.title}
          placeholder={s.untitled}
          autoFocus={!task.title}
          onChange={(e) => set({ title: e.target.value })}
          aria-label={s.fTitle}
          className="min-w-0 flex-1 bg-transparent text-title font-semibold text-fg outline-none placeholder:text-fg-faint"
        />
        <button
          type="button"
          onClick={onClose}
          className={btn.ghost}
          aria-label="close"
        >
          <Icon name="x" size={15} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        <Field label={s.fStatus}>
          <div className="flex flex-wrap gap-1">
            {TASK_STATUSES.map((st) => (
              <button
                key={st}
                type="button"
                aria-pressed={task.status === st}
                onClick={() => set({ status: st })}
                className={cx(
                  "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-aux transition-colors duration-100",
                  task.status === st
                    ? "border-(--ui-stroke-primary) bg-(--ui-control-active-background) text-fg"
                    : "border-(--ui-stroke-tertiary) text-fg-faint hover:text-fg",
                )}
              >
                <Dot className={STATUS_BG[st]} />
                {s.status[st]}
              </button>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={s.fPriority}>
            <div className="flex gap-1">
              {PRIORITIES.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={task.priority === p}
                  onClick={() => set({ priority: p })}
                  className={cx(
                    "inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md border text-aux transition-colors duration-100",
                    task.priority === p
                      ? "border-(--ui-stroke-primary) bg-(--ui-control-active-background) text-fg"
                      : "border-(--ui-stroke-tertiary) text-fg-faint hover:text-fg",
                  )}
                >
                  <Dot className={PRIORITY_DOT[p]} />
                  {p}
                </button>
              ))}
            </div>
          </Field>
          <Field label={s.fTopic}>
            <select
              value={task.topic ?? ""}
              onChange={(e) => set({ topic: e.target.value || null })}
              className={input}
            >
              <option value="">{s.fNoTopic}</option>
              {Object.values(topics).map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={s.fEstimate}>
            <input
              type="number"
              min={0}
              step={0.5}
              value={task.estimateH || ""}
              onChange={(e) =>
                set({ estimateH: Math.max(0, Number(e.target.value) || 0) })
              }
              className={cx(input, "font-mono tabular-nums")}
            />
          </Field>
          <Field label={s.fDue}>
            <input
              type="date"
              value={task.due ?? ""}
              onChange={(e) => set({ due: e.target.value || null })}
              className={cx(input, "font-mono tabular-nums")}
            />
          </Field>
          <Field label={s.fPlanned}>
            <input
              type="date"
              value={task.plannedDate ?? ""}
              onChange={(e) => set({ plannedDate: e.target.value || null })}
              className={cx(input, "font-mono tabular-nums")}
            />
          </Field>
          <Field label={s.fTags}>
            <TagsInput tags={task.tags} onChange={(tags) => set({ tags })} />
          </Field>
        </div>

        <Field label={s.fSubtasks}>
          <Subtasks task={task} set={set} />
        </Field>

        <Field label={s.fSessions}>
          <Sessions task={task} set={set} />
        </Field>

        <Field label={s.fNotes}>
          <textarea
            value={task.notes}
            onChange={(e) => set({ notes: e.target.value })}
            rows={4}
            className={cx(input, "h-auto resize-y py-1.5 leading-relaxed")}
          />
        </Field>
      </div>

      <div className="flex items-center justify-between border-t border-ink-850 px-4 py-2.5">
        <button
          type="button"
          onClick={() => {
            if (!confirmDelete) return setConfirmDelete(true);
            update((d) => ({
              ...d,
              tasks: d.tasks.filter((t) => t.id !== task.id),
              ideas: d.ideas.map((i) =>
                i.taskId === task.id ? { ...i, taskId: null } : i,
              ),
            }));
            onClose();
          }}
          onBlur={() => setConfirmDelete(false)}
          className={cx(
            btn.ghost,
            confirmDelete ? "text-danger" : "text-fg-faint",
          )}
        >
          <Icon name="trash" size={13} />
          {confirmDelete ? s.fDeleteConfirm : s.fDelete}
        </button>
      </div>
    </Sheet>
  );
}

/** A right-hand sheet with a dimmed backdrop; Escape and backdrop clicks close it. */
export function Sheet({
  children,
  onClose,
  label,
  width = 440,
}: {
  children: ReactNode;
  onClose: () => void;
  label: string;
  width?: number;
}) {
  return (
    <div className="absolute inset-0 z-30 flex justify-end">
      <div
        className="absolute inset-0 bg-black/30 animate-[fade-in_120ms_ease-out]"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-label={label}
        style={{ width }}
        className="relative flex h-full max-w-full flex-col border-l border-ink-800 bg-ink-925 shadow-2xl animate-[sheet-in_160ms_cubic-bezier(0.2,0.8,0.2,1)]"
      >
        {children}
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-meta font-medium text-fg-faint">{label}</span>
      {children}
    </label>
  );
}

function TagsInput({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (t: string[]) => void;
}) {
  const [text, setText] = useState(tags.join(", "));
  return (
    <input
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(
          e.target.value
            .split(/[,，]/)
            .map((x) => x.trim())
            .filter(Boolean),
        );
      }}
      className={input}
    />
  );
}

function Subtasks({
  task,
  set,
}: {
  task: BoardTask;
  set: (p: Partial<BoardTask>) => void;
}) {
  const { s } = useBoardCtx();
  const [text, setText] = useState("");
  return (
    <div className="flex flex-col gap-1">
      {task.subtasks.map((st) => (
        <div key={st.id} className="group flex items-center gap-2">
          <input
            type="checkbox"
            checked={st.done}
            onChange={() =>
              set({
                subtasks: task.subtasks.map((x) =>
                  x.id === st.id ? { ...x, done: !x.done } : x,
                ),
              })
            }
            className="size-3.5 accent-(--color-ok)"
          />
          <input
            value={st.text}
            onChange={(e) =>
              set({
                subtasks: task.subtasks.map((x) =>
                  x.id === st.id ? { ...x, text: e.target.value } : x,
                ),
              })
            }
            className={cx(
              "min-w-0 flex-1 bg-transparent py-0.5 text-body outline-none",
              st.done ? "text-fg-faint line-through" : "text-fg",
            )}
          />
          <button
            type="button"
            aria-label="remove"
            onClick={() =>
              set({ subtasks: task.subtasks.filter((x) => x.id !== st.id) })
            }
            className="text-fg-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-fg"
          >
            <Icon name="x" size={12} />
          </button>
        </div>
      ))}
      <input
        value={text}
        placeholder={s.fSubtaskAdd}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.nativeEvent.isComposing || !text.trim())
            return;
          e.preventDefault();
          set({
            subtasks: [
              ...task.subtasks,
              { id: newId(), text: text.trim(), done: false },
            ],
          });
          setText("");
        }}
        className={input}
      />
    </div>
  );
}

function Sessions({
  task,
  set,
}: {
  task: BoardTask;
  set: (p: Partial<BoardTask>) => void;
}) {
  const ctx = useBoardCtx();
  const {
    s,
    sessions,
    sessionsById,
    sessionTopic,
    sessionTitle,
    openSession,
    newSessionFor,
    doc,
  } = ctx;
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState("");
  const [spawning, setSpawning] = useState(false);
  const linked = task.sessionIds
    .map((id) => sessionsById.get(id))
    .filter((x): x is Session => !!x);
  // Sessions already on some task are offered last; same-topic ones first.
  const onTask = useMemo(
    () => new Set(doc.tasks.flatMap((t) => t.sessionIds)),
    [doc.tasks],
  );
  const candidates = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return sessions
      .filter((x) => !task.sessionIds.includes(x.id) && !x.parentSessionId)
      .filter((x) => !ql || sessionTitle(x).toLowerCase().includes(ql))
      .map((x) => ({
        x,
        rank:
          (task.topic && sessionTopic(x) === task.topic ? 0 : 2) +
          (onTask.has(x.id) ? 1 : 0),
      }))
      .sort(
        (a, b) => a.rank - b.rank || b.x.lastActivityMs - a.x.lastActivityMs,
      )
      .slice(0, 12);
  }, [sessions, task, q, onTask, sessionTopic, sessionTitle]);

  return (
    <div className="flex flex-col gap-1.5">
      {linked.length === 0 && (
        <p className="text-aux text-fg-faint">{s.fSessionsEmpty}</p>
      )}
      {linked.map((x) => (
        <div
          key={x.id}
          className="group flex h-8 items-center gap-2 rounded-md border border-(--ui-stroke-secondary) bg-ink-950 px-2"
        >
          <Lamp state={x.state} management={x.management} />
          <button
            type="button"
            onClick={() => openSession(x.id)}
            className="min-w-0 flex-1 truncate text-left text-body text-fg hover:underline"
            title={s.fOpen}
          >
            {sessionTitle(x)}
          </button>
          <button
            type="button"
            onClick={() =>
              set({ sessionIds: task.sessionIds.filter((id) => id !== x.id) })
            }
            className="text-meta text-fg-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-fg"
          >
            {s.fUnlink}
          </button>
        </div>
      ))}
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => setPicking((v) => !v)}
          aria-expanded={picking}
          className={btn.outline}
        >
          <Icon name="link" size={13} />
          {s.fLink}
        </button>
        <button
          type="button"
          disabled={spawning}
          onClick={() => {
            setSpawning(true);
            void newSessionFor(task).finally(() => setSpawning(false));
          }}
          className={btn.outline}
        >
          <Icon
            name={spawning ? "loader-circle" : "rocket"}
            size={13}
            className={spawning ? "animate-spin" : ""}
          />
          {s.fNewSession}
        </button>
      </div>
      {picking && (
        <div className="flex flex-col gap-1 rounded-md border border-(--ui-stroke-secondary) bg-ink-950 p-1.5">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={s.search}
            className={input}
          />
          <div className="flex max-h-56 flex-col overflow-y-auto">
            {candidates.map(({ x }) => {
              const topic = sessionTopic(x);
              return (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => {
                    set({ sessionIds: [...task.sessionIds, x.id] });
                    setQ("");
                  }}
                  className="flex h-7 shrink-0 items-center gap-2 rounded-sm px-1.5 text-left text-aux text-fg-muted hover:bg-(--ui-row-hover-background) hover:text-fg"
                >
                  <Lamp state={x.state} management={x.management} />
                  <span className="min-w-0 flex-1 truncate">
                    {sessionTitle(x)}
                  </span>
                  {topic && ctx.topics[topic] && (
                    <span
                      aria-hidden
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ background: ctx.topics[topic].color }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
