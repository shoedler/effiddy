/**
 * Ergogen writes each outline as a makerjs model tree. This flattens one into
 * plain segments and answers the geometric questions the checks ask of them.
 */
import { join } from 'node:path';
import { boundsOf, distance, minOf, placeCcw, rectCorners, toRadians, type BBox, type Vec2 } from './geom.ts';
import { readYaml } from './points.ts';

export type Segment =
  | { readonly kind: 'line'; readonly from: Vec2; readonly to: Vec2 }
  | { readonly kind: 'circle'; readonly centre: Vec2; readonly radius: number }
  | { readonly kind: 'arc'; readonly centre: Vec2; readonly radius: number; readonly start: number; readonly end: number };

export type Outline = readonly Segment[];

/** How many points each segment contributes when an outline is sampled. */
const SAMPLES = 60;

interface MakerPath {
  readonly type?: string;
  readonly origin?: readonly [number, number];
  readonly end?: readonly [number, number];
  readonly radius?: number;
  readonly startAngle?: number;
  readonly endAngle?: number;
}

interface MakerModel {
  readonly origin?: readonly [number, number];
  readonly paths?: Readonly<Record<string, MakerPath>>;
  readonly models?: Readonly<Record<string, MakerModel>>;
}

export const loadOutline = (outDir: string, name: string): Outline =>
  flatten(readYaml<MakerModel>(join(outDir, 'outlines', `${name}.yaml`)));

/** Walks the model tree, accumulating nested origins. Paths come before models. */
export function flatten(model: MakerModel | null | undefined, origin: Vec2 = [0, 0]): Segment[] {
  // An empty branch of the tree comes back from YAML as null.
  if (!model || typeof model !== 'object') return [];
  const [ox, oy] = [origin[0] + (model.origin?.[0] ?? 0), origin[1] + (model.origin?.[1] ?? 0)];
  const segments: Segment[] = [];

  for (const path of Object.values(model.paths ?? {})) {
    const at: Vec2 = [ox + (path.origin?.[0] ?? 0), oy + (path.origin?.[1] ?? 0)];
    if (path.type === 'line' && path.end) {
      segments.push({ kind: 'line', from: at, to: [ox + path.end[0], oy + path.end[1]] });
    } else if (path.type === 'circle') {
      segments.push({ kind: 'circle', centre: at, radius: path.radius ?? 0 });
    } else if (path.type === 'arc') {
      segments.push({
        kind: 'arc',
        centre: at,
        radius: path.radius ?? 0,
        start: path.startAngle ?? 0,
        end: path.endAngle ?? 0,
      });
    }
  }
  for (const child of Object.values(model.models ?? {})) segments.push(...flatten(child, [ox, oy]));
  return segments;
}

/** An arc's sweep, in degrees; a full turn when the angles coincide. */
export const sweepOf = (segment: Extract<Segment, { kind: 'arc' }>): number =>
  (((segment.end - segment.start) % 360) + 360) % 360 || 360;

/**
 * Dense sample of an outline's boundary. The counts differ per kind — a line
 * and an arc include both ends, a circle does not repeat its start.
 */
export function samplePoints(outline: Outline, count = SAMPLES): Vec2[] {
  const points: Vec2[] = [];
  for (const segment of outline) {
    if (segment.kind === 'line') {
      for (let i = 0; i <= count; i++) {
        const t = i / count;
        points.push([
          segment.from[0] + t * (segment.to[0] - segment.from[0]),
          segment.from[1] + t * (segment.to[1] - segment.from[1]),
        ]);
      }
    } else if (segment.kind === 'circle') {
      for (let i = 0; i < count; i++) points.push(onCircle(segment, (2 * Math.PI * i) / count));
    } else {
      const sweep = sweepOf(segment);
      for (let i = 0; i <= count; i++) {
        points.push(onCircle(segment, toRadians(segment.start + (sweep * i) / count)));
      }
    }
  }
  return points;
}

/**
 * Crossing test against the outline's straight segments only — circles and arcs
 * do not vote. Every shape this is asked about is bounded by lines where it
 * matters, and including curves would need them subdivided consistently.
 */
export function isInside(outline: Outline, [px, py]: Vec2): boolean {
  let inside = false;
  for (const segment of outline) {
    if (segment.kind !== 'line') continue;
    const [[x1, y1], [x2, y2]] = [segment.from, segment.to];
    if (y1 > py !== y2 > py && px < x1 + ((py - y1) * (x2 - x1)) / (y2 - y1)) inside = !inside;
  }
  return inside;
}

/** Distance from a point to a segment; a curve is treated as its full circle. */
export function segmentDistance(point: Vec2, segment: Segment): number {
  if (segment.kind !== 'line') return Math.abs(distance(point, segment.centre) - segment.radius);

  const [dx, dy] = [segment.to[0] - segment.from[0], segment.to[1] - segment.from[1]];
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((point[0] - segment.from[0]) * dx + (point[1] - segment.from[1]) * dy) / lengthSquared));
  return distance(point, [segment.from[0] + t * dx, segment.from[1] + t * dy]);
}

/** Closest approach of `from`'s boundary to `to`'s. Not symmetric — `from` is sampled. */
export const gap = (from: Outline, to: Outline, count = SAMPLES): number =>
  minOf(samplePoints(from, count), (point) => minOf(to, (segment) => segmentDistance(point, segment)));

/**
 * How many sampled points of `inner`, nudged inward, fall outside `outer`.
 *
 * Curves are nudged toward their own centre and lines toward the centroid of
 * the whole shape — otherwise a shape made of disjoint pieces, like the pair of
 * screw bosses, gets nudged sideways instead of inward.
 */
export function countOutside(inner: Outline, outer: Outline, nudge = 0.05, count = SAMPLES): number {
  const all = samplePoints(inner, count);
  const centroid: Vec2 = [
    all.reduce((sum, [x]) => sum + x, 0) / all.length,
    all.reduce((sum, [, y]) => sum + y, 0) / all.length,
  ];

  let outside = 0;
  for (const segment of inner) {
    const towards = segment.kind === 'line' ? centroid : segment.centre;
    for (const [x, y] of samplePoints([segment], count)) {
      const reach = distance(towards, [x, y]) || 1;
      const inward: Vec2 = [x + ((towards[0] - x) / reach) * nudge, y + ((towards[1] - y) / reach) * nudge];
      if (!isInside(outer, inward)) outside++;
    }
  }
  return outside;
}

export function bounds(outline: Outline): BBox {
  const corners = outline.flatMap((segment): Vec2[] =>
    segment.kind === 'line'
      ? [segment.from, segment.to]
      : [
          [segment.centre[0] - segment.radius, segment.centre[1] - segment.radius],
          [segment.centre[0] + segment.radius, segment.centre[1] + segment.radius],
        ],
  );
  const box = boundsOf(corners);
  if (!box) throw new Error('outline has no geometry');
  return box;
}

/** A rectangle as four line segments, for comparing against real outlines. */
export function rectOutline(centre: Vec2, size: Vec2, degrees: number): Segment[] {
  const corners = rectCorners(size).map((corner) => placeCcw(centre, corner, degrees));
  return corners.map((from, i) => ({ kind: 'line', from, to: corners[(i + 1) % corners.length]! }));
}

const onCircle = ({ centre, radius }: { centre: Vec2; radius: number }, radians: number): Vec2 => [
  centre[0] + radius * Math.cos(radians),
  centre[1] + radius * Math.sin(radians),
];
