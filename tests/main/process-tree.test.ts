import { describe, it, expect } from "vitest";
import { parseParentMap } from "../../src/main/process-tree";

describe("parseParentMap", () => {
  it("reads `<pid> <ppid>` lines from either reader, CRLF or LF", () => {
    expect(parseParentMap("4744 24044\r\n1540 4744\r\n")).toEqual(
      new Map([
        [4744, 24044],
        [1540, 4744],
      ]),
    );
    expect(parseParentMap("    1     0\n  412     1\n")).toEqual(
      new Map([
        [1, 0],
        [412, 1],
      ]),
    );
  });

  it("skips blank and malformed lines", () => {
    expect(parseParentMap("\nPID PPID\n12 x\n7 3\n")).toEqual(
      new Map([[7, 3]]),
    );
  });
});
