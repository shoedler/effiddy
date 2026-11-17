/**
 * Pins the footprint rotation convention against KiCad's own output.
 *
 * KiCad footprint angles are counter-clockwise as displayed, but the file's y
 * axis points down, so rotating a footprint-local offset into board coordinates
 * is a rotation by *minus* the angle. Getting that sign backwards silently
 * misplaces the pads of every rotated footprint — which happened in ezy54, where
 * these tools come from, and cost a PCB revision.
 *
 * The comparison is against the coordinates in a KiCad-generated Excellon drill
 * file, read straight out of the committed `kicad/gerber.zip` so this works on a
 * fresh clone with no KiCad installed. Non-plated holes are used because their
 * coordinates come straight from the footprint with no routing in between.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import JSZip from 'jszip';
import { distance, minOf, type Vec2 } from '../lib/geom.ts';
import { readBoard, type Pad } from '../lib/kicad.ts';
import { repoPath } from '../lib/paths.ts';

/** Millimetres. Drill files round to three decimals. */
const TOLERANCE = 0.02;

interface Hole {
  readonly at: Vec2;
  readonly diameter: number;
}

describe('footprint rotation', async () => {
  const holes = await readNonPlatedHoles(repoPath('kicad/gerber.zip'));

  if (holes.length === 0) {
    it('skipped: no drill file to compare against', { skip: 'export gerbers from KiCad to enable this' }, () => {});
    return;
  }

  const drilled = readBoard(repoPath('kicad/effiddy.kicad_pcb')).pads.filter((pad) => pad.drill !== null && !pad.net);

  it(`matches all ${holes.length} drilled holes to a computed pad`, () => {
    let worst = 0;
    for (const hole of holes) {
      const candidates = drilled.filter((pad) => Math.abs(pad.drill! - hole.diameter) < 0.01);
      assert.ok(candidates.length > 0, `no computed pad is ${hole.diameter}mm across`);

      const off = minOf(candidates, (pad: Pad) => distance(pad.pos, hole.at));
      worst = Math.max(worst, off);
      assert.ok(
        off <= TOLERANCE,
        `${hole.diameter}mm hole at (${hole.at}) is ${off.toFixed(3)}mm from the nearest computed pad — ` +
          'the rotation convention in geom.rotateKicad is the usual cause',
      );
    }
    // The real board currently matches to 0.0005mm; anything near the tolerance
    // means something has drifted.
    assert.ok(worst < TOLERANCE / 10, `worst match ${worst.toFixed(4)}mm is suspiciously close to the tolerance`);
  });
});

async function readNonPlatedHoles(zipPath: string): Promise<Hole[]> {
  let archive;
  try {
    archive = await JSZip.loadAsync(readFileSync(zipPath));
  } catch {
    return [];
  }
  const entry = Object.values(archive.files).find((file) => file.name.toUpperCase().endsWith('NPTH.DRL'));
  return entry ? parseExcellon(await entry.async('string')) : [];
}

function parseExcellon(text: string): Hole[] {
  const tools = new Map<string, number>();
  const holes: Hole[] = [];
  let current: number | undefined;

  for (const line of text.split(/\r?\n/)) {
    const definition = /^T(\d+)C([\d.]+)$/.exec(line.trim());
    const select = /^T(\d+)$/.exec(line.trim());
    const position = /^X(-?[\d.]+)Y(-?[\d.]+)$/.exec(line.trim());

    if (definition) tools.set(definition[1]!, Number(definition[2]));
    else if (select) current = tools.get(select[1]!);
    // Drill files are y-up; the .kicad_pcb is y-down.
    else if (position && current !== undefined) {
      holes.push({ at: [Number(position[1]), -Number(position[2])], diameter: current });
    }
  }
  return holes;
}
