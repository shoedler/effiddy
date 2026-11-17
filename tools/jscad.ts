/**
 * Evaluates one ergogen-emitted `.jscad` file: reports its stats, writes an
 * STL, answers point probes, and draws planar cross sections as SVG.
 *
 * Probes and sections are the fastest way to confirm that a wall, a lip or a
 * cutout is really where you think it is.
 */
import { writeFileSync } from 'node:fs';
import { parseCli, run } from './lib/cli.ts';
import { boundsOf, type BBox, type Vec2 } from './lib/geom.ts';
import { crossSection, isSolidAt, sectionAxes, type Axis, type Segment2 } from './lib/jscad/mesh.ts';
import { describe, writeStl, type Model } from './lib/jscad/report.ts';
import { repoPath } from './lib/paths.ts';

interface Cut {
  /** The cut as written, e.g. `x=263`. */
  readonly label: string;
  readonly axes: readonly [Axis, Axis];
  readonly segments: Segment2[];
}

/** Millimetres of blank space around each section, and pixels below its label. */
const MARGIN = 2;
const LABEL_HEIGHT = 16;
const GAP_BETWEEN_SECTIONS = 26;

function main(): void {
  const args = parseCli({
    usage: 'node tools/jscad.ts <file.jscad> [--stl out.stl] [--probe "label:x,y,z;..."] [--cut axis=value,...] [--svg out.svg] [--scale n] [--crop a0,b0,a1,b1]',
    positionals: { file: { type: 'string', help: 'the .jscad file to evaluate' } },
    options: {
      stl: { type: 'string', help: 'write a binary STL here' },
      probe: { type: 'string', help: 'semicolon-separated "label:x,y,z" points to test' },
      cut: { type: 'string', help: 'comma-separated "axis=value" section planes' },
      svg: { type: 'string', help: 'draw the sections here' },
      scale: { type: 'number', default: 6, help: 'pixels per mm in the SVG' },
      crop: { type: 'string', help: 'a0,b0,a1,b1 in each section own axes' },
    },
  });
  if (!args.file) throw new Error('a .jscad file is required');

  const model = describe(repoPath(args.file));
  if (args.stl) writeStl(model.triangles, repoPath(args.stl), args.stl);
  if (args.probe) probe(model, args.probe);
  if (args.cut) {
    const cuts = args.cut.split(',').map((spec) => sliceAt(model, spec, args.crop));
    if (args.svg) {
      writeFileSync(repoPath(args.svg), drawSections(cuts, args.scale), 'utf8');
      console.log(`wrote ${args.svg}`);
    }
  }
}

function probe({ triangles }: Model, spec: string): void {
  for (const one of spec.split(';')) {
    const [label, coords] = one.includes(':') ? one.split(':') : ['', one];
    const [x, y, z] = coords!.split(',').map(Number);
    const state = isSolidAt(triangles, [x!, y!], z!) ? 'SOLID' : 'empty';
    console.log(`  ${(label || coords)!.padEnd(34)} (${x}, ${y}, ${z})  ->  ${state}`);
  }
}

function sliceAt({ polygons }: Model, spec: string, crop: string | undefined): Cut {
  const [name, value] = spec.split('=');
  const axis = name!.trim() as Axis;
  const found = crossSection(polygons, axis, Number.parseFloat(value!));
  const kept = crop ? found.filter((segment) => segment.every((point) => within(point, parseCrop(crop)))) : found;

  console.log(`cut ${spec}: ${found.length} segments (${kept.length} after crop)`);
  return { label: spec, axes: sectionAxes(axis), segments: kept };
}

/** Stacks the sections top to bottom, each in its own translated group. */
function drawSections(cuts: readonly Cut[], scale: number): string {
  const groups: string[] = [];
  let top = 0;

  for (const cut of cuts) {
    const box = boundsOf(cut.segments.flat());
    if (!box) continue;
    const { minX, minY, maxY } = pad(box, MARGIN);

    const lines = cut.segments.map(([from, to]) => {
      const at = (point: Vec2) => ({
        x: ((point[0] - minX) * scale).toFixed(2),
        y: ((maxY - point[1]) * scale + LABEL_HEIGHT).toFixed(2),
      });
      const [a, b] = [at(from), at(to)];
      return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#000" stroke-width="1.2"/>`;
    });

    groups.push(
      [
        `<g transform="translate(0,${top})">`,
        `<text x="2" y="12" font-size="11" font-family="monospace" fill="#c00">` +
          `${cut.label}  (${cut.axes[0]} right, ${cut.axes[1]} up)</text>`,
        ...lines,
        '</g>',
      ].join('\n'),
    );
    top += (maxY - minY) * scale + GAP_BETWEEN_SECTIONS;
  }

  const width = Math.max(
    ...cuts.map((cut) => {
      const box = boundsOf(cut.segments.flat());
      return box ? (box.maxX - box.minX + 2 * MARGIN) * scale : 0;
    }),
  );
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(0)}" height="${top.toFixed(0)}" style="background:#fff">` +
    `<rect width="100%" height="100%" fill="#fff"/>${groups.join('\n')}</svg>`
  );
}

function parseCrop(spec: string): BBox {
  const [minX, minY, maxX, maxY] = spec.split(',').map(Number);
  return { minX: minX!, minY: minY!, maxX: maxX!, maxY: maxY! };
}

const within = ([x, y]: Vec2, box: BBox): boolean => x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;

const pad = (box: BBox, by: number): BBox => ({
  minX: box.minX - by,
  minY: box.minY - by,
  maxX: box.maxX + by,
  maxY: box.maxY + by,
});

run(main);
