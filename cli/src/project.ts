import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECTS, assertName, projectDir } from './paths.js';

export const STAGES = ['extract', 'interpret', 'verify', 'furnish', 'play'] as const;
export type Stage = (typeof STAGES)[number];
export type StageState = 'pending' | 'done' | 'failed' | 'needs-review';

export interface ProjectMeta {
  name: string;
  created: string;
  updated: string;
  stages: Record<Stage, { state: StageState; at?: string; note?: string }>;
}

export function projectExists(name: string): boolean {
  return existsSync(join(projectDir(name), 'project.json'));
}

export function requireProject(name: string): string {
  assertName(name);
  if (!projectExists(name)) throw new Error(`Project "${name}" not found. Run: vk list`);
  return projectDir(name);
}

export function readMeta(name: string): ProjectMeta {
  return JSON.parse(readFileSync(join(projectDir(name), 'project.json'), 'utf8'));
}

export function writeMeta(meta: ProjectMeta): void {
  meta.updated = new Date().toISOString();
  writeFileSync(join(projectDir(meta.name), 'project.json'), JSON.stringify(meta, null, 2) + '\n');
}

export function setStage(name: string, stage: Stage, state: StageState, note?: string): void {
  const meta = readMeta(name);
  meta.stages[stage] = { state, at: new Date().toISOString(), ...(note ? { note } : {}) };
  writeMeta(meta);
}

export function createProject(name: string): string {
  assertName(name);
  const dir = projectDir(name);
  if (existsSync(dir)) throw new Error(`Project "${name}" already exists`);
  for (const sub of ['input', 'work', 'assets']) mkdirSync(join(dir, sub), { recursive: true });
  const now = new Date().toISOString();
  const stages = Object.fromEntries(STAGES.map((s) => [s, { state: 'pending' }])) as ProjectMeta['stages'];
  writeMeta({ name, created: now, updated: now, stages });
  writeFileSync(join(dir, 'assets', 'registry.json'), JSON.stringify({ generators: [], materials: [], palettes: [] }, null, 2) + '\n');
  writeFileSync(
    join(dir, 'input', 'README.md'),
    `# ${name} — inputs\n\nDrop here:\n- the floor-plan PDF (vector, with dimensions)\n- reference images / renders / miniature photos (optional)\n- notes.md with anything the PDF does not say (wall height, flooring, colours…)\n\nThen in Claude Code run: /vk-build ${name}\n`,
  );
  return dir;
}

export function listProjects(): ProjectMeta[] {
  if (!existsSync(PROJECTS)) return [];
  return readdirSync(PROJECTS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && projectExists(d.name))
    .map((d) => readMeta(d.name));
}

export function findInputPdf(name: string): string | undefined {
  const dir = join(projectDir(name), 'input');
  const pdfs = existsSync(dir) ? readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf')) : [];
  if (pdfs.length === 0) {
    // also accept PDFs dropped at the project root
    const rootPdfs = readdirSync(projectDir(name)).filter((f) => f.toLowerCase().endsWith('.pdf'));
    return rootPdfs[0] ? join(projectDir(name), rootPdfs[0]) : undefined;
  }
  return join(dir, pdfs[0]);
}
