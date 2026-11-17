/**
 * Runs an ergogen-emitted `.jscad` file. They are written against the OpenJSCAD
 * v1 free-function API, which `@jscad/csg` does not provide, so the functions
 * are supplied here and the file is evaluated with them in scope.
 */
import { readFileSync } from 'node:fs';
import csg, { type Solid } from '@jscad/csg';

type Shapes = Solid | Solid[];

/** `union(a, b)` and `union([a, b])` are both valid in the v1 API. */
const flatten = (args: Shapes[]): Solid[] => (Array.isArray(args[0]) ? args[0] : (args as Solid[]));

const combine = (op: (a: Solid, b: Solid) => Solid) => (...args: Shapes[]) => flatten(args).reduce(op);

const ORIGIN = [0, 0, 0];

const API = {
  CSG: csg.CSG,
  CAG: csg.CAG,
  translate: (offset: number[], shape: Solid) => shape.translate(offset),
  rotate: ([x, y, z]: number[], shape: Solid) =>
    shape.rotate(ORIGIN, [0, 0, 1], z!).rotate(ORIGIN, [1, 0, 0], x!).rotate(ORIGIN, [0, 1, 0], y!),
  scale: (factor: number[], shape: Solid) => shape.scale(factor),
  union: combine((a, b) => a.union(b)),
  subtract: combine((a, b) => a.subtract(b)),
  intersect: combine((a, b) => a.intersect(b)),
  difference: combine((a, b) => a.subtract(b)),
  console,
};

/**
 * Evaluates the file and returns what its `main()` builds.
 *
 * This runs in the host realm rather than a `vm` context on purpose: inside a
 * context, arrays the script creates fail the `x instanceof Array` checks that
 * `@jscad/csg` makes on them.
 */
export function evaluate(path: string): Solid {
  const names = Object.keys(API);
  const body = `${readFileSync(path, 'utf8')}\n;return main();`;
  const run = new Function(...names, body) as (...api: unknown[]) => Solid;
  return run(...names.map((name) => API[name as keyof typeof API]));
}
