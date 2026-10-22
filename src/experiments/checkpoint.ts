import { NETWORK, validateGenome } from '../ai/network.js';
import { NORMALIZATION, NORMALIZATION_VERSION } from '../ai/observation.js';
import { CONFIG, TASK_VERSION } from '../game/environment.js';
import { makeConfig, type EvolutionConfig } from '../evolution/config.js';
import type { Candidate } from '../evolution/genetics.js';
import type { EpisodeResult, GenerationMetrics, Trainer } from '../evolution/trainer.js';
import type { EvaluationReport } from './evaluation.js';

export interface Checkpoint {
  schema: 'dino-evolution/champion-v1';
  taskVersion: typeof TASK_VERSION;
  environment: typeof CONFIG;
  network: typeof NETWORK;
  normalizationVersion: typeof NORMALIZATION_VERSION;
  normalization: typeof NORMALIZATION;
  config: EvolutionConfig;
  generation: number;
  budget: { environmentSteps: number; worldTicks: number; evaluatedEpisodes: number };
  metrics: GenerationMetrics[];
  champion: Candidate & { fitness: number; episodes: EpisodeResult[] };
  evaluations: EvaluationReport[];
  provenance: Record<string, string>;
}

export function exportCheckpoint(trainer: Trainer, evaluations: EvaluationReport[] = [], provenance: Record<string, string> = {}): Checkpoint {
  const champion = trainer.champion;
  if (!champion || champion.fitness === null) throw new Error('Complete a generation before exporting a training champion.');
  return structuredClone({
    schema: 'dino-evolution/champion-v1', taskVersion: TASK_VERSION, environment: CONFIG,
    network: NETWORK, normalizationVersion: NORMALIZATION_VERSION, normalization: NORMALIZATION,
    config: trainer.config, generation: trainer.generation,
    budget: { environmentSteps: trainer.environmentSteps, worldTicks: trainer.worldTicks, evaluatedEpisodes: trainer.evaluatedEpisodes },
    metrics: trainer.history,
    champion: { id: champion.id, generation: champion.generation, parents: champion.parents, origin: champion.origin,
      mutations: champion.mutations, genome: champion.genome, fitness: champion.fitness, episodes: champion.episodes },
    evaluations, provenance,
  });
}

/** Import restores a policy for replay, never the training RNG or a population. */
export function importCheckpoint(value: unknown): Checkpoint {
  if (!value || typeof value !== 'object') throw new Error('Expected a checkpoint object.');
  const data = value as Checkpoint;
  if (data.schema !== 'dino-evolution/champion-v1' || data.taskVersion !== TASK_VERSION ||
      data.normalizationVersion !== NORMALIZATION_VERSION ||
      !sameRecord(data.network, NETWORK) || !sameRecord(data.normalization, NORMALIZATION) ||
      !sameRecord(data.environment, CONFIG)) throw new Error('Incompatible checkpoint format, task, network, or preprocessing.');
  if (!data.config || Object.keys(makeConfig()).some(key => !(key in data.config))) throw new Error('Missing experiment configuration.');
  data.config = makeConfig(data.config);
  if (!data.champion || !Number.isSafeInteger(data.champion.id) || data.champion.id < 1 ||
      !Number.isSafeInteger(data.champion.generation) || data.champion.generation < 1 ||
      !Number.isFinite(data.champion.fitness) || data.champion.fitness < 0 ||
      !Array.isArray(data.champion.parents) || data.champion.parents.some(id => !Number.isSafeInteger(id) || id < 1) ||
      data.champion.parents.length > 2 ||
      !['initial', 'elite', 'offspring', 'imported'].includes(data.champion.origin) ||
      !Number.isSafeInteger(data.champion.mutations) || data.champion.mutations < 0 || data.champion.mutations > NETWORK.genes) throw new Error('Invalid champion metadata.');
  validateGenome(data.champion.genome);
  const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
  if (!integer(data.generation) || data.generation < data.champion.generation || !data.budget ||
      !integer(data.budget.environmentSteps) || !integer(data.budget.worldTicks) || !integer(data.budget.evaluatedEpisodes) ||
      !Array.isArray(data.metrics) || !Array.isArray(data.evaluations) ||
      !Array.isArray(data.champion.episodes) || data.champion.episodes.length !== data.config.trainingSeeds.length ||
      data.champion.episodes.some((episode, index) => episode.seed !== data.config.trainingSeeds[index] ||
        !Number.isFinite(episode.distance) || episode.distance < 0 || !integer(episode.ticks) ||
        episode.ticks < 1 || episode.ticks > CONFIG.maxTicks || !['collision', 'timeout'].includes(episode.status))) {
    throw new Error('Invalid episode results or experiment budget.');
  }
  const expected = data.champion.episodes.reduce((sum, episode) => sum + episode.distance, 0) / data.champion.episodes.length;
  if (Math.abs(data.champion.fitness - expected) > 1e-8) throw new Error('Fitness does not match recorded training episodes.');
  return structuredClone(data);
}

function sameRecord(value: unknown, expected: object): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === Object.keys(expected).length &&
    Object.entries(expected).every(([key, item]) => record[key] === item);
}
