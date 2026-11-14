import { useMemo } from "react";
import type { Session } from "@shared/types";
import { projectWorkTurns, type WaitingPrompt } from "@shared/transcript";
import { useI18n } from "../i18n";
import { AgentIcon } from "../ui/agent-icons";
import { OverlayScroll } from "../ui/OverlayScroll";
import type { DocState } from "./use-transcript";
import type { DispatchDrill } from "./drill-index";
import { useTranscriptModals } from "./use-transcript-modals";
import { useWorkScroll } from "./use-work-scroll";
import { WorkTurnCard } from "./WorkTurnCard";
import { WorkWaitingCard } from "./WorkWaitingCard";
import { WorkComposer } from "./WorkComposer";

function resolveActiveWaiting(
  session: Session,
  doc: DocState,
): WaitingPrompt | null {
  if (session.state !== "waiting") return null;
  if (doc?.waitingPrompt) return doc.waitingPrompt;
  return {
    kind: "permission",
    toolUseId: "",
    toolName: "",
    summary: doc?.waitingReason ?? "",
  };
}

/**
 * The interactive `Work` view: folds verbose CLI/tool/thinking streams into 1-line Turn Execution Spines,
 * surfaces user instructions, assistant deliverables, changed-file diff capsules, and failed steps directly,
 * and closes the loop with desktop Waiting choice cards + a bottom Composer wired to node-pty.
 */
export function WorkView({
  session,
  doc,
  now,
  canSpawn,
  compactPane = false,
  onFork,
  dispatchDrill,
  onBeforeAutoResume,
  onAfterAutoResume,
}: {
  session: Session;
  doc: DocState;
  now: number;
  canSpawn: boolean;
  compactPane?: boolean;
  onFork: (session: Session) => Promise<void>;
  dispatchDrill?: DispatchDrill;
  onBeforeAutoResume?: (id: string) => void;
  onAfterAutoResume?: (id: string, draft?: Session) => void;
}) {
  const { t } = useI18n();
  const { onOpen, modals } = useTranscriptModals(session.id);

  const turns = useMemo(() => {
    if (!doc) return [];
    return doc.workTurns ?? projectWorkTurns(doc);
  }, [doc]);

  const activeWaiting = resolveActiveWaiting(session, doc);
  const visibleTurns = useMemo(
    () =>
      turns.filter(
        (tr) =>
          tr.prompt !== null ||
          tr.deliverables.length > 0 ||
          tr.spine.stepCount > 0 ||
          tr.spine.thinkingCount > 0 ||
          tr.files.length > 0 ||
          tr.errors.length > 0,
      ),
    [turns],
  );

  // Identify the active running or waiting turn (last non-queued turn).
  let runningTurnIdx = -1;
  let waitingTurnIdx = -1;
  if (session.state === "working") {
    for (let i = visibleTurns.length - 1; i >= 0; i--) {
      if (!visibleTurns[i].queued) {
        runningTurnIdx = i;
        break;
      }
    }
  } else if (activeWaiting) {
    for (let i = visibleTurns.length - 1; i >= 0; i--) {
      if (!visibleTurns[i].queued) {
        waitingTurnIdx = i;
        break;
      }
    }
  }

  const scrollCount = visibleTurns.length + (activeWaiting ? 1 : 0);

  return (
    <div className="@container/work flex h-full min-h-0 min-w-0 flex-col bg-ink-950 text-fg">
      <OverlayScroll className="min-h-0 flex-1">
        <WorkFeed
          session={session}
          turns={visibleTurns}
          runningTurnIdx={runningTurnIdx}
          waitingTurnIdx={waitingTurnIdx}
          activeWaiting={activeWaiting}
          scrollCount={scrollCount}
          now={now}
          canSpawn={canSpawn}
          onFork={onFork}
          dispatchDrill={dispatchDrill}
          onOpen={onOpen}
          emptyLabel={
            session.state === "ended"
              ? t.workView.empty.endedEmpty
              : session.management === "managed"
                ? t.workView.empty.managedReady
                : t.workView.empty.observedWaiting
          }
        />
      </OverlayScroll>

      <WorkComposer
        session={session}
        canSpawn={canSpawn}
        compactPane={compactPane}
        hideIdentityBar={Boolean(activeWaiting)}
        onFork={onFork}
        onBeforeAutoResume={onBeforeAutoResume}
        onAfterAutoResume={onAfterAutoResume}
      />

      {modals}
    </div>
  );
}

function WorkFeed({
  session,
  turns,
  runningTurnIdx,
  waitingTurnIdx,
  activeWaiting,
  scrollCount,
  now,
  canSpawn,
  onFork,
  dispatchDrill,
  onOpen,
  emptyLabel,
}: {
  session: Session;
  turns: ReturnType<typeof projectWorkTurns>;
  runningTurnIdx: number;
  waitingTurnIdx: number;
  activeWaiting: WaitingPrompt | null;
  scrollCount: number;
  now: number;
  canSpawn: boolean;
  onFork: (session: Session) => Promise<void>;
  dispatchDrill?: DispatchDrill;
  onOpen: ReturnType<typeof useTranscriptModals>["onOpen"];
  emptyLabel: string;
}) {
  const contentRef = useWorkScroll(session.id, scrollCount);

  if (turns.length === 0 && !activeWaiting) {
    return (
      <div
        ref={contentRef}
        className="flex min-h-full flex-col items-center justify-center gap-2.5 px-4 py-12 text-center text-fg-faint"
      >
        <AgentIcon agent={session.agent} size={24} className="opacity-50" />
        <p className="max-w-md text-aux leading-relaxed">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div
      ref={contentRef}
      data-selectable-text="true"
      className="mx-auto max-w-3xl space-y-5 px-3 py-4 @min-[32rem]/work:space-y-6 @min-[32rem]/work:px-6 @min-[32rem]/work:py-6"
    >
      {turns.map((turn, idx) => (
        <WorkTurnCard
          key={`${turn.index}-${idx}`}
          sessionId={session.id}
          turn={turn}
          isRunningTail={idx === runningTurnIdx}
          waitingPrompt={idx === waitingTurnIdx ? activeWaiting : null}
          now={now}
          dispatchDrill={dispatchDrill}
          onOpen={onOpen}
        />
      ))}

      {activeWaiting && (
        <WorkWaitingCard
          session={session}
          prompt={activeWaiting}
          canSpawn={canSpawn}
          onFork={onFork}
        />
      )}
    </div>
  );
}
