/** Triangle-soup operations on an evaluated solid: volume, STL, probes, sections. */
import type { Polygon } from '@jscad/csg';
import type { Vec2 } from '../geom.ts';

export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type Triangle = readonly [Point3, Point3, Point3];
export type Axis = 'x' | 'y' | 'z';
export type Segment2 = readonly [Vec2, Vec2];

const AXES = ['x', 'y', 'z'] as const;

/** Fans each polygon from its first vertex. */
export function triangulate(polygons: readonly Polygon[]): Triangle[] {
  const triangles: Triangle[] = [];
  for (const { vertices } of polygons) {
    for (let i = 1; i < vertices.length - 1; i++) {
      triangles.push([vertices[0]!.pos, vertices[i]!.pos, vertices[i + 1]!.pos]);
    }
  }
  return triangles;
}

/** Signed volume — negative or wildly wrong means the booleans went bad. */
export function signedVolume(triangles: readonly Triangle[]): number {
  let total = 0;
  for (const [a, c, d] of triangles) {
    total += (a.x * (c.y * d.z - d.y * c.z) - a.y * (c.x * d.z - d.x * c.z) + a.z * (c.x * d.y - d.x * c.y)) / 6;
  }
  return total;
}

/** Binary STL. Normals are left at zero, which is legal and nothing here reads them. */
export function toStl(triangles: readonly Triangle[]): Buffer {
  const buffer = Buffer.alloc(84 + triangles.length * 50);
  buffer.writeUInt32LE(triangles.length, 80);

  let at = 84;
  for (const triangle of triangles) {
    at += 12; // zero normal
    for (const { x, y, z } of triangle) {
      buffer.writeFloatLE(x, at);
      buffer.writeFloatLE(y, at + 4);
      buffer.writeFloatLE(z, at + 8);
      at += 12;
    }
    at += 2; // attribute byte count
  }
  return buffer;
}

/**
 * Whether a point is inside the mesh, by casting a ray straight up and counting
 * the faces it passes through.
 */
export function isSolidAt(triangles: readonly Triangle[], [px, py]: Vec2, pz: number): boolean {
  let crossings = 0;
  for (const [a, b, c] of triangles) {
    const area = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(area) < 1e-12) continue;

    const l1 = ((b.y - c.y) * (px - c.x) + (c.x - b.x) * (py - c.y)) / area;
    const l2 = ((c.y - a.y) * (px - c.x) + (a.x - c.x) * (py - c.y)) / area;
    const l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;

    if (l1 * a.z + l2 * b.z + l3 * c.z > pz) crossings++;
  }
  return crossings % 2 === 1;
}

/**
 * Where a plane cuts each polygon, as one segment per polygon.
 *
 * A concave polygon can cross the plane more than twice; only the first and
 * last crossings are kept, which is enough to read a section by eye.
 */
export function crossSection(polygons: readonly Polygon[], axis: Axis, value: number): Segment2[] {
  const normal = AXES.indexOf(axis);
  const [u, v] = AXES.filter((_, i) => i !== normal) as [Axis, Axis];

  const segments: Segment2[] = [];
  for (const { vertices } of polygons) {
    const hits: Vec2[] = [];
    for (let i = 0; i < vertices.length; i++) {
      const from = vertices[i]!.pos;
      const to = vertices[(i + 1) % vertices.length]!.pos;
      const [here, there] = [from[axis] - value, to[axis] - value];

      if ((here > 0 && there > 0) || (here < 0 && there < 0)) continue;
      if (here === 0 && there === 0) continue;

      const t = here / (here - there);
      hits.push([from[u] + t * (to[u] - from[u]), from[v] + t * (to[v] - from[v])]);
    }
    if (hits.length >= 2) segments.push([hits[0]!, hits[hits.length - 1]!]);
  }
  return segments;
}

/** The two axes a cut is drawn in, in the order they appear on the page. */
export const sectionAxes = (axis: Axis): [Axis, Axis] =>
  AXES.filter((candidate) => candidate !== axis) as [Axis, Axis];
