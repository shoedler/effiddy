/**
 * Runs KiCad's own DRC on a board and summarises it.
 *
 * Needs `kicad-cli` (KiCad 8+) on PATH, so this is the KiCad-machine half of
 * the checks; `tools/drc-lite.ts` covers what can be checked without it.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseCli, run } from './lib/cli.ts';
import { fromRoot, repoPath } from './lib/paths.ts';

interface Violation {
  readonly severity: string;
  readonly type: string;
}

interface Report {
  readonly violations?: Violation[];
  readonly unconnected_items?: Violation[];
  readonly schematic_parity?: Violation[];
}

function main(): void {
  const args = parseCli({
    usage: 'node tools/drc.ts [--pcb out/pcbs/effiddy.kicad_pcb] [--json out/drc.json]',
    options: {
      pcb: { type: 'string', default: 'out/pcbs/effiddy.kicad_pcb', help: 'board to check' },
      json: { type: 'string', default: 'out/drc.json', help: 'where to leave the full report' },
    },
  });

  requireKicadCli();

  const json = repoPath(args.json);
  mkdirSync(dirname(json), { recursive: true });
  runDrc(repoPath(args.pcb), json);

  const report = JSON.parse(readFileSync(json, 'utf8')) as Report;
  const errors =
    summarise('violations', report.violations) +
    summarise('unconnected items', report.unconnected_items) +
    summarise('schematic parity', report.schematic_parity);

  console.log(`\nfull report: ${fromRoot(json)}`);
  console.log(`${errors} error-severity item(s)`);
  console.log('Note: on an unrouted board every net shows up as an unconnected item,');
  console.log('and each switch overlaps its own diode courtyard. Both are expected.');
}

function requireKicadCli(): void {
  if (!spawnSync('kicad-cli', ['version'], { stdio: 'ignore' }).error) return;

  console.error('kicad-cli not found on PATH.');
  console.error('Install KiCad 8+ (Linux: your package manager, or the KiCad flatpak -');
  console.error('for the flatpak use: flatpak run --command=kicad-cli org.kicad.KiCad ...).');
  console.error('Meanwhile `node tools/drc-lite.ts` covers the pre-routing checks.');
  process.exit(2);
}

function runDrc(pcb: string, json: string): void {
  const flags = ['pcb', 'drc', '--output', json, '--format', 'json', '--severity-all', '--exit-code-violations', pcb];
  try {
    execFileSync('kicad-cli', flags, { stdio: ['ignore', 'inherit', 'inherit'] });
  } catch (error) {
    // --exit-code-violations makes a non-zero exit mean "found something",
    // which is exactly what we are about to summarise ourselves.
    if (!(error instanceof Error) || !('status' in error)) throw error;
  }
}

/** Prints one group, commonest type first, and returns its error count. */
function summarise(label: string, items: Violation[] = []): number {
  const bySeverity = tally(items.map((item) => item.severity));
  const byType = tally(items.map((item) => item.type));

  console.log(`\n--- ${label}: ${items.length} ---`);
  for (const [type, count] of [...byType].sort(([, a], [, b]) => b - a)) {
    console.log(`  ${String(count).padStart(4)}  ${type}`);
  }
  if (items.length) console.log(`  severities: ${JSON.stringify(Object.fromEntries(bySeverity))}`);

  return bySeverity.get('error') ?? 0;
}

function tally(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

run(main);
