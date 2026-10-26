// Stand-in for @tauri-apps/api/event inside the HUD window (see tauri-core.ts).
import { bridge } from "./bridge";

export type UnlistenFn = () => void;
export interface Event<T> {
  event: string;
  id: number;
  payload: T;
}

let nextId = 0;

/** Main sends each event to the window it concerns, so a window-target option needs no filtering. */
export function listen<T>(
  event: string,
  handler: (event: Event<T>) => void,
  _options?: unknown,
): Promise<UnlistenFn> {
  const off = bridge().on(event, (payload) =>
    handler({ event, id: ++nextId, payload: payload as T }),
  );
  return Promise.resolve(off);
}

export function emit(event: string, payload?: unknown): Promise<void> {
  bridge().emit(event, payload);
  return Promise.resolve();
}
