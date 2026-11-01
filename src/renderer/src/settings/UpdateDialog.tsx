import { useState } from "react";
import { offeredUpdate } from "@shared/update";
import { ModalShell } from "../ui/ModalShell";
import { Icon } from "../ui/icons";
import { useI18n } from "../i18n";
import type { UpdateControls } from "./SoftwareUpdateCard";

/**
 * Fork: the dialog that offers a new release as soon as one is found — its notes, the background
 * download's progress, and the three choices: restart now (once downloaded), later (installs on the
 * next quit) or skip this version. "Later" holds for the rest of this launch; a skip is persisted.
 */
export function UpdateDialog({ update }: { update: UpdateControls }) {
  const { t } = useI18n();
  const u = t.settings.update;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const offer = offeredUpdate(update.state);
  if (!offer || offer.version === dismissed) return null;
  const p = update.state.phase;
  const ready = p.kind === "downloaded";
  const later = () => setDismissed(offer.version);

  return (
    <ModalShell
      labelledBy="update-dialog-title"
      widthClass="w-[440px]"
      onClose={later}
    >
      <div className="flex items-center gap-2">
        <h2
          id="update-dialog-title"
          className="text-title font-semibold text-fg"
        >
          {u.dialogTitle}
        </h2>
        <span className="rounded-sm border border-ink-700 px-1.5 py-0.5 font-mono text-meta text-primary-bright">
          v{offer.version}
        </span>
      </div>
      <div className="mt-1 text-meta text-fg-faint">
        {u.onVersion(update.state.currentVersion)}
      </div>

      <div className="mt-4 text-label font-medium text-fg-muted">
        {u.whatsNew}
      </div>
      {offer.notes.length > 0 ? (
        <ul className="mt-1.5 max-h-60 list-disc space-y-1 overflow-y-auto pl-5 text-body text-fg">
          {offer.notes.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : (
        <div className="mt-1.5 text-body text-fg-faint">{u.noNotes}</div>
      )}

      <div className="mt-4 rounded-md border border-ink-800 bg-ink-925 px-3 py-2.5">
        {p.kind === "downloading" ? (
          <>
            <div className="text-meta text-fg-muted">
              {u.downloadingInBackground(Math.round(p.percent))}
            </div>
            <div className="mt-2 h-[5px] overflow-hidden rounded-full bg-ink-800">
              <span
                className="block h-full rounded-full bg-accent transition-all"
                style={{ width: `${Math.round(p.percent)}%` }}
              />
            </div>
          </>
        ) : ready ? (
          <div className="flex items-center gap-1.5 text-meta text-fg">
            <Icon name="check" size={12} className="text-primary" />
            {u.readyToRestart}
          </div>
        ) : (
          <div className="text-meta text-fg-muted">{u.preparing}</div>
        )}
      </div>

      <div className="mt-5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => update.skip(offer.version)}
          className="rounded-md px-2 py-1.5 text-aux text-fg-faint transition-colors hover:bg-ink-800 hover:text-fg-muted"
        >
          {u.skipVersion}
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={later}
          className="rounded-md border border-ink-700 px-3 py-1.5 text-aux text-fg-muted transition-colors hover:border-ink-600 hover:text-fg"
        >
          {u.later}
        </button>
        <button
          type="button"
          disabled={!ready}
          onClick={update.install}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-aux font-medium text-ink-950 transition-colors hover:bg-primary-bright disabled:opacity-40"
        >
          <Icon name="rotate-ccw" size={13} />
          {ready ? u.restartToUpdate : u.downloadingShort}
        </button>
      </div>
      <div className="mt-3 text-meta text-fg-faint">{u.laterHint}</div>
    </ModalShell>
  );
}
