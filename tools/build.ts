/**
 * Builds `ergogen/config.yml` into `out/`.
 *
 * Ergogen wants a folder holding `config.yaml` plus `footprints/<lib>/*.js`, so
 * this assembles one in a temp directory and points the CLI at it.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCli, run } from './lib/cli.ts';
import { fromRoot, repoPath } from './lib/paths.ts';

const FOOTPRINT_LIBRARY = 'ceoloide';

function main(): void {
  const args = parseCli({
    usage: 'node tools/build.ts [--config ergogen/config.yml] [--out out]',
    options: {
      config: { type: 'string', default: 'ergogen/config.yml', help: 'ergogen config to build' },
      out: { type: 'string', default: 'out', help: 'where to write the results' },
    },
  });

  const footprints = repoPath('tools/vendor/ergogen-footprints');
  if (!existsSync(footprints)) {
    console.error('missing footprints - run: npm --prefix tools run footprints');
    process.exit(1);
  }

  const outDir = repoPath(args.out);
  const bundle = mkdtempSync(join(tmpdir(), 'effiddy-'));
  try {
    assemble(bundle, repoPath(args.config), footprints);
    rmSync(outDir, { recursive: true, force: true });
    // -d keeps the debug output, which is where points.yaml and units.yaml come
    // from; every check reads them.
    const cli = createRequire(import.meta.url).resolve('ergogen/src/cli.js');
    execFileSync(process.execPath, [cli, bundle, '-o', outDir, '-d'], { stdio: 'inherit' });
  } finally {
    rmSync(bundle, { recursive: true, force: true });
  }

  console.log(`\nwrote ${fromRoot(outDir)}/ (outlines, cases, pcbs, points)`);
}

function assemble(bundle: string, config: string, footprints: string): void {
  const library = join(bundle, 'footprints', FOOTPRINT_LIBRARY);
  mkdirSync(library, { recursive: true });
  for (const file of readdirSync(footprints).filter((name) => name.endsWith('.js'))) {
    copyFileSync(join(footprints, file), join(library, file));
  }
  copyFileSync(config, join(bundle, 'config.yaml'));
}

run(main);
