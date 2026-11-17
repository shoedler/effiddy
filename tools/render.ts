/**
 * Draws ergogen's outlines and points into a labelled SVG in true coordinates
 * (y up, matching `points.yaml`), so a generated shape can be checked by eye.
 */
import { writeFileSync } from 'node:fs';
import { parseCli, run } from './lib/cli.ts';
import { fixed, general } from './lib/fmt.ts';
import { toRadians, type BBox, type Vec2 } from './lib/geom.ts';
import { bounds, loadOutline, sweepOf, type Outline } from './lib/outline.ts';
import { repoPath } from './lib/paths.ts';
import { hasTag, loadPoints, type Points } from './lib/points.ts';

interface Layer {
  readonly colour: string;
  readonly width: number;
  readonly outline: Outline;
}

/** Maps model coordinates to SVG ones: x shifts, y flips, both scale. */
interface View {
  readonly scale: number;
  readonly width: number;
  readonly height: number;
  x(value: number): number;
  y(value: number): number;
}

const PADDING = 3;
const KEY_COLOUR = '#d00';
const OTHER_COLOUR = '#06c';

function main(): void {
  const args = parseCli({
    usage: 'node tools/render.ts <out> --o name[:colour[:width]] ... [--points] [--labels] [--crop x0,y0,x1,y1] [--scale n] [--grid mm] [--out file.svg]',
    positionals: { dir: { type: 'string', default: 'out', help: 'build output directory' } },
    options: {
      o: { type: 'string', many: true, help: 'outline to draw, repeatable' },
      points: { type: 'boolean', help: 'mark every ergogen point' },
      labels: { type: 'boolean', help: 'name every point' },
      crop: { type: 'string', help: 'x0,y0,x1,y1 in model coordinates' },
      scale: { type: 'number', default: 6, help: 'pixels per mm' },
      grid: { type: 'number', default: 0, help: 'grid spacing in mm, 0 for none' },
      out: { type: 'string', default: 'render.svg', help: 'file to write' },
    },
  });

  const outDir = repoPath(args.dir);
  const layers = args.o.map((spec) => toLayer(outDir, spec));
  const points = args.points || args.labels ? loadPoints(outDir) : {};
  const box = args.crop ? parseCrop(args.crop) : pad(bounds(layers.flatMap((layer) => layer.outline)), PADDING);
  const view = makeView(box, args.scale);

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fixed(view.width, 0)}" height="${fixed(view.height, 0)}"` +
      ` viewBox="0 0 ${fixed(view.width, 1)} ${fixed(view.height, 1)}" style="background:#fff">`,
    '<rect width="100%" height="100%" fill="#fff"/>',
    ...(args.grid ? grid(box, view, args.grid) : []),
    ...layers.flatMap((layer) => draw(layer, view)),
    ...markPoints(points, box, view, args.labels),
    '</svg>',
  ];
  writeFileSync(repoPath(args.out), svg.join('\n'), 'utf8');

  const extent = `(${fixed(box.minX, 1)},${fixed(box.minY, 1)})-(${fixed(box.maxX, 1)},${fixed(box.maxY, 1)})`;
  console.log(`wrote ${args.out} crop=${extent} size=${fixed(view.width, 0)}x${fixed(view.height, 0)}`);
}

function toLayer(outDir: string, spec: string): Layer {
  const [name = '', colour, width] = spec.split(':');
  return {
    colour: colour || '#000',
    width: width === undefined ? 0.2 : Number(width),
    outline: loadOutline(outDir, name),
  };
}

function makeView(box: BBox, scale: number): View {
  return {
    scale,
    width: (box.maxX - box.minX) * scale,
    height: (box.maxY - box.minY) * scale,
    x: (value) => (value - box.minX) * scale,
    y: (value) => (box.maxY - value) * scale,
  };
}

function grid(box: BBox, view: View, spacing: number): string[] {
  const lines: string[] = [];
  // Accumulating rather than counting, so the last line lands where it used to.
  for (let x = Math.floor(box.minX / spacing) * spacing; x <= box.maxX; x += spacing) {
    lines.push(
      `<line x1="${fixed(view.x(x), 1)}" y1="0" x2="${fixed(view.x(x), 1)}" y2="${fixed(view.height, 1)}" stroke="#eee" stroke-width="1"/>`,
      `<text x="${fixed(view.x(x) + 2, 1)}" y="10" font-size="9" fill="#999" font-family="monospace">${general(x)}</text>`,
    );
  }
  for (let y = Math.floor(box.minY / spacing) * spacing; y <= box.maxY; y += spacing) {
    lines.push(
      `<line x1="0" y1="${fixed(view.y(y), 1)}" x2="${fixed(view.width, 1)}" y2="${fixed(view.y(y), 1)}" stroke="#eee" stroke-width="1"/>`,
      `<text x="2" y="${fixed(view.y(y) - 2, 1)}" font-size="9" fill="#999" font-family="monospace">${general(y)}</text>`,
    );
  }
  return lines;
}

function draw({ colour, width, outline }: Layer, view: View): string[] {
  const shapes = outline.map((segment) => {
    if (segment.kind === 'line') {
      return (
        `<line x1="${fixed(view.x(segment.from[0]), 2)}" y1="${fixed(view.y(segment.from[1]), 2)}"` +
        ` x2="${fixed(view.x(segment.to[0]), 2)}" y2="${fixed(view.y(segment.to[1]), 2)}"/>`
      );
    }
    if (segment.kind === 'circle') {
      return (
        `<circle cx="${fixed(view.x(segment.centre[0]), 2)}" cy="${fixed(view.y(segment.centre[1]), 2)}"` +
        ` r="${fixed(segment.radius * view.scale, 2)}"/>`
      );
    }
    const from = onCircle(segment.centre, segment.radius, segment.start);
    const to = onCircle(segment.centre, segment.radius, segment.end);
    const large = sweepOf(segment) > 180 ? 1 : 0;
    const radius = fixed(segment.radius * view.scale, 2);
    // Counter-clockwise in model coordinates is clockwise once y is flipped,
    // hence the sweep flag of 0.
    return (
      `<path d="M ${fixed(view.x(from[0]), 2)} ${fixed(view.y(from[1]), 2)}` +
      ` A ${radius} ${radius} 0 ${large} 0 ${fixed(view.x(to[0]), 2)} ${fixed(view.y(to[1]), 2)}"/>`
    );
  });
  return [
    `<g stroke="${colour}" stroke-width="${fixed(width * view.scale, 2)}" fill="none" stroke-linecap="round">`,
    ...shapes,
    '</g>',
  ];
}

function markPoints(points: Points, box: BBox, view: View, labels: boolean): string[] {
  const marks: string[] = [];
  for (const [name, point] of Object.entries(points)) {
    const { x, y } = point;
    if (x < box.minX || x > box.maxX || y < box.minY || y > box.maxY) continue;

    const colour = hasTag(point, 'key') ? KEY_COLOUR : OTHER_COLOUR;
    const [dx, dy] = [3 * Math.cos(toRadians(point.r + 90)), 3 * Math.sin(toRadians(point.r + 90))];
    marks.push(
      `<circle cx="${fixed(view.x(x), 1)}" cy="${fixed(view.y(y), 1)}" r="${fixed(0.5 * view.scale, 1)}" fill="${colour}"/>`,
      `<line x1="${fixed(view.x(x), 1)}" y1="${fixed(view.y(y), 1)}"` +
        ` x2="${fixed(view.x(x + dx), 1)}" y2="${fixed(view.y(y + dy), 1)}" stroke="${colour}" stroke-width="1"/>`,
    );
    if (labels) {
      marks.push(
        `<text x="${fixed(view.x(x) + 4, 1)}" y="${fixed(view.y(y) - 3, 1)}"` +
          ` font-size="${fixed(Math.max(8, view.scale * 1.6), 0)}" fill="${colour}" font-family="monospace">${name}</text>`,
      );
    }
  }
  return marks;
}

function parseCrop(spec: string): BBox {
  const [minX, minY, maxX, maxY] = spec.split(',').map(Number);
  if ([minX, minY, maxX, maxY].some((value) => value === undefined || !Number.isFinite(value))) {
    throw new Error(`--crop wants four numbers, got "${spec}"`);
  }
  return { minX: minX!, minY: minY!, maxX: maxX!, maxY: maxY! };
}

const pad = (box: BBox, by: number): BBox => ({
  minX: box.minX - by,
  minY: box.minY - by,
  maxX: box.maxX + by,
  maxY: box.maxY + by,
});

const onCircle = (centre: Vec2, radius: number, degrees: number): Vec2 => [
  centre[0] + radius * Math.cos(toRadians(degrees)),
  centre[1] + radius * Math.sin(toRadians(degrees)),
];

run(main);
