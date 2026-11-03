import { TOKEN_KINDS } from "../../ui/token-kinds";
import { PressurePanel } from "../../workspace/panels/PressurePanel";
import { ClaudeAccountSwitch } from "../../settings/ClaudeAccounts";
import { SpendPanel } from "../../workspace/panels/SpendPanel";
import { TokenSpeedPanel } from "../../workspace/panels/TokenSpeedPanel";
import { DutyPanel } from "../../workspace/panels/DutyPanel";
import { SessionPanel } from "../SessionPanel";
import { SectionDivider } from "./SectionDivider";
import { useStore } from "@nanostores/react";
import { $accounts, badgeAccount } from "../../settings/accounts-store";
import { AccountBadge } from "../../settings/AccountBadge";
import type { SidebarPanelsProps } from "./index";

/** Claude Code's telemetry stack: Pressure (with the account API as the rate-limit merge's fill
 *  side) → Spend (all five token kinds, $ accounting) → Throughput → Duty → Session. */
export function ClaudePanels({
  session,
  metrics,
  account,
  doc,
  ratesElsewhere,
}: SidebarPanelsProps) {
  // Whose 5h / 7d the rows show, once there are two accounts to tell apart (fork, 2026-11-03).
  const accounts = useStore($accounts);
  const account5h = badgeAccount(accounts, session.accountDevice);
  return (
    <>
      <PressurePanel
        live={session.liveContext ?? null}
        context={doc?.context ?? null}
        contextPct={session.contextPct}
        contextWindow={session.contextWindow}
        account={account}
        rateLimits={session.rateLimits ?? null}
        hideRates={ratesElsewhere}
        headingRight={
          ratesElsewhere ? undefined : (
            <ClaudeAccountSwitch
              session={session}
              mark={
                account5h ? <AccountBadge account={account5h} /> : undefined
              }
            />
          )
        }
      />
      <SectionDivider />
      <SpendPanel
        usageByModel={session.usageByModel ?? []}
        costUsd={session.costUsd ?? null}
        kinds={TOKEN_KINDS}
      />
      <SectionDivider />
      {/* Keyed by session: the sparkline accumulates per-session history in state, and a
          composition remounts on an agent switch but NOT on a same-agent session switch —
          without the key the previous session's trend would bleed into the next one. */}
      <TokenSpeedPanel
        key={session.id}
        speed={metrics ? metrics.tokenSpeed : null}
      />
      <SectionDivider />
      <DutyPanel
        apiDurationMs={session.apiDurationMs ?? null}
        sessionClockMs={session.sessionClockMs ?? null}
      />
      <SectionDivider />
      <SessionPanel session={session} git={metrics?.git} pr={metrics?.pr} />
    </>
  );
}
