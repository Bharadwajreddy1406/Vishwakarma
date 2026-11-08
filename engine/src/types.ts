/** TypeScript mirrors of schemas/plan.schema.json and schemas/scene.schema.json */
export type Vec2 = [number, number];

export interface PlanWall { id: string; a: Vec2; b: Vec2; thickness: number; height?: number; exterior?: boolean }
export interface PlanOpening {
  id: string; wall: string; type: 'door' | 'window' | 'opening' | 'sliding_door' | 'ventilator';
  offset: number; width: number; height?: number; sill?: number; hinge?: 'a' | 'b'; swing?: 'left' | 'right';
  leaves?: number; connects?: string[];
}
export interface PlanRoom { id: string; name: string; type: string; polygon: Vec2[]; labeled?: { text?: string; w?: number; l?: number }; floor_level?: number }
export interface Plan {
  version: 1; units: 'm';
  source?: Record<string, unknown>;
  site?: { latitude?: number; north_deg?: number; floor?: number; unit?: string; entrance?: string; outside?: { kind: string; polygon: Vec2[] }[] };
  defaults?: { wall_height?: number; door_height?: number; window_sill?: number; window_height?: number };
  walls: PlanWall[]; openings: PlanOpening[]; rooms: PlanRoom[];
  fixtures?: { kind: string; room: string; center?: Vec2; size?: Vec2; rotation?: number }[];
  notes?: string[];
}

export interface SceneObject {
  id: string; generator: string; params?: Record<string, unknown>; room?: string;
  position: Vec2; elevation?: number; rotation?: number; materials?: Record<string, string>;
  physics?: 'static' | 'dynamic' | 'none';
}
export interface FalseCeiling {
  height: number; rooms?: string[]; exclude_types?: string[]; cove_types?: string[];
  band?: number; recess?: number; led?: string;
}

export interface Scene {
  version: 1; plan: string; palette?: string;
  environment?: {
    hdri?: string; sun?: { azimuth?: number; elevation?: number; intensity?: number }; ceilings?: boolean; ground?: string;
    false_ceiling?: FalseCeiling;
    /** local solar time 0-24 (default 10) and date MM-DD (default today) */
    time?: number; date?: string;
    /** bathroom wall tile height (m, default 1.372 = 4'6") */
    wet_dado_height?: number;
  };
  materials?: Partial<Record<'wall_interior' | 'wall_exterior' | 'floor' | 'ceiling' | 'door' | 'window_frame', string>>;
  rooms?: Record<string, { floor?: string; wall?: string; ceiling?: string; light?: { color?: string; intensity?: number } }>;
  openings?: Record<string, { generator?: string; params?: Record<string, unknown>; materials?: Record<string, string> }>;
  objects: SceneObject[];
  /** extra hand-placed viewpoints (furniture-based ones are generated automatically) */
  viewpoints?: { id?: string; name: string; room?: string; position: Vec2; eye?: number; heading?: number; pitch?: number }[];
  spawn?: { position?: Vec2; heading?: number };
  /** design changes made in the editor on top of the verified plan (plan.json stays as drawn) */
  plan_edits?: { walls?: Record<string, { a: Vec2; b: Vec2 }> };
}
