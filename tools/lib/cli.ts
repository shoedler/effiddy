import { parseArgs } from 'node:util';

export type Kind = 'string' | 'number' | 'boolean';

type Value<K extends Kind> = K extends 'string' ? string : K extends 'number' ? number : boolean;

export interface Flag<K extends Kind = Kind> {
  readonly type: K;
  readonly default?: Value<K>;
  /** Repeatable; collects every occurrence. */
  readonly many?: boolean;
  readonly help?: string;
}

export interface Spec {
  readonly usage: string;
  readonly positionals?: Record<string, Flag<'string' | 'number'>>;
  readonly options?: Record<string, Flag>;
}

type Resolve<F extends Flag> = F extends { many: true }
  ? Value<F['type']>[]
  : F['type'] extends 'boolean'
    ? boolean
    : F extends { default: unknown }
      ? Value<F['type']>
      : Value<F['type']> | undefined;

type Fields<R> = R extends Record<string, Flag> ? { [K in keyof R]: Resolve<R[K]> } : object;

export type Args<S extends Spec> = Fields<S['positionals']> & Fields<S['options']>;

/**
 * Parses argv against a spec, inferring each field's type from it, and exits
 * with usage on anything malformed or on `--help`.
 */
export function parseCli<const S extends Spec>(spec: S, argv = process.argv.slice(2)): Args<S> {
  const options = spec.options ?? {};
  const positionals = spec.positionals ?? {};

  const parsed = tryParse(spec, options, argv);
  if (parsed.values['help'] === true) usage(spec, 0);

  const result: Record<string, unknown> = {};
  for (const [name, flag] of Object.entries(options)) {
    result[name] = resolve(spec, `--${name}`, flag, parsed.values[name]);
  }
  Object.keys(positionals).forEach((name, index) => {
    const flag = positionals[name]!;
    result[name] = resolve(spec, name, flag, parsed.positionals[index]);
  });
  return result as Args<S>;
}

interface Parsed {
  values: Record<string, unknown>;
  positionals: string[];
}

function tryParse(spec: Spec, options: Record<string, Flag>, argv: string[]): Parsed {
  const config = Object.fromEntries(
    Object.entries(options).map(([name, flag]) => [
      name,
      { type: flag.type === 'boolean' ? ('boolean' as const) : ('string' as const), multiple: flag.many === true },
    ]),
  );
  try {
    return parseArgs({
      args: argv,
      options: { ...config, help: { type: 'boolean' } },
      allowPositionals: true,
    });
  } catch (error) {
    usage(spec, 2, error instanceof Error ? error.message : String(error));
  }
}

function resolve(spec: Spec, label: string, flag: Flag, raw: unknown): unknown {
  if (flag.many) {
    const given = Array.isArray(raw) ? raw : [];
    return flag.type === 'number' ? given.map((v) => toNumber(spec, label, String(v))) : given;
  }
  if (flag.type === 'boolean') return raw === true || flag.default === true;
  if (raw === undefined) return flag.default;
  return flag.type === 'number' ? toNumber(spec, label, String(raw)) : String(raw);
}

function toNumber(spec: Spec, label: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) usage(spec, 2, `${label} expects a number, got "${raw}"`);
  return value;
}

function usage(spec: Spec, code: number, message?: string): never {
  const out = code === 0 ? console.log : console.error;
  if (message) out(`error: ${message}\n`);
  out(`usage: ${spec.usage}`);
  const rows = [
    ...Object.entries(spec.positionals ?? {}).map(([name, flag]) => [name, flag] as const),
    ...Object.entries(spec.options ?? {}).map(([name, flag]) => [`--${name}`, flag] as const),
  ].filter(([, flag]) => flag.help);
  if (rows.length) {
    const width = Math.max(...rows.map(([label]) => label.length));
    out('');
    for (const [label, flag] of rows) {
      const fallback = flag.default === undefined ? '' : ` (default ${flag.default})`;
      out(`  ${label.padEnd(width)}  ${flag.help}${fallback}`);
    }
  }
  process.exit(code);
}

/**
 * Runs a tool, reporting a missing file as one line rather than a stack. Any
 * other failure is a bug and keeps its stack.
 */
export function run(main: () => void): void {
  try {
    main();
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    console.error(`error: ${error.path} does not exist`);
    process.exit(1);
  }
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException & { path: string } {
  const failure = error as NodeJS.ErrnoException;
  return error instanceof Error && failure.code === 'ENOENT' && typeof failure.path === 'string';
}
