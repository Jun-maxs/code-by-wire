import { useStore } from "@nanostores/react";
import {
  accountColor,
  SMART_SWITCH_THRESHOLDS,
  windowPct,
  type AccountQuota,
  type AccountsOverview,
  type SmartSwitchPrefs,
} from "@shared/account-switch";
import {
  agyPoolQuota,
  type AgyAccountQuota,
  type AgyPoolKind,
} from "@shared/agy-quota";
import type { RateLimit } from "@shared/types";
import { cx } from "../ui/atoms";
import { Icon } from "../ui/icons";
import { FillGauge } from "../ui/charts";
import { clampPct } from "../ui/charts-geom";
import { ctxColor, CONTEXT_DANGER_PCT, CONTEXT_WARN_PCT } from "../ui/meta";
import { useI18n } from "../i18n";
import { $accounts, type sessionMarks } from "./accounts-store";

/**
 * Fork (2026-11-03): which account a session runs on — its number on the account's own fill, the
 * same everywhere (split panes, the right sidebar, the account list). A digit on a filled square,
 * so it reads apart from the topic squares (no digit) and the state marks (bars and dots).
 */
export function AccountBadge({
  account,
  pending = false,
  className,
}: {
  account: AccountQuota;
  /** An account a session is still waiting to move to: outlined, not filled, so "2 → 1" reads as
   *  not done yet. */
  pending?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const label = t.settings.accounts.badge(account.n, account.email);
  const color = accountColor(account.n);
  return (
    <span
      title={label}
      role="img"
      aria-label={label}
      className={cx(
        "grid size-3.5 shrink-0 place-items-center rounded-xs font-mono text-tiny font-semibold leading-none tabular-nums",
        !pending && "text-white",
        className,
      )}
      style={
        pending
          ? { boxShadow: `inset 0 0 0 1px ${color}`, color }
          : { backgroundColor: color }
      }
    >
      {account.n}
    </span>
  );
}

/**
 * Fork (2026-11-03): a session's account badge; while it is to move to another account, an arrow
 * and that account's badge after it, outlined ("2 → 1"), so a move still waiting — for the turn,
 * its background work, or a resume — is visible where the session is.
 */
export function SessionAccountMark({
  marks,
  ended = false,
}: {
  marks: NonNullable<ReturnType<typeof sessionMarks>>;
  ended?: boolean;
}) {
  const { t } = useI18n();
  const { on, to } = marks;
  return (
    <span
      className={cx(
        "flex shrink-0 items-center gap-0.5",
        ended && "opacity-50",
      )}
      title={
        to
          ? ended
            ? t.settings.accounts.markOnResume(to.n)
            : t.settings.accounts.markPending(to.n)
          : undefined
      }
    >
      {on && <AccountBadge account={on} />}
      {to && (
        <>
          <Icon name="arrow-right" size={10} className="text-fg-faint" />
          <AccountBadge account={to} pending />
        </>
      )}
    </span>
  );
}

function savePrefs(view: AccountsOverview, prefs: SmartSwitchPrefs): void {
  $accounts.set({ ...view, smart: { ...view.smart, ...prefs } });
  void window.api.setAccountSwitchPrefs(prefs).then((next) => {
    if (next) $accounts.set(next);
  });
}

/** The smart switch's state line: why it can't run, or the rule it follows. */
function smartStatus(
  view: AccountsOverview,
  t: ReturnType<typeof useI18n>["t"],
): string {
  const a = t.settings.accounts;
  const { smart } = view;
  if (!smart.available) return a.smartNeedsTwo;
  if (!smart.enabled) return a.smartOff;
  if (smart.stuck) return a.smartStuck;
  return a.smartShort(smart.threshold);
}

/** What smart switching last did, as a small second line: a switch from the last 12 hours whose
 *  target is still the default. Older ones, or one the user has since switched away from, are
 *  dropped. */
function smartLastLine(
  view: AccountsOverview,
  t: ReturnType<typeof useI18n>["t"],
): string | null {
  const { smart, accounts } = view;
  const last = smart.last;
  if (!smart.enabled || !smart.available || !last) return null;
  const current = accounts.find((x) => x.current);
  if (current?.deviceId !== last.to || Date.now() - last.at >= 12 * 3_600_000)
    return null;
  const n = (device: string) =>
    accounts.find((x) => x.deviceId === device)?.n ?? 0;
  const time = new Date(last.at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return t.settings.accounts.smartLast(
    time,
    n(last.from),
    n(last.to),
    last.fromPct,
    last.moved,
  );
}

/**
 * The smart switch toggle. Compact (the right sidebar, the account popover): the switch and one
 * status line. Full (Settings): the rule spelled out and the threshold choice too.
 */
export function SmartSwitchControl({ full = false }: { full?: boolean }) {
  const { t } = useI18n();
  const a = t.settings.accounts;
  const view = useStore($accounts);
  if (!view) return null;
  const { enabled, threshold, available, stuck } = view.smart;
  const on = enabled && available;
  const lastLine = smartLastLine(view, t);
  return (
    <div className="flex flex-col">
      <div
        className={cx(
          "flex items-center justify-between gap-3",
          full ? "px-4 py-3" : "py-1",
        )}
      >
        <div className="min-w-0">
          <div className={cx(full ? "text-body" : "text-aux", "text-fg")}>
            {a.smartTitle}
          </div>
          <div
            className={cx(
              "mt-0.5 text-meta",
              on && stuck ? "text-accent" : "text-fg-faint",
            )}
          >
            {full && available && !(on && stuck)
              ? a.smartDesc
              : smartStatus(view, t)}
          </div>
          {lastLine && (
            <div className="mt-0.5 text-meta text-fg-dim">{lastLine}</div>
          )}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={a.smartTitle}
          disabled={!available}
          onClick={() => savePrefs(view, { enabled: !enabled, threshold })}
          className={cx(
            "relative h-[18px] w-8 shrink-0 rounded-full transition-colors disabled:opacity-40",
            on ? "bg-primary" : "bg-ink-700",
          )}
        >
          <span
            className={cx(
              "absolute top-[2px] h-[14px] w-[14px] rounded-full transition-all",
              on ? "right-[2px] bg-ink-900" : "left-[2px] bg-white",
            )}
          />
        </button>
      </div>
      {full && available && (
        <div className="flex items-center justify-between gap-4 border-t border-ink-850 px-4 py-3">
          <div className="text-body text-fg">{a.smartThreshold}</div>
          <div
            role="group"
            aria-label={a.smartThreshold}
            className="flex shrink-0 items-center rounded-sm border border-(--ui-stroke-tertiary) p-[2px]"
          >
            {SMART_SWITCH_THRESHOLDS.map((pct) => (
              <button
                key={pct}
                type="button"
                aria-pressed={pct === threshold}
                disabled={!enabled}
                onClick={() =>
                  pct !== threshold &&
                  savePrefs(view, { enabled, threshold: pct })
                }
                className={cx(
                  "h-6 rounded-[3px] px-2 text-meta tabular-nums transition-colors disabled:opacity-40",
                  pct === threshold
                    ? "bg-ink-800 text-fg"
                    : "text-fg-faint hover:text-fg",
                )}
              >
                {pct}%
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** "5h 29% · 7d 59%" for an account row's meta line; "not used yet" when nothing was captured. */
export function quotaSummary(
  account: AccountQuota,
  t: ReturnType<typeof useI18n>["t"],
): string {
  const a = t.settings.accounts;
  const now = Date.now();
  const five = windowPct(account.fiveHour, now);
  const seven = windowPct(account.sevenDay, now);
  if (five === null && seven === null) return a.notSeen;
  return [
    five !== null && `${a.windowFive} ${Math.round(five)}%`,
    seven !== null && `${a.windowSeven} ${Math.round(seven)}%`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** One account in the split view's sidebar: badge, login and "in use", then its 5h bar with the
 *  time to reset, and the 7d share. */
export function AccountQuotaRow({ account }: { account: AccountQuota }) {
  const { t } = useI18n();
  const a = t.settings.accounts;
  // With smart switching on, the bar's caution zone starts at the switch point, so it shows where
  // the account hands over; otherwise the usual context-style zones.
  const smart = useStore($accounts)?.smart;
  const switchAt = smart?.enabled && smart.available ? smart.threshold : null;
  const now = Date.now();
  const five = windowPct(account.fiveHour, now);
  const seven = windowPct(account.sevenDay, now);
  const pct = clampPct(Math.round(five ?? 0));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-w-0 items-center gap-1.5">
        <AccountBadge account={account} />
        <span
          className={cx(
            "min-w-0 flex-1 truncate text-aux",
            account.current ? "text-fg" : "text-fg-muted",
          )}
        >
          {account.email}
        </span>
        {account.current && (
          <span className="flex shrink-0 items-center gap-1 text-meta text-fg-faint">
            <Icon name="check" size={11} />
            {a.current}
          </span>
        )}
      </div>
      <div
        className={cx(
          "flex items-center gap-1 pl-5",
          five === null && "opacity-40",
        )}
        title={switchAt === null ? undefined : a.switchAt(switchAt)}
      >
        <span className="w-6 shrink-0 text-meta text-fg-faint">
          {a.windowFive}
        </span>
        <div className="min-w-0 flex-1">
          <FillGauge
            pct={pct}
            fill={ctxColor(pct)}
            caution={switchAt ?? CONTEXT_WARN_PCT}
            danger={switchAt === null ? CONTEXT_DANGER_PCT : 100}
            height={4}
          />
        </div>
        <span className="w-9 shrink-0 text-right font-mono text-aux tabular-nums text-fg-muted">
          {five === null ? "-" : `${pct}%`}
        </span>
        <span className="w-17 shrink-0 text-right font-mono text-meta tabular-nums text-fg-faint">
          {account.fiveHour && five
            ? t.time.countdown(account.fiveHour.resetsAt, now)
            : five === null
              ? a.notSeen
              : "-"}
        </span>
      </div>
      {seven !== null && (
        <div className="flex items-center gap-1 pl-5 text-meta text-fg-faint">
          <span className="w-6 shrink-0">{a.windowSeven}</span>
          <span className="flex-1" />
          <span className="w-9 shrink-0 text-right font-mono text-aux tabular-nums text-fg-muted">
            {Math.round(seven)}%
          </span>
          <span className="w-17 shrink-0 text-right font-mono tabular-nums">
            {account.sevenDay && seven > 0
              ? t.time.countdown(account.sevenDay.resetsAt, now)
              : ""}
          </span>
        </div>
      )}
    </div>
  );
}

function AgyWindowBar({
  label,
  window: w,
  now,
}: {
  label: string;
  window?: RateLimit;
  now: number;
}) {
  const { t } = useI18n();
  const rawPct = windowPct(w, now);
  const pct = clampPct(Math.round(rawPct ?? 0));
  return (
    <div
      className={cx(
        "flex items-center gap-1 pl-5",
        rawPct === null && "opacity-40",
      )}
    >
      <span className="w-6 shrink-0 text-meta text-fg-faint">{label}</span>
      <div className="min-w-0 flex-1">
        <FillGauge
          pct={pct}
          fill={ctxColor(pct)}
          caution={CONTEXT_WARN_PCT}
          danger={CONTEXT_DANGER_PCT}
          height={4}
        />
      </div>
      <span className="w-9 shrink-0 text-right font-mono text-aux tabular-nums text-fg-muted">
        {rawPct === null ? "-" : `${pct}%`}
      </span>
      <span className="w-17 shrink-0 text-right font-mono text-meta tabular-nums text-fg-faint">
        {w && rawPct !== null && rawPct > 0
          ? t.time.countdown(w.resetsAt, now)
          : rawPct === null
            ? t.settings.accounts.notSeen
            : "-"}
      </span>
    </div>
  );
}

/** One Antigravity Tools account in the split sidebar: numbered fill badge, email, tier tag, and its
 *  active pool's 5h / weekly gauges. Mirrors AccountQuotaRow's density and column rhythm. */
export function AgyQuotaRow({
  account,
  index,
  pool,
}: {
  account: AgyAccountQuota;
  index: number;
  pool: AgyPoolKind;
}) {
  const { t } = useI18n();
  const a = t.settings.accounts;
  const now = Date.now();
  const windows = agyPoolQuota(account, pool);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          aria-hidden="true"
          className="grid size-3.5 shrink-0 place-items-center rounded-xs font-mono text-tiny font-semibold leading-none tabular-nums text-white"
          style={{ backgroundColor: accountColor(index + 1) }}
        >
          {index + 1}
        </span>
        <span
          className={cx(
            "min-w-0 flex-1 truncate text-aux",
            account.current ? "text-fg" : "text-fg-muted",
          )}
          title={account.email || undefined}
        >
          {account.email || "-"}
        </span>
        {account.tier && (
          <span className="shrink-0 rounded-sm border border-(--ui-stroke-tertiary) px-1 py-0.5 font-mono text-tiny uppercase leading-none text-fg-faint">
            {account.tier}
          </span>
        )}
        {account.current && (
          <span className="flex shrink-0 items-center gap-1 text-meta text-fg-faint">
            <Icon name="check" size={11} />
            {a.current}
          </span>
        )}
      </div>
      <AgyWindowBar label={a.windowFive} window={windows.fiveHour} now={now} />
      <AgyWindowBar label={a.windowSeven} window={windows.sevenDay} now={now} />
    </div>
  );
}
