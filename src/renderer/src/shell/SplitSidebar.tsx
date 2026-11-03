import { useStore } from "@nanostores/react";
import type { Session } from "@shared/types";
import { AGENTS } from "@shared/agents";
import { useI18n } from "../i18n";
import { cx, Lamp } from "../ui/atoms";
import { AgentIcon } from "../ui/agent-icons";
import { SidebarPanelLabel } from "./SidebarPanelLabel";
import { ctxTone, CONTEXT_WARN_PCT } from "../ui/meta";
import { PanelHeading, PanelSection } from "../workspace/panels/chrome";
import { $accounts, sessionMarks } from "../settings/accounts-store";
import {
  AccountQuotaRow,
  SessionAccountMark,
  SmartSwitchControl,
} from "../settings/AccountBadge";
import { ClaudeAccountSwitch } from "../settings/ClaudeAccounts";
import { SIDEBAR_PANELS, type SidebarPanelsProps } from "./sidebar";
import { SectionDivider } from "./sidebar/SectionDivider";
import { sessionDisplayTitle } from "./split-view";

export interface SplitSidebarProps {
  /** The grid's sessions, in pane order. */
  panes: Session[];
  /** Focus a pane (the app's selected session). */
  onActivate: (id: string) => void;
}

/**
 * Fork (2026-11-03): the right sidebar's metrics page while the middle column is split. The single
 * view's stack answers "how is this session doing"; with several panes open the questions come
 * first across them — which pane needs me, which account each runs on, how much 5h room every
 * account has left — and only then the selected pane in depth, under its own name so it is clear
 * which pane the numbers belong to. Rate windows move up into the accounts section (one row per
 * account instead of one account's), so the pane's Pressure panel keeps just its context.
 */
export function SplitSidebar({
  panes,
  onActivate,
  session,
  metrics,
  account,
  doc,
}: SplitSidebarProps & SidebarPanelsProps) {
  const { t } = useI18n();
  const s = t.shell.split;
  const accounts = useStore($accounts);
  const many = (accounts?.accounts.length ?? 0) >= 2;
  const Panels = SIDEBAR_PANELS[session.agent];
  const selectedMarks = sessionMarks(accounts, session);
  return (
    <div className="flex flex-col px-1.5 pb-2">
      <PanelSection>
        <PanelHeading
          icon="layout-grid"
          right={
            <span className="text-meta text-fg-faint">{s.contextShort}</span>
          }
        >
          {s.panesHeading}
        </PanelHeading>
        <ul className="-mx-1.5 flex flex-col">
          {panes.map((p) => {
            const title = sessionDisplayTitle(p, t);
            const active = p.id === session.id;
            const marks = sessionMarks(accounts, p);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  aria-current={active}
                  title={s.focusPane(title)}
                  onClick={() => onActivate(p.id)}
                  className={cx(
                    "flex h-7 w-full items-center gap-1.5 rounded-sm px-1.5 text-left transition-colors duration-100",
                    active
                      ? "bg-(--ui-row-active-background)"
                      : "hover:bg-(--ui-row-hover-background)",
                  )}
                >
                  <span className="grid size-3.5 shrink-0 place-items-center">
                    <Lamp state={p.state} management={p.management} />
                  </span>
                  {marks ? (
                    <SessionAccountMark
                      marks={marks}
                      ended={p.state === "ended"}
                    />
                  ) : (
                    many && <span className="size-3.5 shrink-0" />
                  )}
                  {p.agent !== "claude" && (
                    <AgentIcon agent={p.agent} size={12} className="shrink-0" />
                  )}
                  <span
                    className={cx(
                      "min-w-0 flex-1 truncate text-aux",
                      active ? "font-medium text-fg" : "text-fg-muted",
                    )}
                  >
                    {title}
                  </span>
                  {p.state === "ended" ? (
                    <span className="shrink-0 text-meta text-fg-dim">
                      {s.ended}
                    </span>
                  ) : (
                    AGENTS[p.agent].capabilities.hasTelemetry && (
                      <span
                        title={s.contextShort}
                        className={cx(
                          "shrink-0 font-mono text-meta tabular-nums",
                          p.contextPct >= CONTEXT_WARN_PCT
                            ? ctxTone(p.contextPct)
                            : "text-fg-faint",
                        )}
                      >
                        {p.contextPct}%
                      </span>
                    )
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </PanelSection>

      {accounts && (
        <>
          <SectionDivider />
          <PanelSection>
            <PanelHeading
              icon="circle-user"
              right={<ClaudeAccountSwitch mark={null} />}
            >
              {s.accountsHeading}
            </PanelHeading>
            <div className="flex flex-col gap-3">
              {accounts.accounts.map((a) => (
                <AccountQuotaRow key={a.deviceId} account={a} />
              ))}
            </div>
            {many && (
              <div className="mt-1 border-t border-(--ui-stroke-tertiary) pt-1.5">
                <SmartSwitchControl />
              </div>
            )}
          </PanelSection>
        </>
      )}

      <SectionDivider />
      {/* The selected pane's own panels follow under its name, which stays pinned while they scroll,
          so every number below reads as that pane's. */}
      <div className="sticky top-0 z-10 -mx-1.5 mt-2 flex h-8 min-w-0 items-center gap-1.5 border-b border-(--ui-stroke-tertiary) bg-(--ui-sidebar-surface-background) px-4">
        <SidebarPanelLabel icon="app-window" className="shrink-0">
          {s.currentPane}
        </SidebarPanelLabel>
        {selectedMarks && <SessionAccountMark marks={selectedMarks} />}
        <span className="min-w-0 flex-1 truncate text-aux font-medium text-fg">
          {sessionDisplayTitle(session, t)}
        </span>
      </div>
      {AGENTS[session.agent].capabilities.hasTelemetry ? (
        <Panels
          session={session}
          metrics={metrics}
          account={account}
          doc={doc}
          ratesElsewhere={accounts !== null}
        />
      ) : (
        <p className="px-2.5 py-3 text-body text-fg-faint">
          {t.common.comingSoon}
        </p>
      )}
    </div>
  );
}
