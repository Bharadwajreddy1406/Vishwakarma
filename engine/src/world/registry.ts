/** Generator lookup: common/generators/*.ts (shared) and projects/<name>/assets/*.ts ("local:<id>"). */
import type { Generator } from '@common/generators/lib/types';

const common = import.meta.glob('../../../common/generators/*.ts', { eager: true }) as Record<string, Generator>;
const local = import.meta.glob('../../../projects/*/assets/*.ts') as Record<string, () => Promise<Generator>>;

const byId = new Map<string, Generator>();
for (const mod of Object.values(common)) {
  if (mod?.meta?.id && typeof mod.build === 'function') byId.set(mod.meta.id, mod);
}

export function listGenerators(): Generator[] {
  return [...byId.values()].sort((a, b) => a.meta.id.localeCompare(b.meta.id));
}

export async function getGenerator(id: string, project?: string): Promise<Generator | undefined> {
  if (id.startsWith('local:')) {
    const name = id.slice(6);
    const key = Object.keys(local).find((k) => k.includes(`/projects/${project}/assets/`) && k.endsWith(`/${name}.ts`));
    if (!key) return undefined;
    const mod = await local[key]();
    return mod?.meta && typeof mod.build === "function" ? mod : undefined;
  }
  return byId.get(id);
}
