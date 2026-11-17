import { writeFileSync } from 'node:fs';
import type { Polygon } from '@jscad/csg';
import { signedVolume, toStl, triangulate, type Triangle } from './mesh.ts';
import { evaluate } from './runtime.ts';

export interface Model {
  readonly polygons: readonly Polygon[];
  readonly triangles: readonly Triangle[];
}

/** Evaluates a `.jscad` file and prints the numbers that show it came out sane. */
export function describe(path: string): Model {
  const solid = evaluate(path);
  const polygons = solid.toPolygons();
  const triangles = triangulate(polygons);
  const [low, high] = solid.getBounds();

  console.log(`polygons: ${polygons.length}`);
  console.log(`bounds  : x ${extent(low.x, high.x)}`);
  console.log(`          y ${extent(low.y, high.y)}`);
  console.log(`          z ${extent(low.z, high.z)}`);
  console.log(`volume  : ${signedVolume(triangles).toFixed(1)} mm^3`);

  return { polygons, triangles };
}

/** `shownAs` is what the caller called the file, which is what gets reported. */
export function writeStl(triangles: readonly Triangle[], path: string, shownAs = path): void {
  writeFileSync(path, toStl(triangles));
  console.log(`wrote ${shownAs} (${triangles.length} triangles)`);
}

const extent = (low: number, high: number): string =>
  `${low.toFixed(2)} .. ${high.toFixed(2)}  (${(high - low).toFixed(2)})`;
