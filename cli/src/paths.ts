import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Workspace root = two levels above cli/dist. Falls back to walking up from cwd. */
function findRoot(): string {
  const fromCli = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  if (isRoot(fromCli)) return fromCli;
  let dir = process.cwd();
  while (true) {
    if (isRoot(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('Not inside a Vishwakarma workspace');
    dir = parent;
  }
}

function isRoot(dir: string): boolean {
  const pkg = join(dir, 'package.json');
  if (!existsSync(pkg)) return false;
  try {
    return JSON.parse(readFileSync(pkg, 'utf8')).name === 'vishwakarma-ai';
  } catch {
    return false;
  }
}

export const ROOT = findRoot();
export const PROJECTS = join(ROOT, 'projects');
export const COMMON = join(ROOT, 'common');
export const ENGINE = join(ROOT, 'engine');
export const PIPELINE = join(ROOT, 'pipeline');
export const VENV = join(ROOT, '.venv');
export const PYTHON = process.platform === 'win32'
  ? join(VENV, 'Scripts', 'python.exe')
  : join(VENV, 'bin', 'python');

export const projectDir = (name: string) => join(PROJECTS, name);

const NAME_RE = /^[a-z0-9][a-z0-9-_]{0,62}$/;
export function assertName(name: string): void {
  if (!NAME_RE.test(name)) {
    throw new Error(`Invalid project name "${name}". Use lowercase letters, digits, - or _.`);
  }
}
