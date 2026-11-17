/**
 * A standalone, KiCad-free sanity check on the generated `.kicad_pcb`.
 *
 * It only knows about the things ergogen can get wrong before any routing:
 * copper too close to or hanging off the board edge, pads of different nets too
 * close together, drilled holes too close to the edge, and the two zone
 * polygons whose coordinates are literals in the config — nothing else keeps
 * those in sync with the layout.
 *
 * Courtyard overlaps are deliberately not checked: every switch overlaps its
 * own diode here, which is normal for a keyboard.
 */
import { parseCli, run } from './lib/cli.ts';
import { fixed, float, verdict } from './lib/fmt.ts';
import {
  bboxCovers,
  boundsOf,
  distance,
  distanceToEdges,
  minOf,
  polygonDistance,
  polygonEdges,
  segmentsCross,
  type BBox,
  type Vec2,
} from './lib/geom.ts';
import { readBoard, sharesCopperLayer, type Board, type Pad, type Zone } from './lib/kicad.ts';
import { repoPath } from './lib/paths.ts';

/** Pads more than this far apart cannot violate any clearance we check. */
const NEIGHBOUR_RADIUS = 6;

/** How many rows each section prints — see `listWorstFirst`. */
const MAX_ROWS = 25;

function main(): void {
  const args = parseCli({
    usage: 'node tools/drc-lite.ts [pcb] [--edge mm] [--pad mm] [--hole mm]',
    positionals: {
      pcb: { type: 'string', default: 'out/pcbs/effiddy.kicad_pcb', help: 'board to check' },
    },
    options: {
      edge: { type: 'number', default: 0.3, help: 'copper to board edge, JLCPCB minimum' },
      pad: { type: 'number', default: 0.2, help: 'pad to pad across nets, JLCPCB minimum' },
      hole: { type: 'number', default: 0.5, help: 'hole wall to board edge' },
    },
  });

  const board = readBoard(repoPath(args.pcb));
  console.log(`${args.pcb}: ${board.pads.length} pads, ${board.edges.length} board edge segments`);

  const findings =
    reportEdgeClearance(board, args.edge) +
    reportPadClearance(board, args.pad) +
    reportHoleClearance(board, args.hole) +
    reportZoneCoverage(board);

  console.log(`\n${findings} finding(s)`);
  process.exitCode = findings > 0 ? 1 : 0;
}

function reportEdgeClearance(board: Board, minimum: number): number {
  section(`copper to board edge (min ${float(minimum)})`);

  const violations = board.pads.flatMap((pad) => {
    const gap = minOf(pad.poly, (vertex) => distanceToEdges(vertex, board.edges));
    const crosses = polygonEdges(pad.poly).some(([from, to]) =>
      board.edges.some(([a, b]) => segmentsCross(from, to, a, b)),
    );
    return crosses || gap < minimum ? [{ gap, crosses, pad }] : [];
  });

  return listWorstFirst(violations, ({ gap, crosses, pad }) => {
    const state = crosses ? 'CROSSES THE EDGE' : `${fixed(gap, 3)}mm`;
    const net = (pad.net || '-').padEnd(10);
    return `  FAIL ${pad.ref.padStart(6)}.${pad.number.padEnd(3)} net=${net} at (${at(pad.pos)})  ${state}`;
  });
}

function reportPadClearance(board: Board, minimum: number): number {
  section(`pad to pad, different nets (min ${float(minimum)})`);

  const violations: { gap: number; a: Pad; b: Pad }[] = [];
  for (const [i, a] of board.pads.entries()) {
    for (const b of board.pads.slice(i + 1)) {
      // Pads within one footprint are the library author's business, and
      // reversible footprints stack their F and B pads on purpose.
      if (a.ref === b.ref) continue;
      if (a.net && a.net === b.net) continue;
      if (!sharesCopperLayer(a.layers, b.layers)) continue;
      if (distance(a.pos, b.pos) > NEIGHBOUR_RADIUS) continue;

      const gap = polygonDistance(a.poly, b.poly);
      if (gap < minimum) violations.push({ gap, a, b });
    }
  }

  return listWorstFirst(violations, ({ gap, a, b }) => {
    const name = (pad: Pad) => `${pad.ref}.${pad.number} (${pad.net || '-'})`;
    return `  FAIL ${name(a)} <-> ${name(b)}  ${fixed(gap, 3)}mm`;
  });
}

function reportHoleClearance(board: Board, minimum: number): number {
  section(`drilled holes to board edge (min ${float(minimum)})`);

  const violations = board.pads.flatMap((pad) => {
    if (pad.drill === null) return [];
    const gap = distanceToEdges(pad.pos, board.edges) - pad.drill / 2;
    return gap < minimum ? [{ gap, pad }] : [];
  });

  return listWorstFirst(
    violations,
    ({ gap, pad }) => `  FAIL ${pad.ref}.${pad.number} hole at (${at(pad.pos)})  ${fixed(gap, 3)}mm to edge`,
  );
}

/**
 * The GND pour (and an MCU keepout, if there is one) are literal coordinates
 * in the config — ergogen does not resolve unit names inside nested arrays — so
 * nothing else keeps them in sync with the layout.
 */
function reportZoneCoverage(board: Board): number {
  section('zone polygons still fit the layout');
  let findings = 0;

  // A routed board picks up small extra zones (teardrops, stitching), so the
  // pour is the biggest non-keepout one.
  const pour = board.zones
    .filter((zone) => !zone.keepout)
    .sort((a, b) => bboxArea(b) - bboxArea(a))[0];

  if (!pour) {
    console.log('  FAIL no copper pour found');
    findings++;
  } else {
    findings += coverage(`pour "${pour.net}" covers the board`, zoneBounds(pour), board.bounds, 'zone', 'board');
  }

  const keepout = board.zones.find((zone) => zone.keepout);
  const mcu = board.footprintBBox('mcu_supermini');
  if (keepout && mcu) {
    findings += coverage('keepout covers the MCU', zoneBounds(keepout), mcu, 'zone', 'MCU');
  }
  return findings;
}

function coverage(what: string, outer: BBox, inner: BBox, outerLabel: string, innerLabel: string): number {
  const covers = bboxCovers(outer, inner);
  console.log(`  ${verdict(covers)} ${what}  (${extent(outerLabel, outer)}; ${extent(innerLabel, inner)})`);
  return covers ? 0 : 1;
}

const extent = (label: string, box: BBox): string =>
  `${label} x ${fixed(box.minX, 1)}..${fixed(box.maxX, 1)} y ${fixed(box.minY, 1)}..${fixed(box.maxY, 1)}`;

const zoneBounds = (zone: Zone): BBox => boundsOf(zone.points)!;

const bboxArea = (zone: Zone): number => {
  const box = zoneBounds(zone);
  return (box.maxX - box.minX) * (box.maxY - box.minY);
};

const section = (title: string): void => console.log(`\n--- ${title} ---`);

const at = ([x, y]: Vec2): string => `${fixed(x, 2)}, ${fixed(y, 2)}`;

/**
 * Prints the worst rows, closest first. Only the first `MAX_ROWS` are shown
 * *and counted* — a quirk of the tool this replaced, kept so a long list stays
 * readable and the reported total stays comparable.
 */
function listWorstFirst<T extends { gap: number }>(violations: T[], line: (row: T) => string): number {
  if (violations.length === 0) {
    console.log('  ok');
    return 0;
  }
  const shown = [...violations].sort((a, b) => a.gap - b.gap).slice(0, MAX_ROWS);
  for (const row of shown) console.log(line(row));
  return shown.length;
}

run(main);
