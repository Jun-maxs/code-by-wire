import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ClaudeAccountsView, ClaudeOrg } from "@shared/ipc";
import { Card } from "../shell/page-primitives";
import { Icon } from "../ui/icons";
import { cx } from "../ui/atoms";
import { useI18n } from "../i18n";

/** reclaude's bindings and the switch/bind/add/remove actions, shared by the Settings card and the
 *  Pressure panel's popover. Reads the list when mounted; every action answers with the new list.
 *  `busy` is the org being acted on, or "add" while a new account is being signed in to. */
function useClaudeAccounts() {
  const { t } = useI18n();
  const a = t.settings.accounts;
  const [view, setView] = useState<ClaudeAccountsView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    void window.api.listClaudeAccounts().then(setView);
  }, []);
  const act = async (
    key: string,
    call: () => Promise<ClaudeAccountsView>,
    pending: string | null,
    done: string,
  ) => {
    setBusy(key);
    setNotice(pending);
    const next = await call();
    setBusy(null);
    setView(next);
    setNotice(next.error ? null : done);
  };
  const label = (org: ClaudeOrg) => org.email || org.name;
  const use = (org: ClaudeOrg) =>
    act(
      org.id,
      () => window.api.useClaudeAccount(org.id),
      null,
      a.switched(label(org)),
    );
  const bind = (org: ClaudeOrg) =>
    act(org.id, () => window.api.bindClaudeAccount(org.id), a.binding, a.added);
  const add = () =>
    act("add", () => window.api.addClaudeAccount(), a.binding, a.added);
  const remove = (org: ClaudeOrg) =>
    act(
      org.id,
      () => window.api.removeClaudeAccount(org.id),
      null,
      a.removed(label(org)),
    );
  return { view, busy, notice, use, bind, add, remove };
}

function AccountList({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const a = t.settings.accounts;
  const { view, busy, notice, use, bind, add, remove } = useClaudeAccounts();
  // The row whose removal waits for a second click.
  const [confirming, setConfirming] = useState<string | null>(null);
  if (!view)
    return <div className="px-4 py-3 text-meta text-fg-faint">{a.loading}</div>;
  if (view.orgs === null)
    return <div className="px-4 py-3 text-meta text-fg-faint">{a.none}</div>;
  return (
    <div className={cx("flex flex-col", compact ? "gap-0.5 p-1.5" : "")}>
      {view.orgs.length === 0 && !view.error && (
        <div className="px-4 py-3 text-meta text-fg-faint">{a.empty}</div>
      )}
      {view.orgs.map((org) => (
        <div
          key={org.id}
          className={cx(
            "flex items-center justify-between gap-3",
            compact ? "rounded-md px-2 py-1.5" : "px-4 py-3",
            org.current && compact && "bg-(--ui-row-active-background)",
          )}
        >
          <div className="min-w-0">
            <div className="truncate text-body text-fg">
              {org.email || org.name}
            </div>
            <div className="truncate text-meta text-fg-faint">
              {[org.name, org.kind, `#${org.id}`].filter(Boolean).join(" · ")}
            </div>
          </div>
          {org.current ? (
            <span className="flex shrink-0 items-center gap-1 text-meta text-primary">
              <Icon name="check" size={12} />
              {a.current}
            </span>
          ) : confirming === org.id ? (
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setConfirming(null);
                  void remove(org);
                }}
                className="rounded-md border border-danger px-2.5 py-1 text-meta text-danger hover:bg-ink-800"
              >
                {a.removeConfirm}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="rounded-md px-2 py-1 text-meta text-fg-faint hover:bg-ink-800"
              >
                {a.cancel}
              </button>
            </div>
          ) : (
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void (org.bound ? use(org) : bind(org))}
                className="rounded-md border border-ink-700 px-2.5 py-1 text-meta text-fg hover:bg-ink-800 disabled:opacity-50"
              >
                {busy === org.id ? "…" : org.bound ? a.use : a.bind}
              </button>
              {org.bound && (
                <button
                  type="button"
                  disabled={busy !== null}
                  title={a.remove}
                  aria-label={a.remove}
                  onClick={() => setConfirming(org.id)}
                  className="rounded-md p-1 text-fg-faint hover:bg-ink-800 hover:text-danger disabled:opacity-50"
                >
                  <Icon name="trash" size={12} />
                </button>
              )}
            </div>
          )}
        </div>
      ))}
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => void add()}
        className={cx(
          "flex items-center gap-1.5 text-left text-meta text-fg-muted hover:bg-ink-800 hover:text-fg disabled:opacity-50",
          compact
            ? "rounded-md px-2 py-1.5"
            : "border-t border-ink-800 px-4 py-3",
        )}
      >
        <Icon name="plus" size={12} />
        {busy === "add" ? a.adding : a.add}
      </button>
      {view.error && (
        <div className="px-4 py-2 text-meta text-danger">
          {a.failed(view.error)}
        </div>
      )}
      <div
        className={cx(
          "text-meta text-fg-faint",
          compact ? "px-2 pt-1 pb-1" : "border-t border-ink-800 px-4 py-3",
        )}
      >
        {confirming ? a.removeNote : (notice ?? a.note)}
      </div>
    </div>
  );
}

/** Settings → Appearance: the "Claude account" card. */
export function ClaudeAccountsCard() {
  const { t } = useI18n();
  return (
    <Card title={t.settings.accounts.title}>
      <AccountList />
    </Card>
  );
}

/** The Pressure panel's "switch account" button (Claude only): opens the list in a popover, for
 *  when the 5h / 7d window runs low. */
export function ClaudeAccountSwitch() {
  const { t } = useI18n();
  // Where the popover sits: under the button, right-aligned to it. It is portaled to <body> because
  // the sidebar clips what overflows it.
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!at) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!pop.current?.contains(target) && !button.current?.contains(target))
        setAt(null);
    };
    const away = () => setAt(null);
    document.addEventListener("mousedown", close);
    window.addEventListener("resize", away);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("resize", away);
    };
  }, [at]);
  const toggle = () => {
    if (at) return setAt(null);
    const r = button.current?.getBoundingClientRect();
    if (r) setAt({ top: r.bottom + 4, right: window.innerWidth - r.right });
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-expanded={at !== null}
        title={t.settings.accounts.switch}
        onClick={toggle}
        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-aux text-fg-faint hover:bg-(--ui-control-hover-background) hover:text-fg-muted"
      >
        <Icon name="circle-user" size={12} />
        {t.settings.accounts.switch}
      </button>
      {at &&
        createPortal(
          // Remounted on each open, so the list is read fresh every time.
          <div
            ref={pop}
            style={{ top: at.top, right: at.right }}
            className="fixed z-50 w-80 max-w-[calc(100vw-16px)] rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) shadow-(--shadow-md)"
          >
            <AccountList compact />
          </div>,
          document.body,
        )}
    </>
  );
}
