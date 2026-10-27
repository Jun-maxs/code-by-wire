import { useEffect, useRef, useState } from "react";
import type { ClaudeAccountsView, ClaudeOrg } from "@shared/ipc";
import { Card } from "../shell/page-primitives";
import { Icon } from "../ui/icons";
import { cx } from "../ui/atoms";
import { useI18n } from "../i18n";

/** reclaude's organizations and the switch/bind actions, shared by the Settings card and the
 *  Pressure panel's popover. Reads the list when mounted; a switch answers with the new list. */
function useClaudeAccounts() {
  const [view, setView] = useState<ClaudeAccountsView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    void window.api.listClaudeAccounts().then(setView);
  }, []);
  const use = async (org: ClaudeOrg, switched: (name: string) => string) => {
    setBusy(org.id);
    const next = await window.api.useClaudeAccount(org.id);
    setBusy(null);
    setView(next);
    if (!next.error) setNotice(switched(org.email || org.name));
  };
  const bind = (org: ClaudeOrg, binding: string) => {
    void window.api.bindClaudeAccount(org.id);
    setNotice(binding);
  };
  return { view, busy, notice, use, bind };
}

function AccountList({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const a = t.settings.accounts;
  const { view, busy, notice, use, bind } = useClaudeAccounts();
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
              {org.name} · {org.kind} · #{org.id}
            </div>
          </div>
          {org.current ? (
            <span className="flex shrink-0 items-center gap-1 text-meta text-primary">
              <Icon name="check" size={12} />
              {a.current}
            </span>
          ) : (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                org.bound ? void use(org, a.switched) : bind(org, a.binding)
              }
              className="shrink-0 rounded-md border border-ink-700 px-2.5 py-1 text-meta text-fg hover:bg-ink-800 disabled:opacity-50"
            >
              {busy === org.id ? "…" : org.bound ? a.use : a.bind}
            </button>
          )}
        </div>
      ))}
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
        {notice ?? a.note}
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
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-expanded={open}
        title={t.settings.accounts.switch}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-(--ui-text-secondary)"
      >
        <Icon name="circle-user" size={12} />
        {t.settings.accounts.switch}
      </button>
      {open && (
        // Remounted on each open, so the list is read fresh every time.
        <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) shadow-(--shadow-md)">
          <AccountList compact />
        </div>
      )}
    </div>
  );
}
