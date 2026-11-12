import type { CliStatus } from "@shared/cli-status";
import { footerView } from "../ui/rail-footer";
import { Icon } from "../ui/icons";
import { Card } from "../shell/page-primitives";
import { useI18n } from "../i18n";
import {
  SubsystemHeader,
  ReadoutRow,
  FaultBand,
  RailButton,
  DocsLink,
  type LampTone,
} from "./system-primitives";

const TONE: Record<ReturnType<typeof footerView>["dot"], LampTone> = {
  ok: "live",
  warn: "warn",
  error: "error",
  idle: "idle",
};

/** The Codex CLI subsystem card: same anatomy as the Claude card (state rail, readouts, fault
 *  band), with codex-sized remedies — an install command and a login pointer, no tab set and no
 *  version floor. Probes run through the same login-shell/PATHEXT spawn form (main/cli-check.ts). */
export function CodexCliCard({
  agent = "codex",
  status,
  checking,
  onRecheck,
}: {
  /** The same card serves the Antigravity CLI: only its names, docs link and data dir differ. */
  agent?: "codex" | "agy";
  status: CliStatus | null;
  checking: boolean;
  onRecheck: () => void;
}) {
  const { t } = useI18n();
  const copy = agent === "agy" ? t.settings.agyCli : t.settings.codexCli;
  const docsHref =
    agent === "agy"
      ? "https://antigravity.google/"
      : "https://developers.openai.com/codex/cli";
  const defaultDir = agent === "agy" ? "~/.gemini/antigravity-cli" : "~/.codex";
  const word =
    status === null
      ? t.settings.cli.stateChecking
      : status.kind === "ready"
        ? t.settings.cli.stateReady
        : t.settings.cli.stateFault;
  return (
    <Card title={copy.title}>
      <SubsystemHeader
        tone={TONE[footerView(status).dot]}
        word={word}
        action={
          <RailButton
            onClick={onRecheck}
            disabled={checking || status === null}
          >
            <Icon
              name="rotate-ccw"
              size={13}
              className={checking ? "animate-spin" : ""}
            />
            {t.settings.cli.recheck}
          </RailButton>
        }
      />
      {status && status.kind !== "ready" && (
        <FaultBand headline={copy.notInstalledHeadline}>
          <DocsLink href={docsHref} label={copy.docs} />
        </FaultBand>
      )}
      <ReadoutRow
        label={t.settings.cli.version}
        value={
          status?.version ? `v${status.version}` : t.settings.cli.notDetected
        }
      />
      <ReadoutRow
        label={t.settings.cli.config}
        value={status?.configDir.active ?? defaultDir}
      />
    </Card>
  );
}
