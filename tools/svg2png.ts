/** Rasterises an SVG, optionally at a given pixel width. */
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { parseCli, run } from './lib/cli.ts';
import { repoPath } from './lib/paths.ts';

function main(): void {
  const args = parseCli({
    usage: 'node tools/svg2png.ts <in.svg> <out.png> [width]',
    positionals: {
      input: { type: 'string', help: 'the SVG to read' },
      output: { type: 'string', help: 'the PNG to write' },
      width: { type: 'number', help: 'output width in pixels; omit to keep the SVG size' },
    },
  });
  if (!args.input || !args.output) throw new Error('an input and an output path are required');

  const renderer = new Resvg(readFileSync(repoPath(args.input), 'utf8'), {
    fitTo: args.width === undefined ? { mode: 'original' } : { mode: 'width', value: Math.trunc(args.width) },
    background: 'white',
  });
  writeFileSync(repoPath(args.output), renderer.render().asPng());
  console.log('wrote', args.output);
}

run(main);
