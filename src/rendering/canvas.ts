import { CONFIG, type State } from '../game/environment.js';

// Atlas coordinates from Chromium's original ldpi sprite definitions.
// See public/assets/CHROMIUM-LICENSE and THIRD_PARTY_NOTICES.md.
function drawDigits(ctx: CanvasRenderingContext2D, atlas: CanvasImageSource, text: string, x: number): void {
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;
    if (character === ' ') continue;
    const glyph = character === 'H' ? 10 : character === 'I' ? 11 : Number(character);
    ctx.drawImage(atlas, 655 + glyph * 10, 2, 10, 13, x + index * 11, 20, 10, 13);
  }
}

export function render(
  ctx: CanvasRenderingContext2D, state: State, paused: boolean,
  atlas: CanvasImageSource, bestDistance: number, showPlayer = true,
): void {
  const { width, height, groundY } = CONFIG;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Decorative parallax is a pure function of distance; it never consumes environment RNG.
  const cloudPositions = [[170, 74], [455, 103], [735, 56], [1010, 88]] as const;
  for (const [origin, y] of cloudPositions) {
    const x = ((origin - state.distance * 0.18) % 1120 + 1120) % 1120 - 80;
    ctx.drawImage(atlas, 86, 2, 46, 14, Math.round(x), y, 46, 14);
  }

  // The atlas has two 600px horizon tiles, including the original bumps and gravel.
  const tileIndex = Math.floor(state.distance / 600);
  for (let tile = 0; tile < 3; tile++) {
    const sourceX = 2 + ((tileIndex + tile) % 2) * 600;
    ctx.drawImage(atlas, sourceX, 52, 600, 12,
      Math.round(tile * 600 - state.distance % 600), groundY - 13, 600, 12);
  }

  for (const obstacle of state.obstacles) {
    if (obstacle.kind === 'bird') {
      const wingFrame = Math.floor(state.tick / 10) % 2;
      ctx.drawImage(atlas, 134 + wingFrame * 46, 2, 46, 40,
        Math.round(obstacle.x), groundY - obstacle.elevation - obstacle.height, 46, 40);
      continue;
    }
    const large = obstacle.height >= 40;
    const double = !large && obstacle.width > 26;
    const sourceX = large ? 332 : double ? 245 : 228;
    const sourceWidth = large ? 25 : double ? 34 : 17;
    // Fit the original artwork to the existing task's boxes without changing dynamics.
    ctx.drawImage(atlas, sourceX, 2, sourceWidth, large ? 50 : 35,
      Math.round(obstacle.x), groundY - obstacle.height, obstacle.width, obstacle.height);
  }

  if (showPlayer) drawPlayer(ctx, state, atlas);

  const score = Math.round(state.distance * 0.025).toString().padStart(5, '0');
  const best = Math.round(bestDistance * 0.025).toString().padStart(5, '0');
  ctx.save();
  ctx.globalAlpha = 0.7;
  drawDigits(ctx, atlas, 'HI ' + best, width - 205);
  ctx.restore();
  drawDigits(ctx, atlas, score, width - 66);

  if (state.status === 'collision') {
    ctx.drawImage(atlas, 655, 15, 191, 11, Math.round((width - 191) / 2), 92, 191, 11);
    ctx.drawImage(atlas, 2, 68, 36, 32, width / 2 - 18, 126, 36, 32);
  } else if (paused || state.status === 'timeout') {
    ctx.fillStyle = '#535353';
    ctx.textAlign = 'center';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(paused ? 'P A U S E D' : 'T I M E   L I M I T', width / 2, 106);
    ctx.textAlign = 'left';
  }
}

export function drawPlayer(ctx: CanvasRenderingContext2D, state: State, atlas: CanvasImageSource): void {
  const { playerX, groundY } = CONFIG;
  const runningFrame = Math.floor(state.tick / 5) % 2 === 0 ? 88 : 132;
  if (state.ducking && state.status !== 'collision') {
    const duckFrame = Math.floor(state.tick / 8) % 2 === 0 ? 264 : 323;
    // Duck frames occupy the bottom 25 rows of the 47px-tall T-Rex strip.
    ctx.drawImage(atlas, 848 + duckFrame, 24, 59, 25, playerX - 3, groundY - 25, 59, 25);
  } else {
    const frame = state.status === 'collision' ? 220 : state.elevation > 0 ? 0 : runningFrame;
    ctx.drawImage(atlas, 848 + frame, 2, 44, 47,
      playerX - 6, Math.round(groundY - state.elevation - 47), 44, 47);
  }

}
