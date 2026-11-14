import type { DiffEvent } from "@shared/transcript";
import { ModalShell } from "../ui/ModalShell";
import { Icon } from "../ui/icons";
import { OverlayScroll } from "../ui/OverlayScroll";
import { cx } from "../ui/atoms";
import { useCopyFlash } from "../ui/use-copy-flash";
import { useI18n } from "../i18n";
import { splitFilePath } from "./file-path";

/** The detail modal for one edit (Edit / Write / MultiEdit): a single-line header with status dot, file path,
 *  change counts, copy-path, and close button, then the full hunk inside a borderless sunken well. */
export function DiffModal({
  diff,
  onClose,
}: {
  diff: DiffEvent;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const empty = diff.hunk.removed.length === 0 && diff.hunk.added.length === 0;
  const file = splitFilePath(diff.file);
  const patch = [
    ...diff.hunk.removed.map((l) => `- ${l}`),
    ...diff.hunk.added.map((l) => `+ ${l}`),
  ].join("\n");
  const { copied, copy } = useCopyFlash(patch);
  const pathCopy = useCopyFlash(diff.file);
  const statusDot =
    diff.status === "error"
      ? "bg-danger"
      : diff.status === "pending"
        ? "bg-working animate-pulse-soft"
        : "bg-ok";
  return (
    <ModalShell
      labelledBy="diff-title"
      widthClass="w-[44rem] max-w-[92vw]"
      onClose={onClose}
    >
      <div
        id="diff-title"
        className="mb-3 flex min-w-0 items-center gap-2.5 text-aux"
      >
        <span
          aria-hidden
          className={cx("size-2 shrink-0 rounded-full", statusDot)}
        />
        <span className="min-w-0 flex-1 truncate font-mono">
          <span className="text-fg-faint">{file.dir}</span>
          <span className="font-medium text-fg">{file.name}</span>
        </span>
        <button
          type="button"
          onClick={pathCopy.copy}
          className={cx(
            "shrink-0 rounded-xs bg-ink-850 px-2 py-0.5 text-meta transition-colors",
            pathCopy.copied
              ? "text-fg"
              : "text-fg-muted hover:bg-ink-800 hover:text-fg",
          )}
        >
          {pathCopy.copied ? t.common.copied : t.modals.diff.copyPath}
        </button>
        <div
          data-selectable-text="false"
          className="shrink-0 font-mono text-meta tabular-nums"
        >
          <span className="text-ok">+{diff.hunk.added.length}</span>{" "}
          <span className="text-danger">−{diff.hunk.removed.length}</span>
        </div>
        <button
          type="button"
          aria-label={t.common.close}
          title={t.common.close}
          onClick={onClose}
          className="grid size-6 shrink-0 place-items-center rounded-xs text-fg-faint transition-colors hover:bg-ink-800 hover:text-fg"
        >
          <Icon name="x" size={14} />
        </button>
      </div>

      <OverlayScroll
        axis="both"
        className="rounded-md bg-well"
        contentClassName="max-h-[min(64vh,calc(100vh-11rem))] p-3.5 font-mono text-meta leading-relaxed"
      >
        {empty ? (
          <span className="text-fg-faint">{t.modals.diff.noChanges}</span>
        ) : (
          <>
            {diff.hunk.removed.map((l, i) => (
              <div key={`r${i}`} className="whitespace-pre text-danger">
                - {l}
              </div>
            ))}
            {diff.hunk.added.map((l, i) => (
              <div key={`a${i}`} className="whitespace-pre text-ok">
                + {l}
              </div>
            ))}
          </>
        )}
      </OverlayScroll>

      <div className="mt-3 flex items-center gap-2 text-meta">
        <button
          type="button"
          onClick={copy}
          className={cx(
            "rounded-xs bg-ink-850 px-2.5 py-1 transition-colors",
            copied ? "text-fg" : "text-fg-muted hover:bg-ink-800 hover:text-fg",
          )}
        >
          {copied ? t.common.copied : t.modals.diff.copyDiff}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded-xs bg-ink-850 px-2.5 py-1 text-fg-muted transition-colors hover:bg-ink-800 hover:text-fg"
        >
          {t.common.close}
        </button>
      </div>
    </ModalShell>
  );
}
