import { CORE_TOKEN_KINDS } from "../../ui/token-kinds";
import { useI18n } from "../../i18n";
import { PressurePanel } from "../../workspace/panels/PressurePanel";
import { SpendPanel } from "../../workspace/panels/SpendPanel";
import { SessionPanel } from "../SessionPanel";
import { SectionDivider } from "./SectionDivider";
import type { SidebarPanelsProps } from "./index";

/** Antigravity CLI's telemetry stack: Pressure (context against the model's official window, and the
 *  plan's 5-hour and weekly windows for the pool the session's model draws from, read through
 *  Antigravity Tools; the rows hide when Tools has nothing) → Spend → Session. No Throughput or Duty:
 *  agy's store has no per-token timing. */
export function AgyPanels({ session, metrics, doc }: SidebarPanelsProps) {
  const { t } = useI18n();
  return (
    <>
      <PressurePanel
        live={session.liveContext ?? null}
        context={doc?.context ?? null}
        contextPct={session.contextPct}
        contextWindow={session.contextWindow}
        account={null}
        rateLimits={session.rateLimits ?? {}}
        windowRowsWhenFetchedOnly
        relayUsage={null}
      />
      <SectionDivider />
      <SpendPanel
        usageByModel={session.usageByModel ?? []}
        costUsd={null}
        kinds={CORE_TOKEN_KINDS}
        info={t.dock.spend.infoAgy}
      />
      <SectionDivider />
      <SessionPanel session={session} git={metrics?.git} pr={metrics?.pr} />
    </>
  );
}
