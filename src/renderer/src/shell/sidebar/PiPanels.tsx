import { CORE_TOKEN_KINDS } from "../../ui/token-kinds";
import { useI18n } from "../../i18n";
import { PressurePanel } from "../../workspace/panels/PressurePanel";
import { SpendPanel } from "../../workspace/panels/SpendPanel";
import { SessionPanel } from "../SessionPanel";
import { SectionDivider } from "./SectionDivider";
import type { SidebarPanelsProps } from "./index";

/** Pi's telemetry stack: Pressure (context from the transcript, plus the relay key's usage when
 *  models.json points Pi at one; Pi has no plan windows, so those rows never show) → Spend → Session.
 *  No Throughput or Duty yet — Pi's metrics reader isn't wired. */
export function PiPanels({ session, metrics, doc }: SidebarPanelsProps) {
  const { t } = useI18n();
  return (
    <>
      <PressurePanel
        live={null}
        context={doc?.context ?? null}
        contextPct={session.contextPct}
        contextWindow={session.contextWindow}
        account={null}
        rateLimits={{}}
        windowRowsWhenFetchedOnly
        relayUsage={session.relayUsage ?? null}
      />
      <SectionDivider />
      <SpendPanel
        usageByModel={session.usageByModel ?? []}
        costUsd={session.costUsd ?? null}
        kinds={CORE_TOKEN_KINDS}
        info={t.dock.spend.infoCodex}
      />
      <SectionDivider />
      <SessionPanel session={session} git={metrics?.git} pr={metrics?.pr} />
    </>
  );
}
