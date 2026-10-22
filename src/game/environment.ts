import { createRandom } from './random.js';

export const TASK_VERSION = 'dino-v0.2';

export const CONFIG = Object.freeze({
  width: 960, height: 300, groundY: 238,
  timeStep: 1 / 60,
  initialSpeed: 300, maxSpeed: 600, acceleration: 3,
  gravity: 1800, jumpVelocity: 650,
  playerX: 90, playerWidth: 32, playerHeight: 44,
  duckWidth: 52, duckHeight: 25,
  birdMinSpeed: 330, birdProbability: 0.3,
  fastFallMultiplier: 3,
  maxTicks: 10800,
});

export type Action = 'run' | 'jump' | 'duck';
export type Status = 'running' | 'collision' | 'timeout';
export interface Obstacle {
  kind: 'cactus' | 'bird';
  x: number;
  width: number;
  height: number;
  elevation: number;
}
export interface State {
  taskVersion: typeof TASK_VERSION;
  seed: number;
  tick: number;
  distance: number;
  speed: number;
  elevation: number;
  verticalVelocity: number;
  ducking: boolean;
  status: Status;
  obstacles: Obstacle[];
}
export interface Observation {
  speed: number;
  elevation: number;
  verticalVelocity: number;
  grounded: boolean;
  ducking: boolean;
  obstacle: {
    kind: Obstacle['kind'];
    distance: number;
    width: number;
    height: number;
    elevation: number;
  } | null;
}

/** Browser-independent environment; every step advances exactly one physics tick. */
export class Environment {
  private random!: () => number;
  private nextSpawnDistance = 0;
  private current!: State;

  constructor(seed = 42) { this.reset(seed); }

  reset(seed = 42): State {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      throw new RangeError('Seed must be an unsigned 32-bit integer.');
    }
    this.random = createRandom(seed);
    this.current = {
      taskVersion: TASK_VERSION, seed, tick: 0, distance: 0, speed: CONFIG.initialSpeed,
      elevation: 0, verticalVelocity: 0, ducking: false, status: 'running', obstacles: [],
    };
    this.spawn();
    return this.state;
  }

  get state(): State {
    return { ...this.current, obstacles: this.current.obstacles.map(o => ({ ...o })) };
  }

  observe(): Observation {
    const s = this.current;
    const obstacle = s.obstacles.find(o => o.x + o.width > CONFIG.playerX);
    return {
      speed: s.speed, elevation: s.elevation, verticalVelocity: s.verticalVelocity,
      grounded: s.elevation === 0, ducking: s.ducking,
      obstacle: obstacle ? {
        kind: obstacle.kind,
        distance: obstacle.x - CONFIG.playerX - (s.ducking ? CONFIG.duckWidth : CONFIG.playerWidth),
        width: obstacle.width, height: obstacle.height, elevation: obstacle.elevation,
      } : null,
    };
  }

  step(action: Action): State {
    if (action !== 'run' && action !== 'jump' && action !== 'duck') throw new RangeError('Unknown action.');
    const s = this.current;
    if (s.status !== 'running') return this.state;
    const dt = CONFIG.timeStep;
    if (action === 'jump' && s.elevation === 0) s.verticalVelocity = CONFIG.jumpVelocity;
    const fastFall = action === 'duck' && s.elevation > 0;
    s.verticalVelocity -= CONFIG.gravity * (fastFall ? CONFIG.fastFallMultiplier : 1) * dt;
    s.elevation = Math.max(0, s.elevation + s.verticalVelocity * dt);
    if (s.elevation === 0) s.verticalVelocity = 0;
    s.ducking = action === 'duck' && s.elevation === 0;
    s.speed = Math.min(CONFIG.maxSpeed, s.speed + CONFIG.acceleration * dt);
    const displacement = s.speed * dt;
    s.distance += displacement;
    s.tick += 1;
    for (const obstacle of s.obstacles) obstacle.x -= displacement;
    s.obstacles = s.obstacles.filter(o => o.x + o.width > 0);
    if (s.distance >= this.nextSpawnDistance) this.spawn();
    // Strict AABB overlap: touching edges alone does not terminate an episode.
    const playerWidth = s.ducking ? CONFIG.duckWidth : CONFIG.playerWidth;
    const playerHeight = s.ducking ? CONFIG.duckHeight : CONFIG.playerHeight;
    if (s.obstacles.some(o =>
      CONFIG.playerX < o.x + o.width && CONFIG.playerX + playerWidth > o.x &&
      s.elevation < o.elevation + o.height && s.elevation + playerHeight > o.elevation,
    )) s.status = 'collision';
    else if (s.tick >= CONFIG.maxTicks) s.status = 'timeout';
    return this.state;
  }

  private spawn(): void {
    const s = this.current;
    const bird = s.speed >= CONFIG.birdMinSpeed && this.random() < CONFIG.birdProbability;
    if (bird) {
      const levels = [10, 30, 65] as const;
      s.obstacles.push({
        kind: 'bird', x: CONFIG.width, width: 46, height: 40,
        elevation: levels[Math.floor(this.random() * levels.length)]!,
      });
    } else {
      s.obstacles.push({
        kind: 'cactus', x: CONFIG.width, elevation: 0,
        width: 18 + Math.floor(this.random() * 3) * 8,
        height: 30 + Math.floor(this.random() * 3) * 10,
      });
    }
    this.nextSpawnDistance = s.distance + s.speed * (1.15 + this.random() * 0.65);
  }
}
