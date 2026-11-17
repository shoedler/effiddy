import { relative, resolve } from 'node:path';

/** The repository root, so every tool takes the same paths the README shows. */
export const ROOT = resolve(import.meta.dirname, '..', '..');

export const repoPath = (...parts: string[]): string => resolve(ROOT, ...parts);

export const fromRoot = (path: string): string => relative(ROOT, path);
