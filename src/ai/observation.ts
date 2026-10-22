import { CONFIG, type Observation } from '../game/environment.js';

export const NORMALIZATION_VERSION = 'observation-v1';
export const INPUT_LABELS = ['Speed', 'Elevation', 'Vertical velocity', 'Grounded', 'Ducking',
  'Obstacle present', 'Distance', 'Width', 'Height', 'Bottom elevation', 'Bird'] as const;
export const NORMALIZATION = Object.freeze({
  speed: CONFIG.maxSpeed,
  elevation: CONFIG.jumpVelocity ** 2 / (2 * CONFIG.gravity),
  verticalVelocity: CONFIG.jumpVelocity * CONFIG.fastFallMultiplier,
  distance: CONFIG.width,
  width: 100, height: 100, obstacleElevation: 100,
});

function scale(value: number, denominator: number, signed = false): number {
  if (!Number.isFinite(value)) throw new RangeError('Observation contains a non-finite number.');
  return Math.max(signed ? -1 : 0, Math.min(1, value / denominator));
}

export function normalize(observation: Observation): number[] {
  const o = observation.obstacle;
  return [
    scale(observation.speed, NORMALIZATION.speed),
    scale(observation.elevation, NORMALIZATION.elevation),
    scale(observation.verticalVelocity, NORMALIZATION.verticalVelocity, true),
    Number(observation.grounded), Number(observation.ducking), Number(o !== null),
    o ? scale(o.distance, NORMALIZATION.distance, true) : 0,
    o ? scale(o.width, NORMALIZATION.width) : 0,
    o ? scale(o.height, NORMALIZATION.height) : 0,
    o ? scale(o.elevation, NORMALIZATION.obstacleElevation) : 0,
    Number(o?.kind === 'bird'),
  ];
}
