import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@shared/types";
import { cx } from "../../ui/atoms";
import { Icon } from "../../ui/icons";

/** One saved prompt. */
interface Prompt {
  id: string;
  title: string;
  body: string;
  /** Last insert/copy, for "recently used first". */
  usedAt: number;
}

const KEY = "cbw.prompts.v1";

function load(): Prompt[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v)
      ? v.filter(
          (p): p is Prompt =>
            !!p &&
            typeof (p as Prompt).id === "string" &&
            typeof (p as Prompt).body === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function save(list: Prompt[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // storage full or disabled: the list still works for this run
  }
}

// Account sync (fork feature, 2026-10-30): signed in to the hub account, the list is also the
// account's store key "prompts", shared with Jun-App. syncedAt = server version last merged here;
// dirty = a local edit the server hasn't taken yet.
const SYNC_KEY = "cbw.prompts.sync.v1";
interface SyncMeta {
  syncedAt: number;
  dirty: boolean;
}
function loadMeta(): SyncMeta {
  try {
    const raw = localStorage.getItem(SYNC_KEY);
    // Never synced: prompts saved before sign-in count as pending, so the first sync merges them.
    if (raw === null) return { syncedAt: 0, dirty: true };
    const v = JSON.parse(raw) as Partial<SyncMeta>;
    return { syncedAt: Number(v.syncedAt) || 0, dirty: v.dirty === true };
  } catch {
    return { syncedAt: 0, dirty: false };
  }
}
function saveMeta(meta: SyncMeta): void {
  try {
    localStorage.setItem(SYNC_KEY, JSON.stringify(meta));
  } catch {
    // storage disabled: the next open merges again
  }
}
function validPrompts(v: unknown): Prompt[] {
  return Array.isArray(v)
    ? v
        .filter(
          (p): p is Prompt =>
            !!p &&
            typeof (p as Prompt).id === "string" &&
            typeof (p as Prompt).body === "string",
        )
        .map((p) => ({ ...p, title: p.title ?? "", usedAt: p.usedAt ?? 0 }))
    : [];
}

const field =
  "w-full rounded-md border border-(--ui-stroke-tertiary) bg-well px-2 text-body text-fg outline-none placeholder:text-fg-dim focus:border-(--ui-stroke-primary)";
const smallBtn =
  "inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-aux text-fg-faint transition-colors duration-100 hover:bg-(--ui-control-hover-background) hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent";

/**
 * Right sidebar → Prompts (fork feature, 2026-10-28): a personal prompt library. "Insert" pastes the
 * prompt into the selected session's input (bracketed paste, so a multi-line prompt doesn't send);
 * the user reviews and presses Enter. Stored in this app's localStorage.
 */
export function PromptsPage({ session }: { session: Session }) {
  const [list, setList] = useState<Prompt[]>(load);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Prompt | null>(null);
  // Which prompt was just copied, for a ~1.2s check mark.
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const zh = navigator.language.startsWith("zh");
  const L = zh
    ? {
        search: "搜索提示词…",
        add: "新建",
        title: "标题",
        body: "提示词内容",
        save: "保存",
        cancel: "取消",
        insert: "插入",
        copy: "复制",
        copied: "已复制",
        del: "删除",
        empty:
          "还没有提示词。把常用的要求存下来，点「插入」就粘到当前会话的输入框里。",
        cantInsert: "这个会话没在本应用的终端里运行，只能复制",
      }
    : {
        search: "Search prompts…",
        add: "New",
        title: "Title",
        body: "Prompt",
        save: "Save",
        cancel: "Cancel",
        insert: "Insert",
        copy: "Copy",
        copied: "Copied",
        del: "Delete",
        empty:
          "No prompts yet. Save the ones you reuse; Insert pastes into this session's input.",
        cantInsert:
          "This session isn't running in the app's terminal; copy instead",
      };
  // Only a session this app spawned has a terminal to type into.
  const canInsert =
    session.management === "managed" && session.state !== "ended";

  const signedIn = useRef(false);
  const push = (next: Prompt[]) => {
    saveMeta({ ...loadMeta(), dirty: true });
    if (!signedIn.current) return;
    window.api.junAccountStorePut("prompts", next).then(
      (at) => saveMeta({ syncedAt: at, dirty: false }),
      () => undefined, // stays dirty; merged on the next open
    );
  };
  // On open: take the account's copy if it is newer, or merge a pending offline edit into it.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const status = await window.api.junAccountStatus();
      if (cancelled || !status.signedIn) return;
      signedIn.current = true;
      const remote = await window.api
        .junAccountStoreGet<Prompt[]>("prompts")
        .catch(() => null);
      if (cancelled || !remote) return;
      const meta = loadMeta();
      const local = load();
      if (meta.dirty) {
        const ids = new Set(local.map((p) => p.id));
        const merged = [
          ...local,
          ...validPrompts(remote.value).filter((p) => !ids.has(p.id)),
        ];
        setList(merged);
        save(merged);
        const at = await window.api
          .junAccountStorePut("prompts", merged)
          .catch(() => null);
        if (at !== null) saveMeta({ syncedAt: at, dirty: false });
      } else if (remote.updatedAt > meta.syncedAt) {
        const next = validPrompts(remote.value);
        setList(next);
        save(next);
        saveMeta({ syncedAt: remote.updatedAt, dirty: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const commit = (next: Prompt[]) => {
    setList(next);
    save(next);
    push(next);
  };
  const touch = (id: string) =>
    commit(list.map((p) => (p.id === id ? { ...p, usedAt: Date.now() } : p)));

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return list
      .filter(
        (p) =>
          !s ||
          p.title.toLowerCase().includes(s) ||
          p.body.toLowerCase().includes(s),
      )
      .sort((a, b) => b.usedAt - a.usedAt);
  }, [list, q]);

  return (
    <div className="flex flex-col gap-2 px-2.5 pb-3 pt-1">
      <div className="flex gap-1.5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={L.search}
          className={cx(field, "h-7")}
        />
        <button
          type="button"
          onClick={() =>
            setEditing({ id: "", title: "", body: "", usedAt: Date.now() })
          }
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-(--ui-stroke-tertiary) px-2 text-aux text-fg-muted hover:bg-(--ui-control-hover-background) hover:text-fg"
        >
          <Icon name="plus" size={12} />
          {L.add}
        </button>
      </div>

      {editing && (
        <div className="flex flex-col gap-1.5 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-quaternary) p-2">
          <input
            autoFocus
            value={editing.title}
            placeholder={L.title}
            onChange={(e) => setEditing({ ...editing, title: e.target.value })}
            className={cx(field, "h-7")}
          />
          <textarea
            value={editing.body}
            placeholder={L.body}
            rows={6}
            onChange={(e) => setEditing({ ...editing, body: e.target.value })}
            className={cx(field, "resize-y py-1.5 leading-relaxed")}
          />
          <div className="flex justify-end gap-1">
            <button
              type="button"
              onClick={() => setEditing(null)}
              className={smallBtn}
            >
              {L.cancel}
            </button>
            <button
              type="button"
              disabled={!editing.body.trim()}
              onClick={() => {
                const p = {
                  ...editing,
                  title:
                    editing.title.trim() ||
                    editing.body.trim().split("\n")[0].slice(0, 40),
                };
                commit(
                  editing.id
                    ? list.map((x) => (x.id === editing.id ? p : x))
                    : [
                        { ...p, id: Math.random().toString(36).slice(2) },
                        ...list,
                      ],
                );
                setEditing(null);
              }}
              className={cx(smallBtn, "text-fg")}
            >
              {L.save}
            </button>
          </div>
        </div>
      )}

      {list.length === 0 && !editing && (
        <p className="px-1 py-4 text-aux leading-relaxed text-fg-dim">
          {L.empty}
        </p>
      )}

      {shown.map((p) => (
        <div
          key={p.id}
          className="group rounded-md border border-(--ui-stroke-secondary) px-2 py-1.5 hover:border-(--ui-stroke-tertiary)"
        >
          <button
            type="button"
            onClick={() => setEditing(p)}
            className="block w-full text-left"
            title={p.body}
          >
            <p className="truncate text-body font-medium text-fg-muted group-hover:text-fg">
              {p.title}
            </p>
            <p className="line-clamp-2 text-aux leading-snug text-fg-dim">
              {p.body}
            </p>
          </button>
          <div className="mt-1 flex gap-0.5">
            <button
              type="button"
              disabled={!canInsert}
              title={canInsert ? undefined : L.cantInsert}
              onClick={() => {
                // Bracketed paste: the CLI takes the whole prompt as typed text, newlines and all,
                // and waits for Enter.
                window.api.terminal.write(
                  session.id,
                  `\x1b[200~${p.body}\x1b[201~`,
                );
                touch(p.id);
              }}
              className={smallBtn}
            >
              <Icon name="square-terminal" size={12} />
              {L.insert}
            </button>
            <button
              type="button"
              onClick={() => {
                void window.api.clipboardWriteText(p.body);
                setCopiedId(p.id);
                setTimeout(
                  () => setCopiedId((c) => (c === p.id ? null : c)),
                  1200,
                );
                touch(p.id);
              }}
              className={smallBtn}
            >
              <Icon name={copiedId === p.id ? "check" : "copy"} size={12} />
              {copiedId === p.id ? L.copied : L.copy}
            </button>
            <button
              type="button"
              onClick={() => commit(list.filter((x) => x.id !== p.id))}
              className={cx(
                smallBtn,
                "ml-auto opacity-0 group-hover:opacity-100",
              )}
            >
              <Icon name="trash" size={12} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
