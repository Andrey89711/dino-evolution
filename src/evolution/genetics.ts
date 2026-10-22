import { initializeGenome, NETWORK, type Genome } from '../ai/network.js';
import type { EvolutionConfig } from './config.js';

export interface Candidate {
  id: number;
  generation: number;
  parents: number[];
  origin: 'initial' | 'elite' | 'offspring' | 'imported';
  mutations: number;
  genome: Genome;
}
export interface ScoredCandidate extends Candidate { fitness: number }

export function rank<T extends ScoredCandidate>(candidates: T[]): T[] {
  return [...candidates].sort((a, b) => b.fitness - a.fitness || a.id - b.id);
}

export function tournament<T extends ScoredCandidate>(pool: T[], size: number, random: () => number): T {
  let best = pool[Math.floor(random() * pool.length)]!;
  for (let i = 1; i < size; i++) {
    const candidate = pool[Math.floor(random() * pool.length)]!;
    if (candidate.fitness > best.fitness || candidate.fitness === best.fitness && candidate.id < best.id) best = candidate;
  }
  return best;
}

export function crossover(first: Genome, second: Genome, random: () => number): Genome {
  return first.map((gene, i) => random() < 0.5 ? gene : second[i]!);
}

export function mutate(genome: Genome, probability: number, sigma: number, random: () => number): { genome: Genome; mutations: number } {
  let mutations = 0;
  const genes = genome.map(gene => {
    if (random() >= probability) return gene;
    const gaussian = Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
    const next = Math.max(-NETWORK.bound, Math.min(NETWORK.bound, gene + sigma * gaussian));
    if (next !== gene) mutations++;
    return next;
  });
  return { genome: genes, mutations };
}

export function initialPopulation(config: EvolutionConfig, random: () => number): Candidate[] {
  return Array.from({ length: config.populationSize }, (_, index) => ({
    id: index + 1, generation: 1, parents: [], origin: 'initial', mutations: 0,
    genome: initializeGenome(random),
  }));
}

export function breed(pool: ScoredCandidate[], config: EvolutionConfig, random: () => number, generation: number, firstId: number): Candidate[] {
  const sorted = rank(pool);
  return Array.from({ length: config.populationSize }, (_, index) => {
    if (index < config.eliteCount) {
      const parent = sorted[index]!;
      return { id: firstId + index, generation, parents: [parent.id], origin: 'elite', mutations: 0, genome: [...parent.genome] };
    }
    const first = tournament(sorted, config.tournamentSize, random);
    const second = tournament(sorted, config.tournamentSize, random);
    const child = mutate(crossover(first.genome, second.genome, random), config.mutationProbability, config.mutationSigma, random);
    return { id: firstId + index, generation, parents: [first.id, second.id], origin: 'offspring', ...child };
  });
}
