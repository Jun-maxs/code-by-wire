import { AGENT_IDS, type AgentId } from "@shared/agents";

// Key stays at v2 across the removal of `visibility` (issue #431): the loader reads field by
// field, so a blob an older build wrote still yields valid agent and icon preferences.
const STORAGE_KEY = "cbw.sessionsList.v2";

export const DEFAULT_SESSIONS_LIST_PREFERENCES = {
  showAgentIcons: true,
  agent: "all",
} as const;

export type SessionsListPreferences = {
  showAgentIcons: boolean;
  agent: "all" | AgentId;
  /** Fork feature: how sidebar sessions group. Absent = by topic (product card), the fork's
   *  default since 2026-10-28: nearly every session starts in one scratch folder, so folder groups
   *  lump everything together. "folder" keeps upstream's grouping. */
  grouping?: "product" | "folder";
};

export function loadSessionsListPreferences(
  storage: Storage,
): SessionsListPreferences {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return { ...DEFAULT_SESSIONS_LIST_PREFERENCES };

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null)
      return { ...DEFAULT_SESSIONS_LIST_PREFERENCES };
    const value = parsed as Record<string, unknown>;
    return {
      showAgentIcons:
        typeof value.showAgentIcons === "boolean"
          ? value.showAgentIcons
          : DEFAULT_SESSIONS_LIST_PREFERENCES.showAgentIcons,
      agent:
        value.agent === "all" || AGENT_IDS.includes(value.agent as AgentId)
          ? (value.agent as "all" | AgentId)
          : DEFAULT_SESSIONS_LIST_PREFERENCES.agent,
      ...(value.grouping === "folder" ? { grouping: "folder" as const } : {}),
    };
  } catch {
    return { ...DEFAULT_SESSIONS_LIST_PREFERENCES };
  }
}

export function saveSessionsListPreferences(
  storage: Storage,
  value: SessionsListPreferences,
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage can be disabled or full; preferences remain usable in memory.
  }
}
