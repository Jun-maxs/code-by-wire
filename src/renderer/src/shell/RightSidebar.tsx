import { useState } from "react";
import type { Account, Session } from "@shared/types";
import { AGENTS } from "@shared/agents";
import { useI18n } from "../i18n";
import { useTranscript } from "../workspace/use-transcript";
import type { MetricsState } from "../workspace/use-metrics";
import { SIDEBAR_PANELS } from "./sidebar";
import { OverlayScroll } from "../ui/OverlayScroll";
import { cx } from "../ui/atoms";
import { Icon, type IconName } from "../ui/icons";
import { PromptsPage } from "./sidebar-pages/PromptsPage";
import { SkillsPage } from "./sidebar-pages/SkillsPage";

type Page = "metrics" | "prompts" | "skills";
const PAGES: { id: Page; icon: IconName; zh: string; en: string }[] = [
  { id: "metrics", icon: "gauge", zh: "指标", en: "Metrics" },
  { id: "prompts", icon: "scroll-text", zh: "提示词", en: "Prompts" },
  { id: "skills", icon: "zap", zh: "Skill", en: "Skills" },
];
const PAGE_KEY = "cbw.rightSidebar.page";

function storedPage(): Page {
  try {
    const v = localStorage.getItem(PAGE_KEY);
    return PAGES.some((p) => p.id === v) ? (v as Page) : "metrics";
  } catch {
    return "metrics";
  }
}

/**
 * The right sidebar's chrome (design spec §6): an empty draggable top strip — the fixed right
 * toggle cluster floats over it — then the selected agent's panel stack, looked up from
 * SIDEBAR_PANELS (shell/sidebar/ owns what each agent's stack contains; hasTelemetry only decides
 * whether a stack renders at all). Renders as plain content — the caller slots it inside a
 * `Pane` (Task 11), so this owns no width/position of its own beyond filling its parent.
 *
 * Fork feature (2026-10-28): a page switch under the strip — Metrics (the panel stack), Prompts
 * (the prompt library) and Skills (installed skills with update checks).
 *
 * Polls its own transcript: this pane is a sibling of `Workspace` at the App level rather than a
 * child of it, so it can't share `WorkspaceBody`'s `useTranscript` poll — a second independent poll of the
 * same session is the accepted minor cost (mirrors `metrics` needing its own App-level call per Task 11).
 */
export function RightSidebar({
  session,
  metrics,
  account,
}: {
  session: Session;
  metrics: MetricsState;
  account: Account | null;
}) {
  const { t, locale } = useI18n();
  const doc = useTranscript(session.id);
  const Panels = SIDEBAR_PANELS[session.agent];
  const [page, setPageState] = useState<Page>(storedPage);
  const setPage = (p: Page) => {
    setPageState(p);
    try {
      localStorage.setItem(PAGE_KEY, p);
    } catch {
      // remembered for this run only
    }
  };
  return (
    <div className="flex h-full flex-col border-l border-(--ui-stroke-secondary) bg-(--ui-sidebar-surface-background) text-(--ui-text-tertiary)">
      <div
        className="drag-region shrink-0 select-none"
        style={{ height: "var(--titlebar-height)" }}
      />
      <div className="shrink-0 px-4 pb-2">
        <div
          role="tablist"
          className="flex rounded-md border border-(--ui-stroke-tertiary) p-[2px]"
        >
          {PAGES.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={page === p.id}
              onClick={() => setPage(p.id)}
              className={cx(
                "flex h-6 flex-1 items-center justify-center gap-1 rounded-sm text-xs transition-colors duration-100",
                page === p.id
                  ? "bg-(--ui-control-active-background) font-medium text-fg"
                  : "text-(--ui-text-tertiary) hover:text-fg",
              )}
            >
              <Icon name={p.icon} size={12} />
              {locale === "zh" ? p.zh : p.en}
            </button>
          ))}
        </div>
      </div>

      {page === "prompts" ? (
        <OverlayScroll className="min-h-0 flex-1">
          <PromptsPage session={session} />
        </OverlayScroll>
      ) : page === "skills" ? (
        <OverlayScroll className="min-h-0 flex-1">
          <SkillsPage />
        </OverlayScroll>
      ) : AGENTS[session.agent].capabilities.hasTelemetry ? (
        /* px-1.5 on top of PanelSection's own px-2.5 ≈ the left sidebar's ~16px content inset,
            scoped here so the Activity dock's PanelSections keep their tighter fit. */
        <OverlayScroll className="min-h-0 flex-1">
          <div className="flex flex-col px-1.5 pb-2">
            <Panels
              session={session}
              metrics={metrics}
              account={account}
              doc={doc}
            />
          </div>
        </OverlayScroll>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center">
          <p className="text-body text-fg-faint">{t.common.comingSoon}</p>
        </div>
      )}
    </div>
  );
}
