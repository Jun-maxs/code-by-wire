import { CORE_TOKEN_KINDS } from "../../ui/token-kinds";
import { useI18n } from "../../i18n";
import { PressurePanel } from "../../workspace/panels/PressurePanel";
import { SpendPanel } from "../../workspace/panels/SpendPanel";
import { SessionPanel } from "../SessionPanel";
import { SectionDivider } from "./SectionDivider";
import type { SidebarPanelsProps } from "./index";

/** Qoder CLI's telemetry stack: Pressure (context against the session's 1M default or configured
 *  window) → Spend → Session (model, effort, git branch & PR, compactions, last activity). */
export function QoderPanels({ session, metrics, doc }: SidebarPanelsProps) {
  const { t } = useI18n();
  return (
    <>
      <PressurePanel
        live={session.liveContext ?? null}
        context={doc?.context ?? null}
        contextPct={session.contextPct}
        contextWindow={session.contextWindow}
        account={null}
        rateLimits={{}}
        windowRowsWhenFetchedOnly
        relayUsage={null}
      />
      <SectionDivider />
      <SpendPanel
        usageByModel={session.usageByModel ?? []}
        costUsd={null}
        kinds={CORE_TOKEN_KINDS}
        info={t.dock.spend.infoQoder}
      />
      <SectionDivider />
      <SessionPanel session={session} git={metrics?.git} pr={metrics?.pr} />
    </>
  );
}
