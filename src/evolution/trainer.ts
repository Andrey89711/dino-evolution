import { forward, type ForwardPass } from '../ai/network.js';
import { advancePlayer, initialPlayer, observeState, World, type State, type Status, type WorldState } from '../game/environment.js';
import { createRandom } from '../game/random.js';
import { makeConfig, type EvolutionConfig } from './config.js';
import { breed, initialPopulation, type Candidate, type ScoredCandidate } from './genetics.js';

export interface EpisodeResult { seed: number; distance: number; ticks: number; status: Status }
export interface Trace extends ForwardPass { tick: number; seed: number }
export interface Individual extends Candidate {
  state: State;
  trace: Trace | null;
  episodes: EpisodeResult[];
  fitness: number | null;
}
export interface GenerationMetrics {
  generation: number;
  best: number;
  mean: number;
  median: number;
  environmentSteps: number;
  evaluatedEpisodes: number;
  mutations: number;
  championId: number;
}
export const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

/** No browser state, wall clock, or visualization randomness is used here. */
export class Trainer {
  readonly config: EvolutionConfig;
  readonly archive = new Map<number, Individual>();
  readonly history: GenerationMetrics[] = [];
  population: Individual[];
  generation = 1;
  episodeIndex = 0;
  environmentSteps = 0;
  worldTicks = 0;
  evaluatedEpisodes = 0;
  champion: Individual | null = null;
  finished: 'generation-limit' | 'step-budget' | null = null;
  private readonly random: () => number;
  private world: World;
  private currentWorld: WorldState;
  private boundary: 'episode' | 'generation' | null = null;
  private nextId: number;

  constructor(config: Partial<EvolutionConfig> = {}) {
    this.config = makeConfig(config);
    this.random = createRandom(this.config.evolutionSeed);
    this.world = new World(this.config.trainingSeeds[0]!);
    this.currentWorld = this.world.state;
    this.population = initialPopulation(this.config, this.random).map(candidate => this.createIndividual(candidate));
    this.nextId = this.config.populationSize + 1;
  }

  get worldState(): WorldState {
    return { ...this.currentWorld, obstacles: this.currentWorld.obstacles.map(o => ({ ...o })) };
  }
  get alive(): number { return this.population.filter(individual => individual.state.status === 'running').length; }
  get atBoundary(): boolean { return this.boundary !== null; }
  find(id: number): Individual | undefined { return this.population.find(p => p.id === id) ?? this.archive.get(id); }

  leader(): Individual {
    return [...this.population].sort((a, b) =>
      (b.fitness ?? this.partialScore(b)) - (a.fitness ?? this.partialScore(a)) ||
      b.state.distance - a.state.distance || a.id - b.id,
    )[0]!;
  }

  partialScore(individual: Individual): number {
    return individual.episodes.length ? mean(individual.episodes.map(e => e.distance)) : 0;
  }

  /** One shared physics tick, including a pending episode transition if necessary. */
  tick(): boolean {
    if (this.finished) return false;
    if (this.boundary) this.transition();
    const active = this.population.filter(individual => individual.state.status === 'running');
    if (this.environmentSteps + active.length > this.config.maxEnvironmentSteps) {
      this.finished = 'step-budget';
      return false;
    }
    const decisions = active.map(individual => ({
      individual,
      trace: { ...forward(individual.genome, observeState(individual.state)), tick: this.currentWorld.tick, seed: this.currentWorld.seed },
    }));
    this.currentWorld = this.world.step();
    this.worldTicks++;
    for (const { individual, trace } of decisions) {
      individual.trace = trace;
      individual.state = advancePlayer(individual.state, this.currentWorld, trace.action);
      this.environmentSteps++;
      if (individual.state.status !== 'running') {
        const s = individual.state;
        individual.episodes.push({ seed: s.seed, distance: s.distance, ticks: s.tick, status: s.status });
        this.evaluatedEpisodes++;
      }
    }
    if (this.alive === 0) {
      if (this.episodeIndex + 1 < this.config.trainingSeeds.length) this.boundary = 'episode';
      else this.completeGeneration();
    }
    return true;
  }

  private createIndividual(candidate: Candidate): Individual {
    return { ...candidate, state: initialPlayer(this.currentWorld), trace: null, episodes: [], fitness: null };
  }

  private transition(): void {
    if (this.boundary === 'generation') {
      for (const individual of this.population) this.archive.set(individual.id, individual);
      const candidates = breed(this.population as (Individual & ScoredCandidate)[], this.config,
        this.random, this.generation + 1, this.nextId);
      this.nextId += this.config.populationSize;
      this.generation++;
      this.episodeIndex = 0;
      this.currentWorld = this.world.reset(this.config.trainingSeeds[0]!);
      this.population = candidates.map(candidate => this.createIndividual(candidate));
    } else {
      this.episodeIndex++;
      this.currentWorld = this.world.reset(this.config.trainingSeeds[this.episodeIndex]!);
      for (const individual of this.population) {
        individual.state = initialPlayer(this.currentWorld);
        individual.trace = null;
      }
    }
    this.boundary = null;
  }

  private completeGeneration(): void {
    for (const individual of this.population) individual.fitness = mean(individual.episodes.map(e => e.distance));
    const scores = this.population.map(p => p.fitness!).sort((a, b) => a - b);
    const leader = this.leader();
    if (!this.champion || leader.fitness! > this.champion.fitness!) this.champion = structuredClone(leader);
    const midpoint = Math.floor(scores.length / 2);
    this.history.push({
      generation: this.generation, best: scores.at(-1)!, mean: mean(scores),
      median: scores.length % 2 ? scores[midpoint]! : (scores[midpoint - 1]! + scores[midpoint]!) / 2,
      environmentSteps: this.environmentSteps, evaluatedEpisodes: this.evaluatedEpisodes,
      mutations: this.population.reduce((sum, p) => sum + p.mutations, 0), championId: leader.id,
    });
    if (this.generation >= this.config.maxGenerations) this.finished = 'generation-limit';
    else this.boundary = 'generation';
  }
}
