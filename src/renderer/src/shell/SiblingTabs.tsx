import { useContext } from "react";
import { productForSession } from "@shared/products";
import type { Session } from "@shared/types";
import { ProductsContext } from "../products/products-context";
import { cx, Lamp } from "../ui/atoms";
import { useI18n } from "../i18n";
import { isPlaceholderTitle, isUnsentSession } from "./session-list-model";
import { SessionNavContext, topicSiblings } from "./session-nav";

/**
 * Fork (2026-11-01): the middle header's topic tabs — the selected session's siblings on the same
 * topic, beside its title. Clicking one opens it; the sidebar stays the full list.
 */
export function SiblingTabs({ session }: { session: Session }) {
  const { t } = useI18n();
  const nav = useContext(SessionNavContext);
  const products = useContext(ProductsContext);
  if (!nav || !products) return null;
  const siblings = topicSiblings(session, nav.sessions, (s) =>
    productForSession(products, s),
  );
  if (siblings.length === 0) return null;
  return (
    <div
      role="group"
      aria-label={t.shell.middleHeader.siblingsLabel}
      className="no-drag flex min-w-0 shrink items-center gap-1 overflow-hidden"
    >
      {siblings.map((s) => {
        const title = isUnsentSession(s)
          ? t.shell.sessionRow.unsentTitle
          : isPlaceholderTitle(s.title)
            ? t.shell.sessionRow.placeholderTitle
            : s.title;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => nav.select(s.id)}
            title={s.title}
            className={cx(
              "flex h-6 min-w-0 max-w-40 items-center gap-1.5 rounded-xs border border-transparent px-2 text-aux leading-none transition-colors duration-100 hover:border-(--ui-stroke-tertiary) hover:bg-(--ui-control-hover-background) hover:text-fg hover:transition-none",
              s.state === "ended" ? "text-fg-dim" : "text-fg-faint",
            )}
          >
            <span className="grid size-3.5 shrink-0 place-items-center">
              <Lamp state={s.state} management={s.management} />
            </span>
            <span className="truncate">{title}</span>
          </button>
        );
      })}
    </div>
  );
}
