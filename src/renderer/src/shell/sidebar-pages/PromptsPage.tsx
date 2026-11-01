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
  /** Shared to the account's 共享池 (fork, 2026-11-01): edits and deletes follow it there. */
  shared?: boolean;
}

/** One prompt in the 共享池, as the account server lists it. */
interface SharedPrompt {
  id: string;
  pid: string;
  title: string;
  body: string;
  author: string;
  updatedAt: number;
  copies: number;
  mine: boolean;
}

/** Text that looks like a key, a password or a local path: worth a second look before sharing. */
export function looksPrivate(text: string): boolean {
  return /(sk-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{10,}|AKIA[0-9A-Z]{12,}|password|passwd|密码|token\s*[:=：]|[A-Za-z]:\\Users\\|\/home\/[a-z])/i.test(
    text,
  );
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
        pool: "共享池",
        back: "我的提示词",
        share: "共享",
        shared: "已共享",
        unshareHint: "已共享到共享池，点一下取消共享",
        shareHint: "共享到共享池，登录的用户都能看到和复制",
        privateWarn: "这条里像是有密钥、密码或本机路径，共享后别人都能看到。",
        shareAnyway: "仍然共享",
        copyToMine: "复制到我的",
        inMine: "已在我的",
        mine: "我的",
        copies: (n: number) => `${n} 次复制`,
        poolEmpty:
          "共享池里还没有提示词。在「我的提示词」里点「共享」就会出现在这里。",
        poolLoading: "正在读取共享池…",
        poolFailed: "读取共享池失败，稍后再试。",
        signInForPool: "登录 hub 账号后可以共享提示词、查看共享池。",
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
        pool: "Shared pool",
        back: "My prompts",
        share: "Share",
        shared: "Shared",
        unshareHint: "In the shared pool; click to stop sharing",
        shareHint:
          "Share to the pool, where every signed-in user can see and copy it",
        privateWarn:
          "This looks like it holds a key, a password or a local path; everyone would see it.",
        shareAnyway: "Share anyway",
        copyToMine: "Copy to mine",
        inMine: "In mine",
        mine: "Mine",
        copies: (n: number) => `${n} copies`,
        poolEmpty:
          "Nothing shared yet. Share one of yours and it shows up here.",
        poolLoading: "Reading the shared pool…",
        poolFailed: "Couldn't read the shared pool; try again later.",
        signInForPool:
          "Sign in to the hub account to share prompts and see the pool.",
      };
  // Only a session this app spawned has a terminal to type into.
  const canInsert =
    session.management === "managed" && session.state !== "ended";

  const signedIn = useRef(false);
  const [account, setAccount] = useState(false);
  const [view, setView] = useState<"mine" | "pool">("mine");
  const [pool, setPool] = useState<SharedPrompt[] | null>(null);
  const [poolError, setPoolError] = useState(false);
  // The prompt whose share waits on the private-text warning.
  const [confirmShare, setConfirmShare] = useState<string | null>(null);
  const [copiedFromPool, setCopiedFromPool] = useState<ReadonlySet<string>>(
    new Set(),
  );
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
      setAccount(true);
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

  // 共享池 (fork, 2026-11-01). A share is a copy on the server; editing or deleting the prompt here
  // updates or withdraws it.
  const putShared = (p: Prompt) =>
    window.api
      .junAccountShared("put", { pid: p.id, title: p.title, body: p.body })
      .catch(() => undefined);
  const setShared = (p: Prompt, on: boolean) => {
    setConfirmShare(null);
    commit(list.map((x) => (x.id === p.id ? { ...x, shared: on } : x)));
    if (on) void putShared(p);
    else
      void window.api
        .junAccountShared("delete", { pid: p.id })
        .catch(() => undefined);
  };
  const loadPool = () => {
    setPool(null);
    setPoolError(false);
    window.api.junAccountShared("list").then(
      (r) =>
        setPool(((r as { prompts?: SharedPrompt[] }).prompts ?? []).slice()),
      () => setPoolError(true),
    );
  };
  const copyFromPool = (sp: SharedPrompt) => {
    commit([
      {
        id: Math.random().toString(36).slice(2),
        title: sp.title,
        body: sp.body,
        usedAt: Date.now(),
      },
      ...list,
    ]);
    setCopiedFromPool((prev) => new Set(prev).add(sp.id));
    void window.api
      .junAccountShared("copied", { id: sp.id })
      .catch(() => undefined);
  };
  const shownPool = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (pool ?? []).filter(
      (p) =>
        !s ||
        p.title.toLowerCase().includes(s) ||
        p.body.toLowerCase().includes(s) ||
        p.author.toLowerCase().includes(s),
    );
  }, [pool, q]);

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
          onClick={() => {
            // A new prompt is written in "mine"; the pool view has no editor.
            setView("mine");
            setEditing({ id: "", title: "", body: "", usedAt: Date.now() });
          }}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-(--ui-stroke-tertiary) px-2 text-aux text-fg-muted hover:bg-(--ui-control-hover-background) hover:text-fg"
        >
          <Icon name="plus" size={12} />
          {L.add}
        </button>
        {account && (
          <button
            type="button"
            aria-pressed={view === "pool"}
            onClick={() => {
              if (view === "pool") return setView("mine");
              setView("pool");
              loadPool();
            }}
            className={cx(
              "inline-flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-aux hover:bg-(--ui-control-hover-background) hover:text-fg",
              view === "pool"
                ? "border-(--ui-stroke-primary) text-fg"
                : "border-(--ui-stroke-tertiary) text-fg-muted",
            )}
          >
            <Icon name="users" size={12} />
            {view === "pool" ? L.back : L.pool}
          </button>
        )}
      </div>

      {view === "pool" && (
        <div className="flex flex-col gap-2">
          {pool === null && !poolError && (
            <p className="px-1 py-3 text-aux text-fg-dim">{L.poolLoading}</p>
          )}
          {poolError && (
            <p className="px-1 py-3 text-aux text-danger">{L.poolFailed}</p>
          )}
          {pool?.length === 0 && (
            <p className="px-1 py-4 text-aux leading-relaxed text-fg-dim">
              {L.poolEmpty}
            </p>
          )}
          {shownPool.map((sp) => {
            const have =
              sp.mine ||
              copiedFromPool.has(sp.id) ||
              list.some((p) => p.body === sp.body);
            return (
              <div
                key={sp.id}
                className="rounded-md border border-(--ui-stroke-secondary) px-2 py-1.5"
              >
                <p className="truncate text-body font-medium text-fg-muted">
                  {sp.title}
                </p>
                <p className="mt-0.5 truncate text-meta text-fg-dim">
                  {sp.mine ? L.mine : sp.author}
                  {sp.copies > 0 ? ` · ${L.copies(sp.copies)}` : ""}
                </p>
                <p
                  className="mt-1 line-clamp-3 text-aux leading-snug text-fg-dim"
                  title={sp.body}
                >
                  {sp.body}
                </p>
                <div className="mt-1 flex">
                  <button
                    type="button"
                    disabled={have}
                    onClick={() => copyFromPool(sp)}
                    className={smallBtn}
                  >
                    <Icon name={have ? "check" : "plus"} size={12} />
                    {have ? L.inMine : L.copyToMine}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view === "mine" && editing && (
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
                // A shared prompt's pool copy follows the edit.
                if (p.shared && editing.id) void putShared(p);
                setEditing(null);
              }}
              className={cx(smallBtn, "text-fg")}
            >
              {L.save}
            </button>
          </div>
        </div>
      )}

      {view === "mine" && list.length === 0 && !editing && (
        <p className="px-1 py-4 text-aux leading-relaxed text-fg-dim">
          {L.empty}
        </p>
      )}

      {view === "mine" &&
        shown.map((p) => (
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
              {account && (
                <button
                  type="button"
                  aria-pressed={!!p.shared}
                  title={p.shared ? L.unshareHint : L.shareHint}
                  onClick={() => {
                    if (p.shared) return setShared(p, false);
                    if (looksPrivate(`${p.title}\n${p.body}`))
                      return setConfirmShare(p.id);
                    setShared(p, true);
                  }}
                  className={cx(smallBtn, p.shared && "text-fg")}
                >
                  <Icon name={p.shared ? "check" : "users"} size={12} />
                  {p.shared ? L.shared : L.share}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (p.shared)
                    void window.api
                      .junAccountShared("delete", { pid: p.id })
                      .catch(() => undefined);
                  commit(list.filter((x) => x.id !== p.id));
                }}
                className={cx(
                  smallBtn,
                  "ml-auto opacity-0 group-hover:opacity-100",
                )}
              >
                <Icon name="trash" size={12} />
              </button>
            </div>
            {confirmShare === p.id && (
              <div className="mt-1.5 rounded-sm border border-danger/40 px-2 py-1.5 text-aux leading-snug text-fg-muted">
                {L.privateWarn}
                <div className="mt-1 flex justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => setConfirmShare(null)}
                    className={smallBtn}
                  >
                    {L.cancel}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShared(p, true)}
                    className={cx(smallBtn, "text-danger!")}
                  >
                    {L.shareAnyway}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
    </div>
  );
}
