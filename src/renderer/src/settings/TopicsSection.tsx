import { useContext, useEffect, useState } from "react";
import {
  TOPIC_KEY_RE,
  type CardRun,
  type ProductInfo,
  type TopicInput,
} from "@shared/products";
import {
  ProductsContext,
  ProductsRefreshContext,
} from "../products/products-context";
import { PageHeader, Card } from "../shell/page-primitives";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Icon } from "../ui/icons";
import { cx } from "../ui/atoms";
import { useI18n } from "../i18n";
import { RailButton } from "./system-primitives";

// Same hues the sidebar falls back to (shared/products PALETTE), offered as the color picker.
const COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
];

/**
 * Fork feature — Settings → Topics: the workbench's product topics as a list. Each topic shows its
 * trigger words, how many sessions it holds and its card's age; it can be edited, deleted, and its
 * card (re)generated in the background. "New topic" opens the same form at the top of the list.
 */
export function TopicsSection() {
  const { t } = useI18n();
  const data = useContext(ProductsContext);
  const refresh = useContext(ProductsRefreshContext);
  const [adding, setAdding] = useState(false);
  const running = Object.values(data?.runs ?? {}).some((r) => r.ok === null);

  // Poll while a card is being written so the row flips to its result without waiting for the
  // provider's slow poll.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => refresh(), 2000);
    return () => clearInterval(timer);
  }, [running, refresh]);

  const topics = Object.values(data?.products ?? {}).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const counts: Record<string, number> = {};
  for (const key of Object.values(data?.bySession ?? {}))
    if (key) counts[key] = (counts[key] ?? 0) + 1;

  return (
    <>
      <PageHeader
        title={t.settings.topics.title}
        lede={t.settings.topics.lede}
        right={
          data && !adding ? (
            <RailButton onClick={() => setAdding(true)}>
              <Icon name="plus" size={13} />
              {t.settings.topics.add}
            </RailButton>
          ) : undefined
        }
      />
      {!data ? (
        <p className="text-body text-fg-muted">
          {t.settings.topics.noWorkbench}
        </p>
      ) : (
        <Card title={t.settings.topics.listTitle}>
          {adding && (
            <TopicForm
              taken={Object.keys(data.products)}
              onCancel={() => setAdding(false)}
              onSaved={() => setAdding(false)}
            />
          )}
          {topics.length === 0 && !adding && (
            <p className="px-4 py-3 text-body text-fg-muted">
              {t.settings.topics.empty}
            </p>
          )}
          {topics.map((p, i) => (
            <TopicRow
              key={p.key}
              topic={p}
              sessions={counts[p.key] ?? 0}
              run={data.runs[p.key]}
              first={i === 0 && !adding}
            />
          ))}
        </Card>
      )}
    </>
  );
}

function TopicRow({
  topic,
  sessions,
  run,
  first,
}: {
  topic: ProductInfo;
  sessions: number;
  run?: CardRun;
  first: boolean;
}) {
  const { t, locale } = useI18n();
  const refresh = useContext(ProductsRefreshContext);
  const [editing, setEditing] = useState(false);
  const [card, setCard] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const busy = run?.ok === null;

  // Re-read an open card when a generation run finishes.
  const runDone = run && run.ok !== null ? run.startedAt : 0;
  useEffect(() => {
    if (card === null || !runDone) return;
    void window.api.readProductCard(topic.key).then((md) => setCard(md ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runDone]);

  const generate = (): void => {
    void window.api
      .generateCard(topic.key)
      .then(() => refresh())
      .catch(() => undefined);
  };
  const toggleCard = (): void => {
    if (card !== null) {
      setCard(null);
      return;
    }
    void window.api.readProductCard(topic.key).then((md) => setCard(md ?? ""));
  };
  const when = topic.updatedAt
    ? new Date(topic.updatedAt).toLocaleString(
        locale === "zh" ? "zh-CN" : "en-US",
        {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        },
      )
    : null;

  if (editing)
    return (
      <div className={cx(!first && "border-t border-ink-850")}>
        <TopicForm
          topic={topic}
          taken={[]}
          onCancel={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      </div>
    );

  return (
    <div
      className={cx(
        "flex flex-col gap-2 px-4 py-3",
        !first && "border-t border-ink-850",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-1.5 size-2.5 shrink-0 rounded-full"
          style={{ background: topic.color }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-body font-medium text-fg">
              {topic.name}
            </span>
            <span className="font-mono text-meta text-fg-faint">
              {topic.key}
            </span>
          </div>
          <div className="mt-0.5 text-meta text-fg-faint">
            {t.settings.topics.sessions(sessions)}
            {" · "}
            {when ? t.settings.topics.cardAt(when) : t.settings.topics.noCard}
          </div>
          {topic.keywords.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {topic.keywords.map((k) => (
                <span
                  key={k}
                  className="rounded-sm border border-ink-800 px-1.5 py-px font-mono text-[0.7rem] text-fg-muted"
                >
                  {k}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <RailButton onClick={generate} disabled={busy}>
            <Icon
              name={busy ? "loader-circle" : "sparkles"}
              size={13}
              className={busy ? "animate-spin" : undefined}
            />
            {topic.hasCard
              ? t.settings.topics.regenerate
              : t.settings.topics.generate}
          </RailButton>
          <IconButton
            label={t.settings.topics.edit}
            icon="pencil"
            onClick={() => setEditing(true)}
          />
          <IconButton
            label={t.settings.topics.delete}
            icon="trash"
            onClick={() => setConfirmDelete(true)}
          />
        </div>
      </div>

      {run && (
        <div
          role="status"
          className={cx(
            "ml-5.5 rounded-md px-2.5 py-1.5 text-meta",
            run.ok === null && "bg-ink-900 text-fg-muted",
            run.ok === true && "bg-ink-900 text-fg-muted",
            run.ok === false && "bg-danger/10 text-danger",
          )}
        >
          <div className="font-medium">
            {run.ok === null
              ? t.settings.topics.generating
              : run.ok
                ? t.settings.topics.generated
                : t.settings.topics.generateFailed}
          </div>
          {run.message && (
            <div className="mt-0.5 whitespace-pre-wrap">{run.message}</div>
          )}
        </div>
      )}

      {topic.hasCard && (
        <button
          type="button"
          onClick={toggleCard}
          className="ml-5.5 self-start text-meta text-fg-faint transition-colors hover:text-fg"
        >
          {card !== null
            ? t.settings.topics.hideCard
            : t.settings.topics.viewCard}
        </button>
      )}
      {card !== null && (
        <pre className="ml-5.5 max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-ink-800 bg-ink-950 px-3 py-2 font-sans text-meta leading-relaxed text-fg-muted">
          {card}
        </pre>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={t.settings.topics.deleteConfirmTitle(topic.name)}
          body={t.settings.topics.deleteConfirmBody}
          confirmLabel={t.settings.topics.delete}
          tone="danger"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            void window.api.deleteTopic(topic.key).then(refresh);
          }}
        />
      )}
    </div>
  );
}

function IconButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: "pencil" | "trash";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-md text-fg-faint transition-colors hover:bg-ink-900 hover:text-fg"
    >
      <Icon name={icon} size={14} />
    </button>
  );
}

/** A key suggestion from the name: its ascii words, else a short random one. */
function suggestKey(name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  return ascii || `topic-${Math.random().toString(36).slice(2, 6)}`;
}

function TopicForm({
  topic,
  taken,
  onCancel,
  onSaved,
}: {
  /** Absent → a new topic. */
  topic?: ProductInfo;
  /** Keys already in use (new topics only). */
  taken: string[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const refresh = useContext(ProductsRefreshContext);
  const [name, setName] = useState(topic?.name ?? "");
  const [key, setKey] = useState(topic?.key ?? "");
  const [keyTouched, setKeyTouched] = useState(Boolean(topic));
  const [color, setColor] = useState(
    topic?.color ?? COLORS[taken.length % COLORS.length],
  );
  const [keywords, setKeywords] = useState(topic?.keywords.join("\n") ?? "");
  const [repos, setRepos] = useState(topic?.repos.join("\n") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const effectiveKey = keyTouched ? key : suggestKey(name);
  const lines = (text: string) =>
    text
      .split(/\r?\n|,|，/)
      .map((s) => s.trim())
      .filter(Boolean);

  const save = async (andGenerate: boolean): Promise<void> => {
    const input: TopicInput = {
      key: effectiveKey,
      name: name.trim() || effectiveKey,
      color,
      keywords: lines(keywords),
      repos: lines(repos),
    };
    if (!TOPIC_KEY_RE.test(input.key))
      return setError(t.settings.topics.badKey);
    if (!topic && taken.includes(input.key))
      return setError(t.settings.topics.keyTaken);
    if (input.keywords.length === 0)
      return setError(t.settings.topics.needKeyword);
    setSaving(true);
    try {
      const next = await window.api.saveTopic(input);
      if (andGenerate) await window.api.generateCard(input.key);
      refresh(andGenerate ? undefined : next);
      onSaved();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const field =
    "w-full rounded-md border border-ink-700 bg-ink-950 px-2.5 py-1.5 text-body text-fg outline-none transition-colors focus:border-ink-600";
  return (
    <form
      className="flex flex-col gap-3 bg-ink-950/40 px-4 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save(false);
      }}
    >
      <div className="grid grid-cols-[1fr_12rem] gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-meta text-fg-faint">
            {t.settings.topics.name}
          </span>
          <input
            autoFocus
            className={field}
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span
            className="text-meta text-fg-faint"
            title={t.settings.topics.keyHint}
          >
            {t.settings.topics.key}
          </span>
          <input
            className={cx(field, "font-mono")}
            value={effectiveKey}
            disabled={Boolean(topic)}
            maxLength={40}
            onChange={(e) => {
              setKeyTouched(true);
              setKey(e.target.value.toLowerCase());
            }}
          />
        </label>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-meta text-fg-faint">
          {t.settings.topics.color}
        </span>
        <div className="flex gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              className={cx(
                "size-5 rounded-full ring-offset-2 ring-offset-ink-925 transition-shadow",
                color === c && "ring-2 ring-fg-muted",
              )}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-meta text-fg-faint">
          {t.settings.topics.keywords}
        </span>
        <textarea
          className={cx(field, "min-h-[4.5rem] font-mono text-[0.75rem]")}
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
        />
        <span className="text-meta text-fg-faint">
          {t.settings.topics.keywordsHint}
        </span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-meta text-fg-faint">
          {t.settings.topics.repos}
        </span>
        <textarea
          className={cx(field, "min-h-[2.75rem] font-mono text-[0.75rem]")}
          value={repos}
          onChange={(e) => setRepos(e.target.value)}
        />
        <span className="text-meta text-fg-faint">
          {t.settings.topics.reposHint}
        </span>
      </label>
      {error && (
        <p role="alert" className="text-meta text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-aux text-fg-muted transition-colors hover:text-fg"
        >
          {t.settings.topics.cancel}
        </button>
        <RailButton onClick={() => void save(false)} disabled={saving}>
          {t.settings.topics.save}
        </RailButton>
        <button
          type="button"
          disabled={saving}
          onClick={() => void save(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-aux font-medium text-ink-950 transition-colors hover:bg-primary-bright disabled:opacity-40"
        >
          <Icon name="sparkles" size={13} />
          {t.settings.topics.saveAndGenerate}
        </button>
      </div>
    </form>
  );
}
