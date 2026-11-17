import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';

export interface PointMeta {
  /** Ergogen writes a single tag as a scalar and several as a list. */
  readonly tags?: string | readonly string[];
  readonly [key: string]: unknown;
}

export interface Point {
  readonly x: number;
  readonly y: number;
  /** Rotation in degrees, in ergogen's y-up frame. */
  readonly r: number;
  readonly meta: PointMeta;
}

export type Points = Readonly<Record<string, Point>>;
export type Units = Readonly<Record<string, number>>;

/**
 * js-yaml refuses documents nested deeper than 100 by default, and ergogen's
 * bigger outlines go well past that. Nothing here parses untrusted input.
 */
export const readYaml = <T>(path: string): T => load(readFileSync(path, 'utf8'), { maxDepth: Infinity }) as T;

export const loadPoints = (outDir: string): Points => readYaml(join(outDir, 'points', 'points.yaml'));

export const loadUnits = (outDir: string): Units => readYaml(join(outDir, 'points', 'units.yaml'));

export const hasTag = (point: Point, tag: string): boolean => point.meta.tags?.includes(tag) ?? false;

/** Reads a unit, failing loudly rather than letting `undefined` reach a report. */
export function unit(units: Units, name: string): number {
  const value = units[name];
  if (typeof value !== 'number') throw new Error(`units.yaml has no numeric "${name}"`);
  return value;
}
