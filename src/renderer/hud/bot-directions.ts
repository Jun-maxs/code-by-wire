import { useEffect, useMemo, useRef, useState } from "react";
import type { Snapshot } from "@agent-hud/protocol";
import { listen } from "@tauri-apps/api/event";
import {
  MarkDirector,
  monotonicDirection,
  type Direction,
} from "@agent-hud/hud/bots/mark-director";

const seconds = () => Date.now() / 1000;

/**
 * The Bots' directions, decided in this window. Agent HUD's host ran the same MarkDirector (its
 * Rust twin) over every snapshot and pushed `hud:bot-directions`; here the page reads its own
 * snapshot, wakes at the director's next change, and hears the panel's "looked" back from main
 * (`hud_bot_looked` → `hud:bot-looked`), so a seen badge clears as it did there.
 */
export function useLocalBotDirections(snapshot: Snapshot | null) {
  const director = useRef<MarkDirector | null>(null);
  director.current ??= new MarkDirector(seconds());
  const epochOffset = useRef(Date.now() / 1000 - performance.now() / 1000);
  const [directions, setDirections] = useState<Record<string, Direction>>({});
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const off = listen<string[] | null>("hud:bot-looked", ({ payload }) => {
      director.current?.looked(payload, seconds());
      setTick((n) => n + 1);
    });
    return () => void off.then((unlisten) => unlisten());
  }, []);

  useEffect(() => {
    const d = director.current!;
    const now = seconds();
    if (snapshot) d.read(snapshot, now);
    else d.advance(now);
    setDirections({ ...d.directions });
    const next = d.nextChange(now);
    if (next === null) return;
    const timer = setTimeout(
      () => setTick((n) => n + 1),
      Math.min(Math.max((next - now) * 1000, 1), 2_147_000_000),
    );
    return () => clearTimeout(timer);
  }, [snapshot, tick]);

  return useMemo(
    () =>
      Object.fromEntries(
        Object.entries(directions).map(([key, direction]) => [
          key,
          monotonicDirection(direction, epochOffset.current),
        ]),
      ),
    [directions],
  );
}
