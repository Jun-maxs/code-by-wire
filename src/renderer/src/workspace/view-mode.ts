import { atom } from "nanostores";
import type { Session } from "@shared/types";

export type SessionViewMode = "cli" | "work";

export interface WorkDraft {
  text: string;
  attachments: string[];
}

export interface WorkScrollSnapshot {
  scrollTop: number;
  pinned: boolean;
}

const EMPTY_DRAFT: WorkDraft = { text: "", attachments: [] };

/** Explicit per-session CLI/Work choice made by the user. */
export const $viewModes = atom<Record<string, SessionViewMode>>({});

/** Per-session unsent composer draft + file/image attachments, preserved across CLI ⇄ Work & tab switches. */
export const $workDrafts = atom<Record<string, WorkDraft>>({});

/** Per-turn spine expansion state (`${sessionId}:${turnKey}` → boolean). */
export const $expandedSpines = atom<Record<string, boolean>>({});

/** Per-session scroll anchor in Work view, preserved across CLI ⇄ Work switches and Split/Single transitions. */
export const workScrollSnapshots = new Map<string, WorkScrollSnapshot>();

export function resolveSessionViewMode(
  session: Pick<Session, "id" | "management" | "state">,
  modes: Record<string, SessionViewMode>,
  hasTranscript: boolean,
): SessionViewMode {
  if (!hasTranscript) return "cli";
  const explicit = modes[session.id];
  if (explicit) return explicit;
  const hasLiveTerminal =
    session.management === "managed" && session.state !== "ended";
  return hasLiveTerminal ? "cli" : "work";
}

export function setSessionViewMode(id: string, mode: SessionViewMode): void {
  const cur = $viewModes.get();
  if (cur[id] === mode) return;
  $viewModes.set({ ...cur, [id]: mode });
}

export function toggleSessionViewMode(
  session: Pick<Session, "id" | "management" | "state">,
  hasTranscript: boolean,
): SessionViewMode {
  if (!hasTranscript) return "cli";
  const current = resolveSessionViewMode(
    session,
    $viewModes.get(),
    hasTranscript,
  );
  const next: SessionViewMode = current === "work" ? "cli" : "work";
  setSessionViewMode(session.id, next);
  return next;
}

export function getWorkDraft(
  drafts: Record<string, WorkDraft>,
  id: string,
): WorkDraft {
  return drafts[id] ?? EMPTY_DRAFT;
}

export function setWorkDraft(id: string, next: Partial<WorkDraft>): void {
  const cur = $workDrafts.get();
  const prev = cur[id] ?? EMPTY_DRAFT;
  const merged: WorkDraft = {
    text: next.text ?? prev.text,
    attachments: next.attachments ?? prev.attachments,
  };
  if (merged.text === "" && merged.attachments.length === 0) {
    if (!(id in cur)) return;
    const copy = { ...cur };
    delete copy[id];
    $workDrafts.set(copy);
    return;
  }
  $workDrafts.set({ ...cur, [id]: merged });
}

export function clearWorkDraft(id: string): void {
  const cur = $workDrafts.get();
  if (!(id in cur)) return;
  const copy = { ...cur };
  delete copy[id];
  $workDrafts.set(copy);
}

export function spineKey(sessionId: string, turnIndex: number): string {
  return `${sessionId}:${turnIndex}`;
}

export function toggleSpineExpanded(
  sessionId: string,
  turnIndex: number,
): void {
  const key = spineKey(sessionId, turnIndex);
  const cur = $expandedSpines.get();
  $expandedSpines.set({ ...cur, [key]: !cur[key] });
}

export function renameWorkViewState(from: string, to: string): void {
  if (from === to) return;
  const modes = $viewModes.get();
  if (from in modes && !(to in modes)) {
    const next = { ...modes, [to]: modes[from] };
    delete next[from];
    $viewModes.set(next);
  }
  const drafts = $workDrafts.get();
  if (from in drafts && !(to in drafts)) {
    const next = { ...drafts, [to]: drafts[from] };
    delete next[from];
    $workDrafts.set(next);
  }
  const scroll = workScrollSnapshots.get(from);
  if (scroll && !workScrollSnapshots.has(to)) {
    workScrollSnapshots.set(to, scroll);
    workScrollSnapshots.delete(from);
  }
}

export function viewToggleShortcutLabel(isMac: boolean): string {
  return isMac ? "⌘⇧E" : "Ctrl+Shift+E";
}

export function isViewToggleKey(
  e: {
    code?: string;
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
  },
  isMac: boolean,
): boolean {
  const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod || !e.shiftKey || e.altKey) return false;
  return e.code === "KeyE" || e.key === "E" || e.key === "e";
}
