import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ProductInfo } from "@shared/products";
import { useI18n } from "../i18n";

const OPEN_DELAY_MS = 350;
const CARD_WIDTH = 300;

/**
 * Wraps a sidebar row; hovering it for a moment shows the session's product card beside the sidebar:
 * name, domains (only when the card lists any), what's in progress, what's unfinished, and what's
 * waiting on the user. Portaled to <body> with fixed positioning because the sidebar is a clipped
 * scroll container. Pointer-transparent, so it never steals the row's clicks.
 */
export function ProductHoverCard({
  product,
  children,
}: {
  product: ProductInfo | null;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const anchor = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  if (!product) return <>{children}</>;

  const show = (): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const left = Math.min(r.right + 8, window.innerWidth - CARD_WIDTH - 8);
      const top = Math.max(8, Math.min(r.top - 4, window.innerHeight - 240));
      setPos({ left, top });
    }, OPEN_DELAY_MS);
  };
  const hide = (): void => {
    if (timer.current) clearTimeout(timer.current);
    setPos(null);
  };
  const labels = t.shell.sessionRow.product;

  return (
    <div
      ref={anchor}
      onMouseEnter={show}
      onMouseLeave={hide}
      onMouseDown={hide}
      className="min-w-0"
    >
      {children}
      {pos &&
        createPortal(
          <div
            role="tooltip"
            style={{ left: pos.left, top: pos.top, width: CARD_WIDTH }}
            className="pointer-events-none fixed z-50 rounded-lg border border-(--ui-stroke-secondary) bg-[color-mix(in_srgb,var(--ui-bg-elevated)_96%,transparent)] p-3 text-aux leading-snug text-fg-muted shadow-(--shadow-md) backdrop-blur-xl"
          >
            <div className="mb-1.5 flex items-center gap-1.5 text-body font-medium text-fg">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-[2px]"
                style={{ background: product.color }}
              />
              {product.name}
            </div>
            {product.domains.length > 0 && (
              <Row label={labels.domain}>{product.domains.join(" · ")}</Row>
            )}
            {product.doing && <Row label={labels.doing}>{product.doing}</Row>}
            {product.loose.length > 0 && (
              <Row label={labels.loose}>
                <List items={product.loose} />
              </Row>
            )}
            {product.decide.length > 0 && (
              <Row label={labels.decide}>
                <List items={product.decide} />
              </Row>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-1">
      <div className="text-meta text-fg-dim">{label}</div>
      <div className="break-words">{children}</div>
    </div>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-0.5 pl-4">
      {items.slice(0, 3).map((x) => (
        <li key={x}>{x}</li>
      ))}
    </ul>
  );
}
