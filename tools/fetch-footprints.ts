/**
 * Clones (or updates) the ceoloide footprint library the config depends on.
 * Kept out of git: it carries its own licence (CC BY-NC-SA / MIT per file).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { run } from './lib/cli.ts';

const REPO = 'https://github.com/ceoloide/ergogen-footprints';

function main(): void {
  const target = join(import.meta.dirname, 'vendor', 'ergogen-footprints');
  mkdirSync(dirname(target), { recursive: true });

  if (existsSync(join(target, '.git'))) {
    console.log('updating', target);
    execFileSync('git', ['-C', target, 'pull', '--ff-only'], { stdio: 'inherit' });
  } else {
    console.log('cloning', REPO);
    execFileSync('git', ['clone', '--depth', '1', REPO, target], { stdio: 'inherit' });
  }

  const count = readdirSync(target).filter((name) => name.endsWith('.js')).length;
  console.log(`${count} footprints available`);
}

run(main);
