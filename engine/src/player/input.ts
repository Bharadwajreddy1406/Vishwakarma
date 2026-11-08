/** Keyboard + pointer-lock mouse. Continuous keys are polled; toggles fire callbacks on keydown. */
export class Input {
  private down = new Set<string>();
  private handlers = new Map<string, () => void>();
  dx = 0;
  dy = 0;
  sensitivity = 1;
  locked = false;
  onLockChange?: (locked: boolean) => void;

  constructor(private el: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (!this.locked && e.code !== 'Escape') return;
      if (['Space', 'Tab', 'KeyF', 'KeyC', 'Backspace', 'KeyZ', 'KeyP', 'KeyX', 'KeyR', 'KeyE'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.handlers.get(e.code)?.();
      this.down.add(e.code);
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) this.down.clear();
      this.onLockChange?.(this.locked);
    });
  }

  lock(): void {
    const p = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
    p?.catch?.(() => undefined);
  }

  on(code: string, fn: () => void): void {
    this.handlers.set(code, fn);
  }

  held(code: string): boolean {
    return this.down.has(code);
  }

  /** returns accumulated mouse delta (pixels * sensitivity) and resets it */
  consumeMouse(): [number, number] {
    const r: [number, number] = [this.dx * this.sensitivity, this.dy * this.sensitivity];
    this.dx = this.dy = 0;
    return r;
  }
}
