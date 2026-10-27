// Stand-in for sonner inside the HUD windows: Agent HUD's Settings and Statistics raise a toast when
// an action fails. Code-by-wire does not ship sonner, so a failure goes to the console instead.
type Options = { description?: string };
const log =
  (level: "warn" | "error" | "info") => (title: unknown, options?: Options) =>
    console[level](String(title), options?.description ?? "");

export const toast = Object.assign(log("info"), {
  success: log("info"),
  warning: log("warn"),
  error: log("error"),
});

export function Toaster(_props: Record<string, unknown>) {
  return null;
}
