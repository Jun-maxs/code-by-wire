import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ClaudeAccountsView, ClaudeOrg } from "@shared/ipc";
import {
  accountColor,
  windowPct,
  type AccountQuota,
  type AccountsOverview,
} from "@shared/account-switch";
import type { Session } from "@shared/types";
import { Card } from "../shell/page-primitives";
import { Icon } from "../ui/icons";
import { cx } from "../ui/atoms";
import { useI18n } from "../i18n";
import { useStore } from "@nanostores/react";
import { $accounts } from "./accounts-store";
import { AccountBadge, quotaSummary, SmartSwitchControl } from "./AccountBadge";
import {
  accountSwitchKind,
  backgroundBusy,
  moveSessionAccount,
} from "./session-account";
import { sessionDisplayTitle } from "../shell/split-view";

/** reclaude's bindings and the switch/bind/add/remove actions, shared by the Settings card and the
 *  Pressure panel's popover. Reads the list when mounted; every action answers with the new list.
 *  `busy` is the org being acted on, or "add" while a new account is being signed in to. */
function useClaudeAccounts() {
  const { t } = useI18n();
  const a = t.settings.accounts;
  const [view, setView] = useState<ClaudeAccountsView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Read again whenever the default account changes underneath (smart switching, fork 2026-11-03),
  // so "in use" never points at the account just switched away from.
  const currentDevice = useStore($accounts)?.accounts.find(
    (q) => q.current,
  )?.deviceId;
  useEffect(() => {
    void window.api.listClaudeAccounts().then(setView);
  }, [currentDevice]);
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

/** Every binding with its default switch, bind, remove and add actions: Settings, and the popover
 *  while there is no second account to move a session to. */
function AccountList({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const a = t.settings.accounts;
  const { view, busy, notice, use, bind, add, remove } = useClaudeAccounts();
  // Fork (2026-11-03): each bound account's badge and 5h / 7d use, once there are two to tell apart.
  const quotas = useStore($accounts);
  const quotaOf = (org: ClaudeOrg) =>
    quotas && quotas.accounts.length >= 2 && org.deviceId
      ? quotas.accounts.find((q) => q.deviceId === org.deviceId)
      : undefined;
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
            org.current && compact && "bg-(--ui-row-hover-background)",
          )}
        >
          <div className="flex min-w-0 items-start gap-2">
            {quotaOf(org) && (
              <AccountBadge account={quotaOf(org)!} className="mt-[3px]" />
            )}
            <div className="min-w-0">
              <div className="truncate text-body text-fg">
                {org.email || org.name}
              </div>
              <div className="truncate text-meta text-fg-faint">
                {quotaOf(org)
                  ? quotaSummary(quotaOf(org)!, t)
                  : [org.name, org.kind, `#${org.id}`]
                      .filter(Boolean)
                      .join(" · ")}
              </div>
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
      <AddAccountButton
        compact={compact}
        busy={busy}
        onAdd={() => void add()}
      />
      {view.error && (
        <div className="px-4 py-2 text-meta text-danger">
          {a.failed(view.error)}
        </div>
      )}
      {quotas && quotas.accounts.length >= 2 && (
        <div
          className={cx(
            compact
              ? "mx-1 mt-1 border-t border-ink-850 px-1 pt-1"
              : "border-t border-ink-800",
          )}
        >
          <SmartSwitchControl full={!compact} />
        </div>
      )}
      {(!compact || confirming || notice) && (
        <div
          className={cx(
            "text-meta text-fg-faint",
            compact ? "px-2 pt-1 pb-1" : "border-t border-ink-800 px-4 py-3",
          )}
        >
          {confirming ? a.removeNote : (notice ?? a.note)}
        </div>
      )}
    </div>
  );
}

function AddAccountButton({
  compact,
  busy,
  onAdd,
}: {
  compact: boolean;
  busy: string | null;
  onAdd: () => void;
}) {
  const { t } = useI18n();
  const a = t.settings.accounts;
  return (
    <button
      type="button"
      disabled={busy !== null}
      onClick={onAdd}
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
  );
}

/**
 * Fork (2026-11-03): the popover opened from a Claude session, once there are two accounts. The
 * rows act on this session alone — "move here" gives it that account as its own and restarts it
 * there (after this turn when it is working; on resume when it has ended) — while the default for
 * new sessions is its own small choice below, so moving one session never moves the others.
 */
function SessionAccounts({
  session,
  view,
}: {
  session: Session;
  view: AccountsOverview;
}) {
  const { t } = useI18n();
  const a = t.settings.accounts;
  // The account just picked here, until the next sync carries it as the session's own.
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const kind = accountSwitchKind(session);
  // Background work still running (read once per opening): a move then waits for it.
  const [background, setBackground] = useState(false);
  useEffect(() => {
    if (kind === "live")
      void backgroundBusy(session.id).then((busy) => setBackground(busy));
  }, [kind, session.id]);
  const defaultDevice = view.accounts.find((x) => x.current)?.deviceId;
  // Where it runs now (a live session not yet seen anywhere was started on the default), and where
  // it is to run: its own account, else — when it has ended — the default its resume would take.
  const running =
    session.accountDevice ?? (kind === "live" ? defaultDevice : undefined);
  const want =
    picked ??
    session.accountWant ??
    (kind === "ended" ? defaultDevice : running);
  const pending =
    kind === "live" && want !== undefined && want !== running ? want : null;
  const movable = kind === "live" || kind === "ended";

  const move = async (account: AccountQuota) => {
    setBusy(account.deviceId);
    setError(null);
    const ok = await moveSessionAccount(session, account.deviceId);
    setBusy(null);
    if (ok) setPicked(account.deviceId);
    else setError(a.moveFailed);
    if (ok && kind === "live") setBackground(await backgroundBusy(session.id));
  };
  const makeDefault = async (account: AccountQuota) => {
    if (account.current) return;
    setBusy("default");
    setError(null);
    const next = await window.api.useClaudeAccount(account.orgId);
    setBusy(null);
    if (next.error) return setError(a.failed(next.error));
    // Mirror it now; the smart switch's next tick confirms it.
    $accounts.set({
      ...view,
      accounts: view.accounts.map((x) => ({
        ...x,
        current: x.deviceId === account.deviceId,
      })),
    });
  };
  const add = async () => {
    setBusy("add");
    setError(null);
    const next = await window.api.addClaudeAccount();
    setBusy(null);
    if (next.error) setError(a.failed(next.error));
  };

  const hint =
    kind === "remote"
      ? a.hintRemote
      : kind === "outside"
        ? a.hintOutside
        : kind === "ended"
          ? a.hintEnded
          : background
            ? a.hintBackground
            : pending || session.state !== "idle"
              ? a.hintBusy
              : a.hintIdle;
  // While a move waits: for the turn to end, or for the background work; else it is under way.
  // Each row's use, with the 5h reset time the popover is opened to judge by.
  const rowMeta = (acc: AccountQuota) => {
    const now = Date.now();
    const five = windowPct(acc.fiveHour, now);
    const seven = windowPct(acc.sevenDay, now);
    if (five === null && seven === null) return quotaSummary(acc, t);
    return [
      five !== null && `${a.windowFive} ${Math.round(five)}%`,
      acc.fiveHour &&
        five &&
        a.resetsIn(t.time.countdown(acc.fiveHour.resetsAt, now)),
      seven !== null && `${a.windowSeven} ${Math.round(seven)}%`,
    ]
      .filter(Boolean)
      .join(" · ");
  };
  const waitingLabel =
    session.state !== "idle"
      ? a.afterTurn
      : background
        ? a.afterBackground
        : a.moving;

  return (
    <div className="flex flex-col p-1.5">
      <div className="flex min-w-0 items-baseline gap-1.5 px-2 pt-1 pb-1.5">
        <span className="shrink-0 text-meta text-fg-faint">
          {a.sessionHeading}
        </span>
        <span className="min-w-0 truncate text-aux text-fg-muted">
          {sessionDisplayTitle(session, t)}
        </span>
      </div>
      {view.accounts.map((acc) => {
        const here =
          kind === "ended" ? acc.deviceId === want : acc.deviceId === running;
        const target = acc.deviceId === pending;
        return (
          <div
            key={acc.deviceId}
            className={cx(
              "flex items-center justify-between gap-3 rounded-md px-2 py-1.5",
              here && "bg-(--ui-row-hover-background)",
            )}
            style={
              target
                ? { boxShadow: `inset 2px 0 0 ${accountColor(acc.n)}` }
                : undefined
            }
          >
            <div className="flex min-w-0 items-start gap-2">
              <AccountBadge account={acc} className="mt-[3px]" />
              <div className="min-w-0">
                <div title={acc.email} className="truncate text-body text-fg">
                  {acc.email}
                </div>
                <div
                  title={rowMeta(acc)}
                  className="truncate text-meta text-fg-faint"
                >
                  {rowMeta(acc)}
                </div>
              </div>
            </div>
            {target ? (
              <div className="flex shrink-0 items-center gap-1">
                <span className="text-meta text-fg-muted">{waitingLabel}</span>
                {waitingLabel !== a.moving && running && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => {
                      const back = view.accounts.find(
                        (x) => x.deviceId === running,
                      );
                      if (back) void move(back);
                    }}
                    className="rounded-md px-1.5 py-1 text-meta text-fg-faint hover:bg-ink-800 hover:text-fg disabled:opacity-50"
                  >
                    {a.cancel}
                  </button>
                )}
              </div>
            ) : here ? (
              <span className="flex shrink-0 items-center gap-1 text-meta text-primary">
                <Icon name="check" size={12} />
                {kind === "ended" ? a.onResume : a.thisSession}
              </span>
            ) : movable ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void move(acc)}
                className="shrink-0 rounded-md border border-ink-700 px-2.5 py-1 text-meta text-fg hover:bg-ink-800 disabled:opacity-50"
              >
                {busy === acc.deviceId
                  ? "…"
                  : kind === "ended"
                    ? a.useOnResume
                    : a.moveHere}
              </button>
            ) : null}
          </div>
        );
      })}
      <div
        className={cx(
          "px-2 pt-1 pb-1.5 text-meta",
          error ? "text-danger" : "text-fg-faint",
        )}
      >
        {error ?? hint}
      </div>
      <div className="mx-1 mt-1 border-t border-ink-800 px-1 pt-2 text-meta text-fg-faint">
        {a.allHeading}
      </div>
      <div className="mx-1 flex items-center justify-between gap-3 px-1 py-1.5">
        <div className="min-w-0">
          <div className="text-aux text-fg">{a.defaultTitle}</div>
          <div className="text-meta text-fg-faint">{a.defaultHint}</div>
        </div>
        <div
          role="radiogroup"
          aria-label={a.defaultTitle}
          className="flex shrink-0 items-center rounded-sm border border-(--ui-stroke-tertiary) p-[2px]"
        >
          {view.accounts.map((acc) => (
            <button
              key={acc.deviceId}
              type="button"
              role="radio"
              aria-checked={acc.current}
              aria-label={a.badge(acc.n, acc.email)}
              title={a.badge(acc.n, acc.email)}
              disabled={busy !== null}
              onClick={() => void makeDefault(acc)}
              className={cx(
                "grid h-6 w-7 place-items-center rounded-[3px] transition-colors",
                acc.current
                  ? "bg-ink-700 ring-1 ring-ink-600 ring-inset"
                  : "hover:bg-ink-850",
              )}
            >
              <AccountBadge account={acc} />
            </button>
          ))}
        </div>
      </div>
      <div className="mx-1 px-1">
        <SmartSwitchControl />
      </div>
      <AddAccountButton compact busy={busy} onAdd={() => void add()} />
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

/** The width of the popover, for keeping a left-aligned one on screen. */
const POPOVER_W = 320;

/** The account switcher's button and popover (Claude only): from a session it moves that session
 *  (once there are two accounts), otherwise it lists the accounts. `mark` leads the label — the
 *  session's account badge, nothing (null), or by default the account icon; `compact` drops the
 *  label so the mark alone is the button (a split pane's title bar), with the popover opening to
 *  its right instead of its left. */
export function ClaudeAccountSwitch({
  session,
  mark,
  compact = false,
}: {
  /** The session it moves; without one it manages the accounts (the default, adding, removing). */
  session?: Session;
  /** Fork (2026-11-03): what leads the label — the session's account badge, nothing (null), or by
   *  default the account icon. */
  mark?: ReactNode | null;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const quotas = useStore($accounts);
  // Where the popover sits: under the button, aligned to its right edge (left edge when compact).
  // It is portaled to <body> because the sidebar and the panes clip what overflows them.
  const [at, setAt] = useState<{
    top: number;
    left?: number;
    right?: number;
  } | null>(null);
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
    if (!r) return;
    setAt(
      compact
        ? {
            top: r.bottom + 4,
            left: Math.max(
              8,
              Math.min(r.left, window.innerWidth - POPOVER_W - 8),
            ),
          }
        : { top: r.bottom + 4, right: window.innerWidth - r.right },
    );
  };
  const forSession =
    session?.agent === "claude" && quotas && quotas.accounts.length >= 2
      ? { session, view: quotas }
      : null;
  // Named for what it acts on: this session, or every account.
  const label = forSession
    ? t.settings.accounts.switchSession
    : session
      ? t.settings.accounts.switch
      : t.settings.accounts.manage;
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-expanded={at !== null}
        aria-label={compact ? label : undefined}
        title={label}
        onClick={toggle}
        className={cx(
          "flex items-center gap-1 rounded-md text-aux text-fg-faint hover:bg-(--ui-control-hover-background) hover:text-fg-muted",
          compact ? "-mx-0.5 px-0.5 py-0.5" : "px-1.5 py-0.5",
          at && "bg-(--ui-control-hover-background)",
        )}
      >
        {mark === undefined ? <Icon name="circle-user" size={12} /> : mark}
        {compact ? (
          <Icon name="chevron-down" size={10} className="text-fg-faint" />
        ) : (
          label
        )}
      </button>
      {at &&
        createPortal(
          // Remounted on each open, so the list is read fresh every time.
          <div
            ref={pop}
            style={{ top: at.top, left: at.left, right: at.right }}
            className="fixed z-50 w-80 max-w-[calc(100vw-16px)] rounded-md border border-ink-800 bg-ink-900 shadow-(--shadow-md)"
          >
            {forSession ? (
              <SessionAccounts
                session={forSession.session}
                view={forSession.view}
              />
            ) : (
              <AccountList compact />
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
