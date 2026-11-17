export type Vec2 = readonly [x: number, y: number];
export type Edge = readonly [from: Vec2, to: Vec2];
export type Polygon = readonly Vec2[];

export interface BBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * Rotates a footprint-local offset into board (file) coordinates.
 *
 * KiCad's angles are counter-clockwise *as displayed* while the file's y axis
 * points down, so this is a rotation by minus the angle. Getting the sign
 * backwards silently misplaces the pads of every rotated footprint — it cost
 * ezy54, where these tools come from, a PCB revision. `test/rotation.test.ts`
 * pins it against KiCad's own drill output.
 */
export const rotateKicad = ([x, y]: Vec2, degrees: number): Vec2 => {
  const a = toRadians(degrees);
  return [x * Math.cos(a) + y * Math.sin(a), -x * Math.sin(a) + y * Math.cos(a)];
};

/** Ordinary counter-clockwise rotation, for ergogen's y-up frame. */
export const rotateCcw = ([x, y]: Vec2, degrees: number): Vec2 => {
  const a = toRadians(degrees);
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
};

/**
 * Python's `math.radians` multiplies by a precomputed pi/180 rather than
 * dividing, and the two round differently in the last bit. Matching it keeps
 * this port's output identical to the tools it replaced.
 */
const DEGREE = Math.PI / 180;

export const toRadians = (degrees: number): number => degrees * DEGREE;

/**
 * Places a locally-defined offset into the frame at `origin`, rotating it
 * counter-clockwise on the way.
 *
 * Rotating and translating as two steps would give a different answer in the
 * last bit — `(y + dx·sin) + dy·cos` is not `y + (dx·sin + dy·cos)` in floating
 * point — and that is enough to reorder rows that are otherwise tied. Keep it
 * fused.
 */
export function placeCcw(origin: Vec2, [dx, dy]: Vec2, degrees: number): Vec2 {
  const a = toRadians(degrees);
  const [cos, sin] = [Math.cos(a), Math.sin(a)];
  return [origin[0] + dx * cos - dy * sin, origin[1] + dx * sin + dy * cos];
}

/**
 * Correctly-rounded hypotenuse, the way Python's `math.hypot` computes it.
 *
 * `Math.hypot` and a plain `sqrt(a*a + b*b)` are each off by an ulp often
 * enough — a third and a sixth of random inputs respectively — to reorder rows
 * that are otherwise tied, which makes this port's reports differ from the
 * tools it replaced. The squares are summed exactly and the square root gets
 * one corrected Newton step.
 */
export function hypot(a: number, b: number): number {
  const [x, y] = [Math.abs(a), Math.abs(b)];
  const max = Math.max(x, y);
  if (max === 0 || !Number.isFinite(max)) return max === 0 ? 0 : max;

  // Scaling by a power of two is exact, so it cannot change the result — it
  // only keeps the squares clear of overflow and underflow.
  const scale = 2 ** -Math.max(-1000, Math.min(1000, Math.round(Math.log2(max))));
  const [p, pError] = squareExactly(x * scale);
  const [q, qError] = squareExactly(y * scale);

  const sum = p + q;
  const low = p - (sum - (sum - p)) + (q - (sum - p)) + pError + qError;

  let root = Math.sqrt(sum);
  const [square, squareError] = squareExactly(root);
  root += (sum - square - squareError + low) / (2 * root);
  return root / scale;
}

/** Dekker's two-product, specialised to squaring: value*value = sum + error. */
function squareExactly(value: number): [number, number] {
  const SPLIT = 134217729; // 2**27 + 1
  const split = SPLIT * value;
  const high = split - (split - value);
  const low = value - high;
  const product = value * value;
  return [product, high * high - product + 2 * (high * low) + low * low];
}

export const distance = (p: Vec2, q: Vec2): number => hypot(p[0] - q[0], p[1] - q[1]);

export const translate = ([x, y]: Vec2, [dx, dy]: Vec2): Vec2 => [x + dx, y + dy];

export function segmentPointDistance(p: Vec2, from: Vec2, to: Vec2): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : clamp(((p[0] - from[0]) * dx + (p[1] - from[1]) * dy) / lengthSquared, 0, 1);
  return distance(p, [from[0] + t * dx, from[1] + t * dy]);
}

export const polygonEdges = (points: Polygon): Edge[] =>
  points.map((point, i) => [point, points[(i + 1) % points.length]!] as const);

/**
 * Whether two segments cross. A point exactly on the other segment counts as
 * lying on its negative side, so a T-junction crosses but collinear overlap
 * does not.
 */
export function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const side = (p: Vec2, q: Vec2, r: Vec2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return side(a, b, c) > 0 !== side(a, b, d) > 0 && side(c, d, a) > 0 !== side(c, d, b) > 0;
}

export function polygonContains(points: Polygon, p: Vec2): boolean {
  let inside = false;
  for (const [[x1, y1], [x2, y2]] of polygonEdges(points)) {
    // Horizontal edges fail this test, so the division below is always safe.
    if (y1 > p[1] !== y2 > p[1] && p[0] < x1 + ((p[1] - y1) * (x2 - x1)) / (y2 - y1)) inside = !inside;
  }
  return inside;
}

/** Distance between two convex-ish polygons; 0 when they touch or overlap. */
export function polygonDistance(a: Polygon, b: Polygon): number {
  if (polygonContains(b, a[0]!) || polygonContains(a, b[0]!)) return 0;
  let best = Infinity;
  for (const [a0, a1] of polygonEdges(a)) {
    for (const [b0, b1] of polygonEdges(b)) {
      if (segmentsCross(a0, a1, b0, b1)) return 0;
      best = Math.min(best, segmentPointDistance(a0, b0, b1), segmentPointDistance(b0, a0, a1));
    }
  }
  return best;
}

/** Corners of an axis-aligned rectangle centred on the origin, counter-clockwise. */
export const rectCorners = ([width, height]: Vec2): Polygon => [
  [-width / 2, -height / 2],
  [width / 2, -height / 2],
  [width / 2, height / 2],
  [-width / 2, height / 2],
];

export const regularPolygon = (centre: Vec2, radius: number, sides: number): Polygon =>
  Array.from({ length: sides }, (_, i) => {
    const a = (2 * Math.PI * i) / sides;
    return [centre[0] + radius * Math.cos(a), centre[1] + radius * Math.sin(a)] as const;
  });

export function boundsOf(points: Iterable<Vec2>): BBox | null {
  let box: BBox | null = null;
  for (const [x, y] of points) {
    box = box
      ? { minX: Math.min(box.minX, x), minY: Math.min(box.minY, y), maxX: Math.max(box.maxX, x), maxY: Math.max(box.maxY, y) }
      : { minX: x, minY: y, maxX: x, maxY: y };
  }
  return box;
}

/** True when `inner`'s bounding box lies entirely within `outer`'s. */
export const bboxCovers = (outer: BBox, inner: BBox): boolean =>
  outer.minX <= inner.minX && outer.minY <= inner.minY && outer.maxX >= inner.maxX && outer.maxY >= inner.maxY;

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

export function minOf<T>(items: Iterable<T>, of: (item: T) => number): number {
  let best = Infinity;
  for (const item of items) best = Math.min(best, of(item));
  return best;
}

export const distanceToEdges = (point: Vec2, edges: Iterable<Edge>): number =>
  minOf(edges, ([from, to]) => segmentPointDistance(point, from, to));
