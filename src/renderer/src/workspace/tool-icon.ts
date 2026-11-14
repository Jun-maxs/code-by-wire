import type { IconName } from "../ui/icon-names";

/** Per-tool glyph for the transcript tool row and diff row. Task/Agent render as subagent dispatches
 *  and are not listed here. Unknown tools fall back to the terminal glyph. JSX-free so the node
 *  program (tests) can import it. */
const TOOL_ICONS: Record<string, IconName> = {
  Bash: "terminal",
  exec: "terminal",
  shell: "terminal",
  run_command: "terminal",
  Read: "code",
  read_file: "code",
  view_file: "code",
  Edit: "pencil",
  Write: "pencil",
  MultiEdit: "pencil",
  apply_patch: "pencil",
  edit_file: "pencil",
  write_file: "pencil",
  replace_file_content: "pencil",
  multi_replace_file_content: "pencil",
  write_to_file: "pencil",
  Grep: "search",
  Glob: "search",
  grep_search: "search",
  find_by_name: "search",
  list_dir: "folder",
  WebFetch: "globe",
  WebSearch: "globe",
  search_web: "globe",
  web_search: "globe",
};

export function toolIcon(name: string): IconName {
  return TOOL_ICONS[name] ?? "terminal";
}
