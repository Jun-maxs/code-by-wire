/**
 * Drop the italic attribute (SGR 3) from terminal output (fork change, 2026-10-28). CJK fonts have no
 * italic face, so xterm's renderer slants the glyphs synthetically and Claude Code's quoted and
 * emphasized text becomes hard to read. Every other attribute in the sequence is kept; a sequence
 * that only turned italic on is removed outright (an empty `ESC[m` would mean reset).
 *
 * Works per chunk: a sequence split across two writes keeps its italic, which is rare and harmless.
 */
const SGR = /\x1b\[([0-9;:]*)m/g;

export function stripItalic(data: string): string {
  if (!data.includes("\x1b[")) return data;
  return data.replace(SGR, (seq, body: string) => {
    if (!body.includes("3")) return seq;
    const params = body.split(";");
    const out: string[] = [];
    for (let i = 0; i < params.length; i++) {
      const p = params[i];
      // 38/48/58 ;5;n or ;2;r;g;b carry color numbers that may be a literal 3
      if ((p === "38" || p === "48" || p === "58") && i + 1 < params.length) {
        const n = params[i + 1] === "5" ? 2 : params[i + 1] === "2" ? 4 : 1;
        out.push(...params.slice(i, i + 1 + n));
        i += n;
        continue;
      }
      if (p !== "3") out.push(p);
    }
    if (out.length === params.length) return seq;
    return out.length ? `\x1b[${out.join(";")}m` : "";
  });
}
