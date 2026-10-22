import type { Action, Observation } from '../game/environment.js';
import { normalize } from './observation.js';

export const NETWORK = Object.freeze({ inputs: 11, hidden: 8, outputs: 3, genes: 123, bound: 5 });
export const ACTIONS: readonly Action[] = ['run', 'jump', 'duck'];
export type Genome = number[];
export interface ForwardPass { raw: Observation; inputs: number[]; hidden: number[]; outputs: number[]; action: Action }

export function validateGenome(value: unknown): asserts value is Genome {
  if (!Array.isArray(value) || value.length !== NETWORK.genes ||
      value.some(gene => typeof gene !== 'number' || !Number.isFinite(gene) || Math.abs(gene) > NETWORK.bound)) {
    throw new RangeError('Expected 123 finite genes within [-5, 5].');
  }
}

/** Row-major W1 (88), b1 (8), W2 (24), b2 (3). */
export function initializeGenome(random: () => number): Genome {
  const genes = Array<number>(NETWORK.genes).fill(0);
  const firstLimit = Math.sqrt(6 / (NETWORK.inputs + NETWORK.hidden));
  const secondLimit = Math.sqrt(6 / (NETWORK.hidden + NETWORK.outputs));
  for (let i = 0; i < 88; i++) genes[i] = (random() * 2 - 1) * firstLimit;
  for (let i = 96; i < 120; i++) genes[i] = (random() * 2 - 1) * secondLimit;
  return genes;
}

/** Genomes are validated at creation/import; the hot path never mutates them. */
export function forward(genome: Genome, observation: Observation): ForwardPass {
  const inputs = normalize(observation);
  const hidden = Array<number>(8);
  const outputs = Array<number>(3);
  for (let h = 0; h < 8; h++) {
    let sum = genome[88 + h]!;
    for (let i = 0; i < 11; i++) sum += inputs[i]! * genome[h * 11 + i]!;
    hidden[h] = Math.tanh(sum);
  }
  for (let o = 0; o < 3; o++) {
    let sum = genome[120 + o]!;
    for (let h = 0; h < 8; h++) sum += hidden[h]! * genome[96 + o * 8 + h]!;
    outputs[o] = sum;
  }
  let best = 0;
  for (let i = 1; i < 3; i++) if (outputs[i]! > outputs[best]!) best = i;
  return { raw: { ...observation, obstacle: observation.obstacle ? { ...observation.obstacle } : null },
    inputs, hidden, outputs, action: ACTIONS[best]! };
}

export function connections(genome: Genome): { from: number; to: number; weight: number; layer: number }[] {
  const result = [];
  for (let h = 0; h < 8; h++) for (let i = 0; i < 11; i++) {
    result.push({ from: i, to: h, weight: genome[h * 11 + i]!, layer: 0 });
  }
  for (let o = 0; o < 3; o++) for (let h = 0; h < 8; h++) {
    result.push({ from: h, to: o, weight: genome[96 + o * 8 + h]!, layer: 1 });
  }
  return result;
}
