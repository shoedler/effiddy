/**
 * Checks that every switch fits the bottom case: that the parts of a switch
 * which poke through the back of the PCB — the centre post and, on a Choc v1,
 * the two plastic pegs either side of it — land in a cutout rather than on the
 * floor of the case, in both halves.
 *
 * The holes are read from the generated board rather than recomputed, so the
 * check follows the switch footprint and the key layout without knowing either.
 * Each hole is probed at its centre and around its rim, at several depths below
 * the PCB, against the evaluated case mesh.
 *
 * The switch pins are deliberately not checked: they sit in the hotswap
 * sockets, and the reversible footprint drills both sides' pin holes, so half
 * of them are legitimately covered.
 */
import { parseCli, run } from './lib/cli.ts';
import { verdict } from './lib/fmt.ts';
import type { Vec2 } from './lib/geom.ts';
import { readBoard, type Pad } from './lib/kicad.ts';
import { isSolidAt, triangulate, type Triangle } from './lib/jscad/mesh.ts';
import { evaluate } from './lib/jscad/runtime.ts';
import { repoPath } from './lib/paths.ts';

const CASES = ['effiddy_case_bottom_left', 'effiddy_case_bottom_right'];

/** The bottom case is modelled with the PCB pocket at z = 0 and the floor above it. */
const PCB_THICKNESS = 1.6;

/** How far below the back of the PCB to probe. A Choc v1 peg sticks out about 1mm. */
const DEPTHS = [0.2, 1.0, 1.8];

/** Points probed around each hole's rim, plus its centre. */
const RIM_POINTS = 8;

/** What each switch hole is, by drill diameter. Anything else is not checked. */
const PROTRUSIONS: Readonly<Record<string, string>> = {
  '5': 'centre post',
  '1.9': 'choc v1 peg',
};

interface Hole {
  readonly ref: string;
  readonly what: string;
  /** Ergogen's frame: KiCad's y negated. */
  readonly at: Vec2;
  readonly radius: number;
}

function main(): void {
  const args = parseCli({
    usage: 'node tools/check.ts [out] [--pcb out/pcbs/effiddy.kicad_pcb]',
    positionals: { out: { type: 'string', default: 'out', help: 'build output directory' } },
    options: { pcb: { type: 'string', help: 'board to read the switch holes from (default <out>/pcbs/effiddy.kicad_pcb)' } },
  });

  const holes = switchHoles(readBoard(repoPath(args.pcb ?? `${args.out}/pcbs/effiddy.kicad_pcb`)).pads);
  const kinds = [...new Set(holes.map((hole) => hole.what))];
  for (const kind of Object.values(PROTRUSIONS)) {
    if (!kinds.includes(kind)) console.log(`  note: the board has no ${kind} holes`);
  }

  let failed = false;
  for (const name of CASES) {
    console.log(`=== ${name} ===`);
    const triangles = triangulate(evaluate(repoPath(args.out, 'cases', `${name}.jscad`)).toPolygons());

    for (const kind of kinds) {
      const blocked = holes.filter((hole) => hole.what === kind && isBlocked(triangles, hole));
      const total = holes.filter((hole) => hole.what === kind).length;
      console.log(`  ${verdict(blocked.length === 0)} ${kind.padEnd(12)} ${total - blocked.length}/${total} clear`);
      for (const hole of blocked) console.log(`         blocked: ${hole.ref} at (${hole.at.map((v) => v.toFixed(2)).join(', ')})`);
      failed ||= blocked.length > 0;
    }
  }

  if (failed) process.exit(1);
}

function switchHoles(pads: readonly Pad[]): Hole[] {
  return pads.flatMap((pad) => {
    const what = pad.drill === null ? undefined : PROTRUSIONS[String(pad.drill)];
    if (!/^S\d+$/.test(pad.ref) || !what) return [];
    return [{ ref: pad.ref, what, at: [pad.pos[0], -pad.pos[1]] as Vec2, radius: pad.drill! / 2 }];
  });
}

function isBlocked(triangles: readonly Triangle[], { at: [x, y], radius }: Hole): boolean {
  const points: Vec2[] = [[x, y]];
  for (let i = 0; i < RIM_POINTS; i++) {
    const a = (2 * Math.PI * i) / RIM_POINTS;
    points.push([x + radius * Math.cos(a), y + radius * Math.sin(a)]);
  }
  return DEPTHS.some((depth) => points.some((point) => isSolidAt(triangles, point, PCB_THICKNESS + depth)));
}

run(main);
