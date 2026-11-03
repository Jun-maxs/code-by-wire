import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Session } from "@shared/types";
import { formatAgeShort } from "@shared/format";
import { Lamp } from "../ui/atoms";
import { Icon } from "../ui/icons";
import { useI18n } from "../i18n";
import { MAX_SPLIT, sessionDisplayTitle, type ViewMode } from "./split-view";
import { ViewSegment } from "./MiddleHeader";

/** The pick-a-session list, shared by the header's add popover and an empty grid cell. */
export function SplitCandidates({
  sessions,
  onPick,
  onNew,
  newLabel,
}: {
  sessions: Session[];
  onPick: (id: string) => void;
  /** Start a new session into the grid (listed first). */
  onNew?: () => void;
  newLabel?: string;
}) {
  const { t } = useI18n();
  const now = Date.now();
  const newRow = onNew && (
    <button
      type="button"
      onClick={onNew}
      className="flex h-7 w-full items-center gap-2 rounded-xs px-2 text-left text-body text-fg-muted transition-colors duration-100 hover:bg-(--ui-control-hover-background) hover:text-fg hover:transition-none"
    >
      <span className="grid size-3.5 shrink-0 place-items-center">
        <Icon name="plus" size={13} />
      </span>
      <span className="min-w-0 flex-1 truncate">{newLabel}</span>
    </button>
  );
  if (sessions.length === 0)
    return (
      <>
        {newRow}
        <p className="px-2 py-1.5 text-aux text-fg-dim">
          {t.shell.split.noCandidates}
        </p>
      </>
    );
  return (
    <ul role="list" className="flex flex-col">
      {newRow && (
        <li className="mb-1 border-b border-(--ui-stroke-tertiary) pb-1">
          {newRow}
        </li>
      )}
      {sessions.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            onClick={() => onPick(s.id)}
            title={s.title}
            className="flex h-7 w-full items-center gap-2 rounded-xs px-2 text-left text-body text-fg-muted transition-colors duration-100 hover:bg-(--ui-control-hover-background) hover:text-fg hover:transition-none"
          >
            <span className="grid size-3.5 shrink-0 place-items-center">
              <Lamp state={s.state} management={s.management} />
            </span>
            <span className="min-w-0 flex-1 truncate">
              {sessionDisplayTitle(s, t)}
            </span>
            <span className="shrink-0 font-mono text-meta tabular-nums text-fg-faint">
              {formatAgeShort(s.lastActivityMs, now)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Fork (2026-11-02): the header's left-edge layout switch — Single ⇄ Split — plus, while split, the
 * add-a-pane button. Same segmented look as the right-edge Claude Code ⇄ Transcript switch.
 */
export function ViewModeSwitch({
  mode,
  count,
  candidates,
  onSingle,
  onSplit,
  onAdd,
  onNewSession,
  newSessionLabel,
  activeTitle,
}: {
  mode: ViewMode;
  /** Panes in the grid while split. */
  count: number;
  /** What the add popover offers (already filtered and ordered). */
  candidates: Session[];
  onSingle: () => void;
  onSplit: () => void;
  onAdd: (id: string) => void;
  onNewSession: () => void;
  newSessionLabel: string;
  /** The focused pane's title — the one a pick replaces once the grid is full. */
  activeTitle: string;
}) {
  const { t } = useI18n();
  const split = mode === "split";
  return (
    <div className="no-drag flex shrink-0 items-center gap-1">
      <div
        role="group"
        aria-label={t.shell.split.layoutLabel}
        className="flex shrink-0 items-center rounded-sm border border-(--ui-stroke-tertiary) bg-[color-mix(in_srgb,var(--color-fg)_5%,transparent)] p-[2px]"
      >
        <ViewSegment
          icon={<Icon name="app-window" size={13} />}
          label={t.shell.split.single}
          title={t.shell.split.singleHint}
          active={!split}
          onSelect={() => {
            if (split) onSingle();
          }}
        />
        <ViewSegment
          icon={<Icon name="layout-grid" size={13} />}
          label={
            split ? `${t.shell.split.split} ${count}` : t.shell.split.split
          }
          title={t.shell.split.splitHint}
          active={split}
          onSelect={() => {
            if (!split) onSplit();
          }}
        />
      </div>
      {split && (
        <AddPaneButton
          full={count >= MAX_SPLIT}
          candidates={candidates}
          onAdd={onAdd}
          onNewSession={onNewSession}
          newSessionLabel={newSessionLabel}
          activeTitle={activeTitle}
        />
      )}
    </div>
  );
}

/** "+" with a popover of sessions to add. Portaled to <body>: the header clips what overflows it. */
function AddPaneButton({
  full,
  candidates,
  onAdd,
  onNewSession,
  newSessionLabel,
  activeTitle,
}: {
  full: boolean;
  candidates: Session[];
  onAdd: (id: string) => void;
  onNewSession: () => void;
  newSessionLabel: string;
  activeTitle: string;
}) {
  const { t } = useI18n();
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!at) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!pop.current?.contains(target) && !button.current?.contains(target))
        setAt(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAt(null);
    };
    const away = () => setAt(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", away);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", away);
    };
  }, [at]);
  const toggle = () => {
    if (at) return setAt(null);
    const r = button.current?.getBoundingClientRect();
    if (r) setAt({ top: r.bottom + 4, left: r.left });
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-expanded={at !== null}
        aria-label={t.shell.split.add}
        title={full ? t.shell.split.full : t.shell.split.add}
        onClick={toggle}
        className="grid size-6 place-items-center rounded-sm text-fg-faint transition-colors duration-100 hover:bg-(--ui-control-hover-background) hover:text-fg"
      >
        <Icon name="plus" size={14} />
      </button>
      {at &&
        createPortal(
          <div
            ref={pop}
            style={{ top: at.top, left: at.left }}
            className="fixed z-50 max-h-[min(26rem,calc(100vh-6rem))] w-80 max-w-[calc(100vw-16px)] overflow-y-auto rounded-md border border-ink-800 bg-ink-900 p-1 shadow-(--shadow-md)"
          >
            <p className="px-2 pb-1 pt-1 text-aux text-fg-faint">
              {full
                ? activeTitle
                  ? t.shell.split.fullReplace(activeTitle)
                  : t.shell.split.full
                : t.shell.split.addTitle}
            </p>
            <SplitCandidates
              sessions={candidates}
              onPick={(id) => {
                setAt(null);
                onAdd(id);
              }}
              onNew={() => {
                setAt(null);
                onNewSession();
              }}
              newLabel={newSessionLabel}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
