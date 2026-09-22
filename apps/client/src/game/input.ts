const MOVE_KEYS = {
  KeyW: { dx: 0, dy: -1 },
  KeyA: { dx: -1, dy: 0 },
  KeyS: { dx: 0, dy: 1 },
  KeyD: { dx: 1, dy: 0 },
} as const;

export class InputController {
  pointerX = 0;
  pointerY = 0;
  pointerDown = false;
  private readonly keys = new Set<string>();

  pressKey(code: string): void {
    this.keys.add(code);
  }

  releaseKey(code: string): void {
    this.keys.delete(code);
  }

  setPointer(x: number, y: number, down?: boolean): void {
    this.pointerX = x;
    this.pointerY = y;
    if (down !== undefined) {
      this.pointerDown = down;
    }
  }

  moveVector(): { dx: number; dy: number } {
    let dx = 0;
    let dy = 0;
    for (const [code, vec] of Object.entries(MOVE_KEYS)) {
      if (this.keys.has(code)) {
        dx += vec.dx;
        dy += vec.dy;
      }
    }
    return { dx, dy };
  }

  isFiring(): boolean {
    return this.pointerDown || this.keys.has('Space');
  }

  attach(keyboardTarget: Window, pointerTarget: HTMLElement): () => void {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        event.preventDefault();
      }
      this.pressKey(event.code);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      this.releaseKey(event.code);
    };
    const pointerPos = (event: PointerEvent) => {
      const rect = pointerTarget.getBoundingClientRect();
      this.pointerX = event.clientX - rect.left;
      this.pointerY = event.clientY - rect.top;
    };
    const onPointerMove = (event: PointerEvent) => {
      pointerPos(event);
    };
    const onPointerDown = (event: PointerEvent) => {
      pointerPos(event);
      this.pointerDown = true;
    };
    const onPointerUp = () => {
      this.pointerDown = false;
    };

    keyboardTarget.addEventListener('keydown', onKeyDown);
    keyboardTarget.addEventListener('keyup', onKeyUp);
    pointerTarget.addEventListener('pointermove', onPointerMove);
    pointerTarget.addEventListener('pointerdown', onPointerDown);
    pointerTarget.addEventListener('pointerup', onPointerUp);
    pointerTarget.addEventListener('pointerleave', onPointerUp);

    return () => {
      keyboardTarget.removeEventListener('keydown', onKeyDown);
      keyboardTarget.removeEventListener('keyup', onKeyUp);
      pointerTarget.removeEventListener('pointermove', onPointerMove);
      pointerTarget.removeEventListener('pointerdown', onPointerDown);
      pointerTarget.removeEventListener('pointerup', onPointerUp);
      pointerTarget.removeEventListener('pointerleave', onPointerUp);
    };
  }
}
