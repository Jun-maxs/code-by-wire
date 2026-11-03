import { useStore } from "@nanostores/react";
import {
  accountColor,
  SMART_SWITCH_THRESHOLDS,
  windowPct,
  type AccountQuota,
  type AccountsOverview,
  type SmartSwitchPrefs,
} from "@shared/account-switch";
import { cx } from "../ui/atoms";
import { Icon } from "../ui/icons";
import { FillGauge } from "../ui/charts";
import { clampPct } from "../ui/charts-geom";
import { ctxColor, CONTEXT_DANGER_PCT, CONTEXT_WARN_PCT } from "../ui/meta";
import { useI18n } from "../i18n";
import { $accounts } from "./accounts-store";

/**
 * Fork (2026-11-03): which account a session runs on — its number on the account's own fill, the
 * same everywhere (split panes, the right sidebar, the account list). A digit on a filled square,
 * so it reads apart from the topic squares (no digit) and the state marks (bars and dots).
 */
export function AccountBadge({
  account,
  className,
}: {
  account: AccountQuota;
  className?: string;
}) {
  const { t } = useI18n();
  const label = t.settings.accounts.badge(account.n, account.email);
  return (
    <span
      title={label}
      role="img"
      aria-label={label}
      className={cx(
        "grid size-3.5 shrink-0 place-items-center rounded-xs font-mono text-tiny font-semibold leading-none text-white tabular-nums",
        className,
      )}
      style={{ backgroundColor: accountColor(account.n) }}
    >
      {account.n}
    </span>
  );
}

function savePrefs(view: AccountsOverview, prefs: SmartSwitchPrefs): void {
  $accounts.set({ ...view, smart: { ...view.smart, ...prefs } });
  void window.api.setAccountSwitchPrefs(prefs).then((next) => {
    if (next) $accounts.set(next);
  });
}

/** The smart switch's one-line state: why it can't run, what it last did, or what it will do. */
function smartStatus(
  view: AccountsOverview,
  t: ReturnType<typeof useI18n>["t"],
): string {
  const a = t.settings.accounts;
  const { smart, accounts } = view;
  if (!smart.available) return a.smartNeedsTwo;
  if (!smart.enabled) return a.smartOff;
  if (smart.enabled && smart.stuck) return a.smartStuck;
  const last = smart.last;
  const n = (device: string) =>
    accounts.find((x) => x.deviceId === device)?.n ?? 0;
  // A switch from the last 12 hours is still news while its target is in use; older ones, or one
  // the user has since switched away from, give way to the rule itself.
  const current = accounts.find((x) => x.current);
  if (
    smart.enabled &&
    last &&
    current?.deviceId === last.to &&
    Date.now() - last.at < 12 * 3_600_000
  ) {
    const time = new Date(last.at).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
    return a.smartLast(
      time,
      n(last.from),
      n(last.to),
      last.fromPct,
      last.moved,
    );
  }
  return a.smartShort(smart.threshold);
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
