import { agyPoolKindForModel } from "@shared/agy-quota";
import { CORE_TOKEN_KINDS } from "../../ui/token-kinds";
import { useI18n } from "../../i18n";
import { PressurePanel } from "../../workspace/panels/PressurePanel";
import { SpendPanel } from "../../workspace/panels/SpendPanel";
import { TokenSpeedPanel } from "../../workspace/panels/TokenSpeedPanel";
import { DutyPanel } from "../../workspace/panels/DutyPanel";
import { SessionPanel } from "../SessionPanel";
import { SectionDivider } from "./SectionDivider";
import type { SidebarPanelsProps } from "./index";

/** Antigravity CLI's telemetry stack: Pressure (context against the model's official window, and the
 *  plan's 5-hour and weekly windows for the pool the session's model draws from, read through
 *  Antigravity Tools) → Spend → Throughput → Duty → Session. */
export function AgyPanels({
  session,
  metrics,
  doc,
  ratesElsewhere,
}: SidebarPanelsProps) {
  const { t } = useI18n();
  const poolKind = agyPoolKindForModel(
    session.modelDisplayName ?? session.modelRaw ?? "",
  );
  const poolName =
    poolKind === "third-party"
      ? t.shell.split.poolThirdParty
      : t.shell.split.poolGemini;
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
        hideRates={ratesElsewhere}
        rateAgent="agy"
        rateLabel={`Antigravity · ${poolName}`}
      />
      <SectionDivider />
      <SpendPanel
        usageByModel={session.usageByModel ?? []}
        costUsd={null}
        kinds={CORE_TOKEN_KINDS}
        info={t.dock.spend.infoAgy}
      />
      <SectionDivider />
      {/* Keyed by session — same sparkline-bleed rule as ClaudePanels and CodexPanels. */}
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
