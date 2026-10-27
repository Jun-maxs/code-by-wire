import { useContext, useLayoutEffect, useState } from "react";
import { shortTopicName } from "@shared/products";
import { createPortal } from "react-dom";
import type { Session } from "@shared/types";
import { cx } from "../ui/atoms";
import { Icon, type IconName } from "../ui/icons";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { useI18n } from "../i18n";
import { MENU_WIDTH, type SessionMenuController } from "./use-session-menu";
import { DiagnosticReportModal } from "./DiagnosticReportModal";
import {
  ProductsContext,
  ProductsRefreshContext,
  useSessionProduct,
} from "../products/products-context";

/** The portaled dropdown body shared by every session-menu trigger: seven always-rendered action rows
 *  (only `disabled`/`title` vary — the design's "never hide an action, dim the unavailable ones with a
 *  reason" rule) plus the confirm dialogs Resume/Fork/End can raise. Pure rendering — all state lives in
 *  `useSessionMenu`. */
export function SessionMenuDropdown({
  session,
  menu,
}: {
  session: Session;
  menu: SessionMenuController;
}) {
  const {
    open,
    pos,
    menuId,
    menuRef,
    closeMenu,
    openEdit,
    diagnosticOpen,
    openDiagnostic,
    closeDiagnostic,
    pinned,
    togglePin,
    items,
    openInBusy,
    openInError,
    handleOpenIn,
    resume,
    fork,
    end,
    live,
    resumeDisabled,
    resumeTitle,
    forkDisabled,
    forkTitle,
    endTitle,
  } = menu;
  const { t } = useI18n();
  // Fork feature: delete an ended session (transcript → OS trash). The row drops on the next poll.
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const canDelete = session.state === "ended";
  // Fork feature: put the session under a topic by hand (wins over the workbench's guesses).
  const products = useContext(ProductsContext);
  const refreshProducts = useContext(ProductsRefreshContext);
  const currentTopic = useSessionProduct(session);
  const [topicsOpen, setTopicsOpen] = useState(false);
  const assignTopic = (key: string): void => {
    closeMenu();
    setTopicsOpen(false);
    void window.api
      .assignSessionTopic(session.id, key)
      .then(refreshProducts)
      .catch(() => undefined);
  };
  // Keep the whole menu inside the window: a row low in the list (or the topic list opening)
  // would otherwise push its bottom rows off-screen.
  const [top, setTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!open || !pos || !el) return setTop(null);
    const fit = window.innerHeight - el.offsetHeight - 8;
    setTop(Math.max(8, Math.min(pos.top, fit)));
  }, [open, pos, topicsOpen, menuRef]);
  const topics = products
    ? Object.values(products.products).sort((a, b) =>
        a.name.localeCompare(b.name),
      )
    : [];
  const confirmDelete = (): void => {
    setDeleteConfirm(false);
    void window.api.trashSession(session.id).then((r) => {
      if (!r.ok)
        setDeleteError(t.shell.sessionMenu.deleteFailed(r.detail ?? r.reason));
    });
  };

  return (
    <>
      {open && pos
        ? createPortal(
            <div
              id={menuId}
              ref={menuRef}
              role="menu"
              style={{
                position: "fixed",
                left: pos.left,
                top: top ?? pos.top,
                width: MENU_WIDTH,
              }}
              className="z-50 rounded-lg border border-(--ui-stroke-secondary) bg-[color-mix(in_srgb,var(--ui-bg-elevated)_96%,transparent)] p-1.5 shadow-(--shadow-md) backdrop-blur-xl"
            >
              <MenuItem
                icon={pinned ? "pin-off" : "pin"}
                label={
                  pinned ? t.shell.sessionMenu.unpin : t.shell.sessionMenu.pin
                }
                onClick={togglePin}
              />
              <MenuItem
                icon="copy"
                label={t.shell.sessionMenu.copySessionId}
                title={session.id}
                onClick={() => {
                  void window.api.clipboardWriteText(session.id);
                  closeMenu();
                }}
              />
              <MenuItem
                icon="stethoscope"
                label={t.shell.sessionMenu.diagnosticReport}
                onClick={openDiagnostic}
              />
              <MenuItem
                icon="pencil"
                label={t.shell.sessionMenu.rename}
                onClick={openEdit}
              />
              {topics.length > 0 && (
                <>
                  <MenuItem
                    icon="tag"
                    label={
                      currentTopic
                        ? `${t.shell.sessionMenu.topic} · ${shortTopicName(currentTopic.name)}`
                        : t.shell.sessionMenu.topic
                    }
                    onClick={() => setTopicsOpen((v) => !v)}
                  />
                  {topicsOpen && (
                    <div className="ml-6 flex max-h-48 flex-col overflow-y-auto border-l border-(--ui-stroke-tertiary) pl-1">
                      {topics.map((p) => (
                        <button
                          key={p.key}
                          type="button"
                          role="menuitemradio"
                          aria-checked={currentTopic?.key === p.key}
                          onClick={() => assignTopic(p.key)}
                          title={p.name}
                          className="flex items-center gap-2 rounded-md px-2 py-1 text-left text-[0.75rem] text-(--ui-text-secondary) hover:bg-(--ui-row-hover-background) hover:text-fg"
                        >
                          <span
                            aria-hidden
                            className="size-1.5 shrink-0 rounded-full"
                            style={{ background: p.color }}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {shortTopicName(p.name)}
                          </span>
                          {currentTopic?.key === p.key && (
                            <Icon name="check" size={12} />
                          )}
                        </button>
                      ))}
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={!currentTopic}
                        onClick={() => assignTopic("")}
                        className="flex items-center gap-2 rounded-md px-2 py-1 text-left text-[0.75rem] text-(--ui-text-tertiary) hover:bg-(--ui-row-hover-background) hover:text-fg"
                      >
                        <span className="size-1.5 shrink-0" />
                        <span className="flex-1">
                          {t.shell.sessionMenu.noTopic}
                        </span>
                      </button>
                    </div>
                  )}
                </>
              )}

              {resume.error && (
                <p role="alert" className="px-2 py-1 text-xs text-danger">
                  {resume.error}
                </p>
              )}
              <MenuItem
                icon="git-pull-request-arrow"
                label={
                  resume.busy
                    ? t.shell.sessionMenu.resuming
                    : t.shell.sessionMenu.resume
                }
                onClick={resume.request}
                disabled={resumeDisabled || resume.busy}
                title={resumeTitle}
              />

              {fork.error && (
                <p role="alert" className="px-2 py-1 text-xs text-danger">
                  {fork.error}
                </p>
              )}
              <MenuItem
                icon="git-branch"
                label={
                  fork.busy
                    ? t.shell.sessionMenu.forking
                    : t.shell.sessionMenu.fork
                }
                onClick={fork.request}
                disabled={forkDisabled || fork.busy}
                title={forkTitle}
              />

              <MenuItem
                icon="square"
                label={t.shell.sessionMenu.endSession}
                onClick={end.request}
                disabled={!live}
                title={endTitle}
                danger
              />
              <MenuItem
                icon="archive"
                label={t.shell.sessionMenu.deleteSession}
                onClick={() => {
                  setDeleteError(null);
                  setDeleteConfirm(true);
                  closeMenu();
                }}
                disabled={!canDelete}
                title={
                  canDelete ? undefined : t.shell.sessionMenu.deleteLiveTitle
                }
                danger
              />

              <div
                role="separator"
                aria-orientation="horizontal"
                className="my-1 h-px bg-(--ui-stroke-tertiary)"
              />

              <div className="px-2 pb-1 pt-0.5 text-[0.64rem] font-semibold uppercase tracking-[0.16em] text-(--theme-primary)">
                {t.shell.sessionMenu.openIn}
              </div>
              {items.map((item) => (
                <MenuItem
                  key={item.key}
                  icon={item.icon}
                  label={item.label}
                  onClick={() => void handleOpenIn(item.key)}
                  disabled={openInBusy}
                />
              ))}
              {openInError && (
                <p role="alert" className="mt-1 px-2 py-1 text-xs text-danger">
                  {openInError}
                </p>
              )}
            </div>,
            document.body,
          )
        : null}

      {resume.confirmOpen && (
        <ConfirmDialog
          title={t.shell.sessionMenu.resumeConfirmTitle}
          body={t.shell.sessionMenu.resumeConfirmBody}
          confirmLabel={t.shell.sessionMenu.resumeConfirmLabel}
          onCancel={resume.confirmNo}
          onConfirm={resume.confirmYes}
        />
      )}
      {fork.confirmOpen && (
        <ConfirmDialog
          title={t.shell.sessionMenu.forkConfirmTitle}
          body={t.shell.sessionMenu.forkConfirmBody}
          confirmLabel={t.shell.sessionMenu.forkConfirmLabel}
          onCancel={fork.confirmNo}
          onConfirm={fork.confirmYes}
        />
      )}
      {end.confirmOpen && (
        <ConfirmDialog
          title={t.shell.sessionMenu.endConfirmTitle}
          body={t.shell.sessionMenu.endConfirmBody}
          confirmLabel={t.shell.sessionMenu.endSession}
          tone="danger"
          onConfirm={end.confirmYes}
          onCancel={end.confirmNo}
        />
      )}
      {deleteConfirm && (
        <ConfirmDialog
          title={t.shell.sessionMenu.deleteConfirmTitle}
          body={t.shell.sessionMenu.deleteConfirmBody}
          confirmLabel={t.shell.sessionMenu.deleteSession}
          tone="danger"
          onConfirm={confirmDelete}
          onCancel={() => setDeleteConfirm(false)}
        />
      )}
      {deleteError && (
        <ConfirmDialog
          title={t.shell.sessionMenu.deleteConfirmTitle}
          body={deleteError}
          confirmLabel={t.common.close}
          onConfirm={() => setDeleteError(null)}
          onCancel={() => setDeleteError(null)}
        />
      )}
      {diagnosticOpen && (
        <DiagnosticReportModal
          sessionId={session.id}
          onClose={closeDiagnostic}
        />
      )}
    </>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
  title,
  danger,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cx(
        "flex w-full items-center gap-2.5 rounded-xs px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:bg-(--ui-control-hover-background) disabled:cursor-default disabled:opacity-40",
        danger
          ? "text-danger enabled:hover:bg-danger/10"
          : "text-fg-muted enabled:hover:bg-(--ui-control-hover-background) enabled:hover:text-fg",
      )}
    >
      <Icon name={icon} size={13} />
      {label}
    </button>
  );
}
