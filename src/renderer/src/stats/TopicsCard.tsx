import { Fragment, useContext, useMemo, useState } from "react";
import type { StatsBySession } from "@shared/stats";
import { productForSession } from "@shared/products";
import { useI18n } from "../i18n";
import { Swatch } from "../ui/atoms";
import { ProductsContext } from "../products/products-context";
import { StatsCard, CardRegion } from "./shared";

const BATCH = 8;
const OTHER = "__other__";

interface TopicRow {
  key: string;
  name: string;
  color: string;
  sessions: number;
  turns: number;
  tokens: number;
}

/**
 * Usage by topic (fork feature, 2026-10-29). Most sessions start in one scratch folder, so By project
 * can't tell products apart; this folds the By-session rows by the topic each session belongs to (the
 * same assignment the sidebar groups by). Sessions without a topic form one "No topic" row.
 */
export function TopicsCard({ rows }: { rows: StatsBySession[] }) {
  const { t } = useI18n();
  const products = useContext(ProductsContext);
  const [visible, setVisible] = useState(BATCH);
  const topics = useMemo(() => {
    if (!products) return [];
    const by = new Map<string, TopicRow>();
    for (const r of rows) {
      const key =
        productForSession(products, {
          id: r.sessionId,
          title: r.title ?? "",
        }) ?? OTHER;
      const p = key === OTHER ? undefined : products.products[key];
      const row = by.get(key) ?? {
        key,
        name: p?.name ?? t.stats.byTopic.other,
        color: p?.color ?? "var(--color-ink-700)",
        sessions: 0,
        turns: 0,
        tokens: 0,
      };
      row.sessions += 1;
      row.turns += r.turns;
      row.tokens += r.totalTokens;
      by.set(key, row);
    }
    return [...by.values()]
      .filter((r) => r.tokens > 0)
      .sort((a, b) => b.tokens - a.tokens);
  }, [rows, products, t]);
  if (topics.length < 2) return null;

  const total = topics.reduce((a, r) => a + r.tokens, 0);
  const shown = topics.slice(0, visible);
  const max = Math.max(...shown.map((r) => r.tokens), 0);
  const rest = topics.length - shown.length;
  const head = "whitespace-nowrap pb-1.5 font-normal";
  const num =
    "pt-2 pl-2 text-right align-middle font-mono tabular-nums text-fg-muted";
  return (
    <StatsCard>
      <CardRegion title={t.stats.byTopic.title}>
        <table className="w-full table-fixed text-aux">
          <colgroup>
            <col className="w-[46%]" />
            <col className="w-[13%]" />
            <col className="w-[13%]" />
            <col className="w-[13%]" />
            <col className="w-[15%]" />
          </colgroup>
          <thead>
            <tr className="text-label uppercase tracking-wide text-fg-faint">
              <th scope="col" className={`${head} text-left`}>
                {t.stats.byTopic.name}
              </th>
              <th scope="col" className={`${head} text-right`}>
                {t.stats.byTopic.sessions}
              </th>
              <th scope="col" className={`${head} text-right`}>
                {t.stats.byTopic.turns}
              </th>
              <th scope="col" className={`${head} text-right`}>
                {t.stats.byTopic.share}
              </th>
              <th scope="col" className={`${head} text-right`}>
                {t.stats.shared.tokensHeader}
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <Fragment key={r.key}>
                <tr className={i === 0 ? "" : "border-t border-ink-850"}>
                  <td className="pt-2 pr-3 align-middle">
                    <span className="flex min-w-0 items-center gap-2">
                      <Swatch color={r.color} />
                      <span className="truncate text-fg">{r.name}</span>
                    </span>
                  </td>
                  <td className={num}>{r.sessions}</td>
                  <td className={num}>{r.turns.toLocaleString("en-US")}</td>
                  <td className={num}>
                    {total > 0
                      ? `${Math.round((r.tokens / total) * 100)}%`
                      : "-"}
                  </td>
                  <td className={num}>{t.numbers.tokensShort(r.tokens)}</td>
                </tr>
                <tr>
                  <td colSpan={5} className="pb-2 pt-1.5">
                    <div className="h-[5px] overflow-hidden rounded-full bg-ink-850">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${max > 0 ? (r.tokens / max) * 100 : 0}%`,
                          background: r.color,
                        }}
                      />
                    </div>
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
        {rest > 0 && (
          <button
            type="button"
            onClick={() => setVisible((v) => v + BATCH)}
            className="mt-2 text-meta text-fg-faint transition-colors hover:text-fg-muted"
          >
            {t.stats.shared.showMore(Math.min(BATCH, rest), topics.length)}
          </button>
        )}
      </CardRegion>
    </StatsCard>
  );
}
