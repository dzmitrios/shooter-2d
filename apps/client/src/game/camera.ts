export class FollowCamera {
  x = 0;
  y = 0;
  ready = false;
  stiffness = 12;

  reset(): void {
    this.x = 0;
    this.y = 0;
    this.ready = false;
  }

  snapTo(targetX: number, targetY: number, viewWidth: number, viewHeight: number): void {
    this.x = targetX - viewWidth / 2;
    this.y = targetY - viewHeight / 2;
    this.ready = true;
  }

  follow(targetX: number, targetY: number, viewWidth: number, viewHeight: number, dt: number): void {
    const desiredX = targetX - viewWidth / 2;
    const desiredY = targetY - viewHeight / 2;
    if (!this.ready) {
      this.x = desiredX;
      this.y = desiredY;
      this.ready = true;
      return;
    }
    const t = 1 - Math.exp(-this.stiffness * dt);
    this.x += (desiredX - this.x) * t;
    this.y += (desiredY - this.y) * t;
  }

  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return { x: screenX + this.x, y: screenY + this.y };
  }
}
