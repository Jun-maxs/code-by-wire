/**
 * A schema-less protobuf wire reader, just enough for the Antigravity CLI's conversation store: agy
 * keeps every step as protobuf blobs in SQLite and ships no schema, so readers address fields by
 * number (see conversation.ts for the numbers in use). Tolerant: a blob that doesn't parse as a clean
 * message reads as no fields, never a throw.
 */

/** One field occurrence: varints as numbers, length-delimited fields as raw bytes. */
export type PbValue = number | Uint8Array;

export type PbMessage = Map<number, PbValue[]>;

const EMPTY: PbMessage = new Map();
const utf8 = new TextDecoder("utf-8", { fatal: false });

function readVarint(b: Uint8Array, at: number): [number, number] | null {
  let value = 0;
  let scale = 1;
  for (let i = at; i < b.length && i < at + 10; i++) {
    const byte = b[i];
    value += (byte & 0x7f) * scale;
    scale *= 128;
    if (byte < 0x80) return [value, i + 1];
  }
  return null;
}

/** Parse one message level. Returns the empty message when the bytes aren't a clean message. */
export function pbParse(b: Uint8Array | null | undefined): PbMessage {
  if (!b || b.length === 0) return EMPTY;
  const out: PbMessage = new Map();
  let i = 0;
  while (i < b.length) {
    const key = readVarint(b, i);
    if (!key) return EMPTY;
    i = key[1];
    const field = Math.floor(key[0] / 8);
    const wire = key[0] % 8;
    if (field === 0) return EMPTY;
    let value: PbValue;
    if (wire === 0) {
      const v = readVarint(b, i);
      if (!v) return EMPTY;
      value = v[0];
      i = v[1];
    } else if (wire === 2) {
      const len = readVarint(b, i);
      if (!len || len[1] + len[0] > b.length) return EMPTY;
      value = b.subarray(len[1], len[1] + len[0]);
      i = len[1] + len[0];
    } else if (wire === 1) {
      if (i + 8 > b.length) return EMPTY;
      value = b.subarray(i, i + 8);
      i += 8;
    } else if (wire === 5) {
      if (i + 4 > b.length) return EMPTY;
      value = b.subarray(i, i + 4);
      i += 4;
    } else {
      return EMPTY;
    }
    const list = out.get(field);
    if (list) list.push(value);
    else out.set(field, [value]);
  }
  return out;
}

/** Every occurrence of a length-delimited field, parsed as a message. */
export function pbMessages(m: PbMessage, field: number): PbMessage[] {
  return (m.get(field) ?? [])
    .filter((v): v is Uint8Array => v instanceof Uint8Array)
    .map(pbParse);
}

/** The first occurrence of a field parsed as a message (the empty message when absent). */
export function pbMessage(m: PbMessage, field: number): PbMessage {
  return pbMessages(m, field)[0] ?? EMPTY;
}

/** Walk a dotted field path through nested messages, e.g. pbAt(m, 20, 7). */
export function pbAt(m: PbMessage, ...path: number[]): PbMessage {
  let cur = m;
  for (const f of path) cur = pbMessage(cur, f);
  return cur;
}

/** A varint field's first value, else 0. */
export function pbNum(m: PbMessage, field: number): number {
  const v = m.get(field)?.[0];
  return typeof v === "number" ? v : 0;
}

/** A string field's first value, else "". */
export function pbStr(m: PbMessage, field: number): string {
  const v = m.get(field)?.[0];
  return v instanceof Uint8Array ? utf8.decode(v) : "";
}

/** Every value of a repeated string field. */
export function pbStrs(m: PbMessage, field: number): string[] {
  return (m.get(field) ?? [])
    .filter((v): v is Uint8Array => v instanceof Uint8Array)
    .map((v) => utf8.decode(v));
}
