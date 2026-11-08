import * as THREE from 'three';
import type { Plan, Vec2 } from '../types';
import { pointInPolygon, toPlan } from '../core/coords';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class Hud {
  private prompt = $('prompt');
  private room = $('room');
  private stance = $('stance');
  private fps = $('fps');
  private toastEl = $('toast');
  private map = $<HTMLCanvasElement>('minimap');
  private compass = $<HTMLCanvasElement>('compass');
  private cctx = this.compass.getContext('2d')!;
  private northDeg: number;
  private ctx = this.map.getContext('2d')!;
  private toastTimer = 0;
  private frames = 0;
  private fpsT = 0;
  private bounds: { minX: number; minY: number; scale: number; ox: number; oy: number };
  private base?: ImageData;

  constructor(private plan: Plan) {
    const xs = plan.walls.flatMap((w) => [w.a[0], w.b[0]]), ys = plan.walls.flatMap((w) => [w.a[1], w.b[1]]);
    const minX = Math.min(...xs) - 0.6, maxX = Math.max(...xs) + 0.6, minY = Math.min(...ys) - 0.6, maxY = Math.max(...ys) + 0.6;
    const S = this.map.width;
    const scale = Math.min(S / (maxX - minX), S / (maxY - minY));
    this.bounds = { minX, minY, scale, ox: (S - (maxX - minX) * scale) / 2, oy: (S - (maxY - minY) * scale) / 2 };
    this.northDeg = plan.site?.north_deg ?? 0;
    this.refresh();
  }

  private px([x, y]: Vec2): [number, number] {
    const b = this.bounds;
    return [b.ox + (x - b.minX) * b.scale, this.map.height - (b.oy + (y - b.minY) * b.scale)];
  }

  /** redraw the minimap base (after the editor changed walls) */
  refresh(): void {
    const c = this.ctx;
    c.clearRect(0, 0, this.map.width, this.map.height);
    c.font = '9px system-ui';
    c.textAlign = 'center';
    for (const r of this.plan.rooms) {
      c.beginPath();
      r.polygon.forEach((p, i) => (i ? c.lineTo(...this.px(p)) : c.moveTo(...this.px(p))));
      c.closePath();
      c.fillStyle = 'rgba(232,163,61,0.10)';
      c.fill();
      const cx = r.polygon.reduce((s, p) => s + p[0], 0) / r.polygon.length, cy = r.polygon.reduce((s, p) => s + p[1], 0) / r.polygon.length;
      c.fillStyle = 'rgba(245,239,230,0.75)';
      c.fillText(r.name, ...this.px([cx, cy]));
    }
    c.strokeStyle = '#f5efe6';
    c.lineCap = 'square';
    for (const w of this.plan.walls) {
      c.lineWidth = Math.max(1.5, w.thickness * this.bounds.scale);
      c.beginPath();
      c.moveTo(...this.px(w.a));
      c.lineTo(...this.px(w.b));
      c.stroke();
    }
    // true-north arrow in the minimap corner
    const nd = (this.northDeg * Math.PI) / 180;
    c.save();
    c.translate(this.map.width - 18, 20);
    c.rotate(-nd);
    c.fillStyle = '#e8a33d';
    c.beginPath(); c.moveTo(0, -11); c.lineTo(5, 4); c.lineTo(0, 1); c.lineTo(-5, 4); c.closePath(); c.fill();
    c.fillStyle = '#f5efe6'; c.font = 'bold 9px system-ui'; c.fillText('N', 0, 14);
    c.restore();
    this.base = c.getImageData(0, 0, this.map.width, this.map.height);
  }

  /** compass dial: rotates with the view; heading = compass bearing you are facing */
  private drawCompass(yaw: number): void {
    const c = this.cctx, S = this.compass.width, R = S / 2 - 6;
    const bearing = ((this.northDeg - (yaw * 180) / Math.PI) % 360 + 360) % 360;
    c.clearRect(0, 0, S, S);
    c.save();
    c.translate(S / 2, S / 2);
    c.fillStyle = 'rgba(15,14,12,.72)';
    c.beginPath(); c.arc(0, 0, R + 4, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(255,255,255,.14)'; c.lineWidth = 1; c.stroke();
    for (let d = 0; d < 360; d += 15) {
      const a = ((d - bearing) * Math.PI) / 180;
      const major = d % 90 === 0, mid = d % 45 === 0;
      const r0 = major ? R - 10 : mid ? R - 7 : R - 4;
      c.strokeStyle = major ? '#f5efe6' : 'rgba(245,239,230,.5)';
      c.lineWidth = major ? 2 : 1;
      c.beginPath(); c.moveTo(Math.sin(a) * r0, -Math.cos(a) * r0); c.lineTo(Math.sin(a) * R, -Math.cos(a) * R); c.stroke();
    }
    const labels: [number, string][] = [[0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'], [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW']];
    for (const [d, t] of labels) {
      const a = ((d - bearing) * Math.PI) / 180;
      const r = t.length === 1 ? R - 20 : R - 19;
      c.fillStyle = t === 'N' ? '#e8a33d' : t.length === 1 ? '#f5efe6' : 'rgba(245,239,230,.6)';
      c.font = `${t.length === 1 ? 'bold 13px' : '9px'} system-ui`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(t, Math.sin(a) * r, -Math.cos(a) * r);
    }
    // facing marker
    c.fillStyle = '#e8a33d';
    c.beginPath(); c.moveTo(0, -R - 2); c.lineTo(5, -R + 7); c.lineTo(-5, -R + 7); c.closePath(); c.fill();
    c.fillStyle = '#f5efe6'; c.font = 'bold 12px ui-monospace, monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(`${Math.round(bearing)}°`, 0, 2);
    c.restore();
  }

  update(dt: number, player: THREE.Vector3, yaw: number, stance: string): void {
    this.frames++;
    this.fpsT += dt;
    if (this.fpsT > 0.5) {
      this.fps.textContent = `${Math.round(this.frames / this.fpsT)} fps`;
      this.frames = 0;
      this.fpsT = 0;
    }
    const p = toPlan(player);
    const r = this.plan.rooms.find((rm) => pointInPolygon(p, rm.polygon));
    this.room.textContent = r ? r.name : 'Outside';
    this.stance.textContent = stance;
    if (this.toastTimer > 0 && (this.toastTimer -= dt) <= 0) this.toastEl.hidden = true;
    this.drawCompass(yaw);

    if (!this.map.classList.contains('off') && this.base) {
      const c = this.ctx;
      c.putImageData(this.base, 0, 0);
      const [x, y] = this.px(p);
      c.save();
      c.translate(x, y);
      c.rotate(-yaw);
      c.fillStyle = '#e8a33d';
      c.beginPath();
      c.moveTo(0, -8); c.lineTo(5, 6); c.lineTo(0, 3); c.lineTo(-5, 6);
      c.closePath();
      c.fill();
      c.restore();
    }
  }

  setPrompt(text: string | null): void {
    this.prompt.hidden = !text;
    if (text) this.prompt.querySelector('span')!.textContent = text;
  }

  toast(text: string, secs = 1.6): void {
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    this.toastTimer = secs;
  }

  toggleMap(): void {
    this.map.classList.toggle('off');
  }
}
