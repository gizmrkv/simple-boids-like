import type { World } from './world';

export function render(ctx: CanvasRenderingContext2D, world: World): void {
  ctx.clearRect(0, 0, world.width, world.height);

  for (const base of world.bases) {
    ctx.fillStyle = '#4dabf7';
    ctx.fillRect(base.pos.x - 6, base.pos.y - 6, 12, 12);
    ctx.fillStyle = '#cfe8ff';
    ctx.font = '10px monospace';
    ctx.fillText(String(base.stored), base.pos.x + 8, base.pos.y - 8);
  }

  for (const res of world.resources) {
    if (res.amount <= 0) continue;
    ctx.beginPath();
    ctx.arc(res.pos.x, res.pos.y, 4 + Math.min(res.amount, 10), 0, Math.PI * 2);
    ctx.fillStyle = '#69db7c';
    ctx.fill();
  }

  for (const boid of world.boids) {
    const angle = Math.atan2(boid.vel.y, boid.vel.x);
    ctx.save();
    ctx.translate(boid.pos.x, boid.pos.y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(5, 0);
    ctx.lineTo(-4, 3);
    ctx.lineTo(-4, -3);
    ctx.closePath();
    ctx.fillStyle = boid.cargo > 0 ? '#ffd43b' : '#e9ecef';
    ctx.fill();
    ctx.restore();
  }
}
