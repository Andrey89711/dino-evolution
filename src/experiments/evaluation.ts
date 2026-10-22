import { forward, validateGenome, type Genome } from '../ai/network.js';
import { CONFIG, Environment, type Action, type Observation } from '../game/environment.js';
import { createRandom } from '../game/random.js';
import type { EpisodeResult } from '../evolution/trainer.js';

export type PolicyName = 'always-run' | 'random-action' | 'rule-based' | 'neural';
export interface EvaluationRow {
  policy: PolicyName;
  meanDistance: number;
  medianDistance: number;
  collisions: number;
  timeouts: number;
  environmentSteps: number;
  episodes: EpisodeResult[];
}
export interface EvaluationReport {
  split: 'validation' | 'test';
  policyId: number;
  seeds: number[];
  baselineSeed: number;
  genome: Genome;
  rows: EvaluationRow[];
}

export function ruleBased(observation: Observation): Action {
  const obstacle = observation.obstacle;
  if (!obstacle || obstacle.distance >= observation.speed * 0.28 + 10) return 'run';
  if (obstacle.kind === 'bird' && obstacle.elevation >= CONFIG.duckHeight) return 'duck';
  return observation.grounded ? 'jump' : 'run';
}

export function evaluatePolicy(policy: PolicyName, seeds: number[], baselineSeed: number, genome?: Genome): EvaluationRow {
  if (!seeds.length || seeds.some(seed => !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)) throw new RangeError('Evaluation needs valid environment seeds.');
  if (policy === 'neural') validateGenome(genome);
  const episodes = seeds.map(seed => {
    const environment = new Environment(seed);
    const random = createRandom((baselineSeed ^ seed) >>> 0);
    let state = environment.state;
    while (state.status === 'running') {
      const observation = environment.observe();
      const action = policy === 'always-run' ? 'run' : policy === 'rule-based' ? ruleBased(observation) :
        policy === 'random-action' ? (['run', 'jump', 'duck'] as const)[Math.floor(random() * 3)]! : forward(genome!, observation).action;
      state = environment.step(action);
    }
    return { seed, distance: state.distance, ticks: state.tick, status: state.status };
  });
  const sorted = episodes.map(e => e.distance).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    policy, meanDistance: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    medianDistance: sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2,
    collisions: episodes.filter(e => e.status === 'collision').length,
    timeouts: episodes.filter(e => e.status === 'timeout').length,
    environmentSteps: episodes.reduce((sum, e) => sum + e.ticks, 0), episodes,
  };
}

export function evaluateSuite(split: EvaluationReport['split'], policyId: number, seeds: number[], baselineSeed: number, genome: Genome): EvaluationReport {
  return { split, policyId, seeds: [...seeds], baselineSeed, genome: [...genome],
    rows: (['always-run', 'random-action', 'rule-based', 'neural'] as const).map(policy => evaluatePolicy(policy, seeds, baselineSeed, genome)),
  };
}
