import { useStore } from "@nanostores/react";
import type { Session } from "@shared/types";
import { shortTopicName } from "@shared/products";
import { stripInlineCode } from "@shared/board";
import { useI18n } from "../i18n";
import { cx } from "../ui/atoms";
import { Icon } from "../ui/icons";
import { useSessionProduct } from "../products/products-context";
import { useSessionTasks } from "../board/session-tasks";
import { STATUS_BG } from "../board/parts";
import { $accounts, sessionMarks } from "../settings/accounts-store";
import { SessionAccountMark } from "../settings/AccountBadge";
import { ClaudeAccountSwitch } from "../settings/ClaudeAccounts";

function folderFallback(cwd?: string): string {
  if (!cwd) return "";
  const trimmed = cwd.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}

/**
 * Compact multi-session identity anchor rendered on Waiting decision cards and the Work composer.
 * Shows: [2px-rounded product square + name] [bound board task pill] [repo / worktree + branch] [account badge].
 * Uses pure flex spacing (`gap-2`) with zero middle-dot separators per UI-TASTE-REDLINES.md.
 */
export function WorkIdentityBar({
  session,
  className,
}: {
  session: Session;
  className?: string;
}) {
  const { t } = useI18n();
  const product = useSessionProduct(session);
  const sessionTasks = useSessionTasks();
  const boardTask = sessionTasks?.taskOf(session.id);
  const accounts = useStore($accounts);
  const marks = sessionMarks(accounts, session);

  const dirLabel = session.worktree
    ? `${session.worktree.repoLabel}/${session.worktree.name}`
    : session.repoLabel || folderFallback(session.cwd);

  const hasAny = Boolean(
    product || boardTask || dirLabel || session.branch || marks,
  );
  if (!hasAny) return null;

  return (
    <div
      className={cx(
        "flex min-w-0 items-center gap-2 overflow-hidden text-meta leading-none",
        className,
      )}
    >
      {product && (
        <span
          className="inline-flex min-w-0 max-w-32 shrink-0 items-center gap-1.5 text-fg-muted"
          title={product.name}
        >
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-[2px]"
            style={{ backgroundColor: product.color }}
          />
          <span className="truncate font-medium">
            {shortTopicName(product.name)}
          </span>
        </span>
      )}

      {sessionTasks && boardTask && (
        <button
          type="button"
          onClick={() => sessionTasks.openTask(boardTask.id)}
          title={`${t.shell.sessionMenu.openTask}：${stripInlineCode(boardTask.title)}`}
          className="inline-flex min-w-0 max-w-52 shrink items-center gap-1.5 rounded-sm bg-ink-900 px-1.5 py-1 text-fg-muted transition-colors hover:bg-ink-800 hover:text-fg"
        >
          <span
            aria-hidden
            className={cx(
              "size-1.5 shrink-0 rounded-full",
              STATUS_BG[boardTask.status],
            )}
          />
          <span className="truncate">{stripInlineCode(boardTask.title)}</span>
        </button>
      )}

      {dirLabel && (
        <span
          className={cx(
            "min-w-0 max-w-40 shrink items-center gap-1 font-mono text-fg-faint",
            product && boardTask
              ? "hidden @min-[25rem]/work:inline-flex"
              : "inline-flex",
          )}
          title={session.cwd ?? dirLabel}
        >
          <Icon name="folder" size={11} className="shrink-0 text-fg-dim" />
          <span className="truncate">{dirLabel}</span>
        </span>
      )}

      {session.branch && (
        <span
          className="hidden min-w-0 max-w-36 shrink items-center gap-1 font-mono text-fg-faint @min-[28rem]/work:inline-flex"
          title={session.branch}
        >
          <Icon name="git-branch" size={11} className="shrink-0 text-fg-dim" />
          <span className="truncate">{session.branch}</span>
        </span>
      )}

      {marks && (
        <span className="inline-flex shrink-0 items-center">
          <ClaudeAccountSwitch
            session={session}
            compact
            mark={
              <SessionAccountMark
                marks={marks}
                ended={session.state === "ended"}
              />
            }
          />
        </span>
      )}
    </div>
  );
}
