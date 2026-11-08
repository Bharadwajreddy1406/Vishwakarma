import type { GenContext, GenResult, GeneratorMeta } from './lib/types';
import { build as buildSofa, meta as sofaMeta } from './sofa';

export const meta: GeneratorMeta = {
  id: 'armchair',
  version: 1,
  description: 'Single-seat armchair (a 1-seat sofa with a wider seat). Dynamic: can be pushed.',
  tags: ['living', 'furniture', 'seating', 'dynamic'],
  params: {
    seatWidth: { type: 'number', default: 0.7, min: 0.55, max: 0.9 },
    depth: { type: 'number', default: 0.8, min: 0.65, max: 1.0 },
  },
  slots: { ...sofaMeta.slots },
  physics: 'dynamic',
  mass: 25,
};

export function build(p: Record<string, any>, ctx: GenContext): GenResult {
  return buildSofa({ seats: 1, seatWidth: p.seatWidth, depth: p.depth, arms: true, throwPillows: 1 }, ctx);
}
