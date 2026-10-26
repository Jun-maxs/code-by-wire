/** Complete BotSpec.swift dimensions; coordinates are x0,y0,x1,y1 in body radii. */
export interface Fin {
  root: Point;
  angle: number;
  length: number;
  base: number;
  tip: number;
  sweep: number;
  hand: number;
}
export type Box = [number, number, number, number]; // x0, y0, x1, y1, in body radii
export type Point = [number, number];
export type Shape =
  | { kind: "circle" }
  | { kind: "outline"; keep: number; smooth: number }
  | { kind: "polygon"; sides: number; rotation: number; round: number }
  | {
      kind: "rect";
      width: number;
      height: number;
      round: number;
      skew?: number;
    }
  | { kind: "cat" }
  | { kind: "bob" };
export type Paint =
  | string
  | { colors: string[]; from: Point; to: Point }
  | { colors: string[]; center: Point; inner: number; outer: number };
export type Decor =
  | {
      kind: "blocks" | "soft";
      boxes: Box[];
      color: string;
      round?: number;
      follows?: boolean;
    }
  | { kind: "notch"; points: Point[] }
  | { kind: "cut"; boxes: Box[] }
  | { kind: "line"; points: Point[]; width: number }
  | { kind: "fins"; fins: Fin[]; color: string }
  | { kind: "feelers"; lines: Point[][]; color: string; width: number };
export interface BotSpec {
  radius: number;
  center: Point;
  reach: number;
  shape: Shape;
  paint?: Paint;
  face: Point;
  eye: {
    height: number;
    width: number;
    round: number;
    spread: number;
    across?: number;
  };
  eyeColor?: string;
  spin?: number;
  settle?: number;
  decor?: Decor[];
  ring?: {
    radiusX: number;
    radiusY: number;
    drop: number;
    tilt: number;
    width: number;
  };
  patch?: { box: Box; round: number; paint: Paint };
  stroke?: string;
  pupil?: string;
  signAt?: Point;
  unpainted?: Box[];
  crossesEyes?: boolean;
  keeps?: Box;
  ownEyes?: Box[];
  limbs?: { arms: Box[]; legs: Box[]; pixel: number };
}
const basic: BotSpec = {
  radius: 0.36,
  center: [0.5, 0.5],
  reach: 1,
  shape: { kind: "circle" },
  face: [0, 0],
  eye: { height: 0.62, width: 0.25, round: 1, spread: 0.34 },
};
const spec = (
  value: Partial<Omit<BotSpec, "eye">> & { eye?: Partial<BotSpec["eye"]> },
): BotSpec => ({ ...basic, ...value, eye: { ...basic.eye, ...value.eye } });
const mono = (light: boolean, dark = "#ffffff") => (light ? "#1d1d1f" : dark);

/** Numeric dimensions, outlines, eye placement and decoration from the original BotSpec.table. */
export function botSpecs(light: boolean): Record<string, BotSpec> {
  return {
    claude: spec({
      radius: 0.22,
      center: [0.5, 0.445],
      reach: 0.7,
      shape: { kind: "rect", width: 0.66, height: 0.44, round: 0.008 },
      face: [0, -0.25],
      eye: { height: 0.64, width: 0.32, round: 0, across: 0.875 },
      limbs: {
        arms: [
          [-2, 0, -1.5, 0.5],
          [1.5, 0, 2, 0.5],
        ],
        legs: [
          [-1.25, 1, -1, 1.5],
          [-0.75, 1, -0.5, 1.5],
          [0.5, 1, 0.75, 1.5],
          [1, 1, 1.25, 1.5],
        ],
        pixel: 0.5,
      },
    }),
    openai: spec({
      radius: 0.37,
      shape: { kind: "outline", keep: 1.1, smooth: 5 },
      spin: 7,
      crossesEyes: true,
    }),
    pi: spec({
      center: [0.5, 0.31],
      reach: 0.3,
      shape: { kind: "rect", width: 0.9, height: 0.29, round: 0.02 },
      eye: { height: 0.3, width: 0.3, round: 0 },
      eyeColor: light ? "#f5f5f7" : undefined,
      decor: [
        {
          kind: "blocks",
          boxes: [
            [-0.8, 0.36, -0.3, 1.5],
            [0.3, 0.36, 0.8, 1.5],
          ],
          color: mono(light),
        },
      ],
    }),
  };
}
