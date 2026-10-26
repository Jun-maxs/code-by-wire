import { describe, expect, it } from "vitest";
import { trashSessionFiles } from "@shared/session-trash";

function deps(files: string[], transcript: string | null, fail?: string) {
  const trashed: string[] = [];
  return {
    trashed,
    d: {
      resolveTranscriptPath: () => transcript,
      exists: (p: string) => files.includes(p),
      trash: (p: string) => {
        if (p === fail) return Promise.reject(new Error("locked"));
        trashed.push(p);
        return Promise.resolve();
      },
    },
  };
}

describe("trashSessionFiles", () => {
  it("trashes the transcript and its subagent sidecar dir", async () => {
    const { d, trashed } = deps(["/p/a.jsonl", "/p/a"], "/p/a.jsonl");
    expect(await trashSessionFiles(d, "a", false)).toEqual({
      ok: true,
      trashed: ["/p/a.jsonl", "/p/a"],
    });
    expect(trashed).toEqual(["/p/a.jsonl", "/p/a"]);
  });

  it("trashes a lone rollout when there is no sidecar", async () => {
    const { d } = deps(["/r/rollout-1.jsonl"], "/r/rollout-1.jsonl");
    expect(await trashSessionFiles(d, "x", false)).toEqual({
      ok: true,
      trashed: ["/r/rollout-1.jsonl"],
    });
  });

  it("refuses a live session without touching files", async () => {
    const { d, trashed } = deps(["/p/a.jsonl"], "/p/a.jsonl");
    expect(await trashSessionFiles(d, "a", true)).toEqual({
      ok: false,
      reason: "live",
    });
    expect(trashed).toEqual([]);
  });

  it("reports a missing transcript", async () => {
    const { d } = deps([], null);
    expect((await trashSessionFiles(d, "a", false)).ok).toBe(false);
  });

  it("reports a trash failure with its message", async () => {
    const { d } = deps(["/p/a.jsonl"], "/p/a.jsonl", "/p/a.jsonl");
    expect(await trashSessionFiles(d, "a", false)).toEqual({
      ok: false,
      reason: "failed",
      detail: "locked",
    });
  });
});
