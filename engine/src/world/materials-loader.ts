import { MaterialLibrary, type MaterialPreset, type Palette } from '@common/generators/lib/materials';

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

async function exists(url: string): Promise<boolean> {
  try { return (await fetch(url, { method: 'HEAD' })).ok; } catch { return false; }
}

/** material presets + palette; CC0 photo maps are used only for files that actually exist on disk */
export async function loadMaterials(paletteId: string): Promise<MaterialLibrary> {
  const lib = await getJson<{ materials: MaterialPreset[] }>('/vk/common/materials/library.json');
  const files = new Set<string>();
  await Promise.all(lib.materials.flatMap((m) => Object.values(m.maps ?? {}).map(async (f) => {
    if (f && (await exists(`/vk/common/${f}`))) files.add(f);
  })));
  const ml = new MaterialLibrary('/vk/common', files);
  ml.add(lib.materials);
  try { ml.palette = await getJson<Palette>(`/vk/common/palettes/${paletteId}.json`); } catch { console.warn(`palette ${paletteId} missing`); }
  return ml;
}
