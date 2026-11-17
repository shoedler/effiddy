/** Evaluates every generated `.jscad` into an STL and reports its bounds and volume. */
import { mkdirSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseCli, run } from './lib/cli.ts';
import { describe, writeStl } from './lib/jscad/report.ts';
import { repoPath } from './lib/paths.ts';

function main(): void {
  const args = parseCli({
    usage: 'node tools/cases.ts [--out dir]',
    options: { out: { type: 'string', default: 'out', help: 'build output directory' } },
  });

  const casesDir = repoPath(args.out, 'cases');
  const stlDir = repoPath(args.out, 'stl');
  mkdirSync(stlDir, { recursive: true });

  for (const file of readdirSync(casesDir).filter((name) => name.endsWith('.jscad'))) {
    const name = basename(file, '.jscad');
    if (name.startsWith('_')) continue; // intermediate parts

    console.log(`### ${name}`);
    const { triangles } = describe(join(casesDir, file));
    writeStl(triangles, join(stlDir, `${name}.stl`));
  }
}

run(main);
