import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Environment, World, CONFIG, initialPlayer, advancePlayer, observeState } from '../.test-build/game/environment.js';
import { createRandom } from '../.test-build/game/random.js';
import { normalize } from '../.test-build/ai/observation.js';
import { forward, initializeGenome, validateGenome, NETWORK } from '../.test-build/ai/network.js';
import { makeConfig } from '../.test-build/evolution/config.js';
import { crossover, mutate, breed, tournament } from '../.test-build/evolution/genetics.js';
import { Trainer } from '../.test-build/evolution/trainer.js';
import { exportCheckpoint, importCheckpoint } from '../.test-build/experiments/checkpoint.js';
import { evaluatePolicy, evaluateSuite, ruleBased } from '../.test-build/experiments/evaluation.js';

const small = { populationSize: 8, eliteCount: 2, tournamentSize: 3, maxGenerations: 3, maxEnvironmentSteps: 1_000_000 };
function finish(trainer) { while (!trainer.finished) trainer.tick(); return trainer; }
const zeroGenome = () => Array(NETWORK.genes).fill(0);

test('normalization defines presence, category, missing values, clipping, and finite inputs', () => {
  const observation = new Environment(42).observe();
  const values = normalize(observation);
  assert.equal(values.length, 11);
  assert.equal(values[3], 1); assert.equal(values[5], 1); assert.equal(values[10], 0);
  const absent = normalize({ ...observation, obstacle: null });
  assert.deepEqual(absent.slice(5), [0, 0, 0, 0, 0, 0]);
  const extreme = normalize({ ...observation, verticalVelocity: -99999, obstacle: { ...observation.obstacle, kind: 'bird', distance: -99999 } });
  assert.equal(extreme[2], -1); assert.equal(extreme[6], -1); assert.equal(extreme[10], 1);
  assert.throws(() => normalize({ ...observation, speed: Infinity }), RangeError);
});

test('known genes produce analytically expected activations, logits, and argmax ties', () => {
  const genome = zeroGenome();
  const observation = new Environment().observe();
  assert.equal(forward(genome, observation).action, 'run');
  genome[0] = 2; genome[88] = 0.25; genome[96 + 8] = 3; genome[121] = 0.5;
  const trace = forward(genome, observation);
  assert.equal(trace.hidden[0], Math.tanh(1.25));
  assert.equal(trace.outputs[1], Math.tanh(1.25) * 3 + 0.5);
  assert.equal(trace.action, 'jump');
  const clone = JSON.parse(JSON.stringify(genome));
  validateGenome(clone); assert.deepEqual(forward(clone, observation), trace);
  assert.throws(() => validateGenome([...genome, 0]));
  clone[0] = NaN; assert.throws(() => validateGenome(clone));
});

test('seeded Xavier initialization is reproducible, bounded, and initializes biases to zero', () => {
  const first = initializeGenome(createRandom(12));
  const second = initializeGenome(createRandom(12));
  assert.deepEqual(first, second); validateGenome(first);
  assert.ok(first.slice(0, 88).every(gene => Math.abs(gene) <= Math.sqrt(6 / 19)));
  assert.deepEqual(first.slice(88, 96), Array(8).fill(0));
  assert.deepEqual(first.slice(120), [0, 0, 0]);
});

test('tournament selects highest sampled fitness and breaks ties by stable ID', () => {
  const pool = [{ id: 1, fitness: 2 }, { id: 2, fitness: 8 }, { id: 3, fitness: 8 }];
  const draws = [0.9, 0.5, 0.1]; let index = 0;
  assert.equal(tournament(pool, 3, () => draws[index++]).id, 2);
});

test('crossover chooses parent genes without mutating either parent', () => {
  const first = Array(123).fill(1), second = Array(123).fill(-1);
  let index = 0;
  const child = crossover(first, second, () => index++ % 2 ? 0.9 : 0.1);
  assert.deepEqual(child.slice(0, 4), [1, -1, 1, -1]);
  assert.ok(first.every(gene => gene === 1)); assert.ok(second.every(gene => gene === -1));
});

test('mutation probability endpoints, Gaussian changes, bounds, and independent copies', () => {
  const genome = Array(123).fill(5);
  const noMutation = mutate(genome, 0, 0.15, createRandom(42));
  assert.deepEqual(noMutation.genome, genome); assert.notEqual(noMutation.genome, genome);
  const mutation = mutate(genome, 1, 0.15, createRandom(42));
  validateGenome(mutation.genome); assert.ok(mutation.mutations > 0);
  assert.ok(mutation.mutations < 123); // Positive perturbations clip at the bound.
  assert.equal(mutation.mutations, mutation.genome.filter((value, i) => value !== genome[i]).length);
});

test('elites preserve all genes and record their parent without mutation', () => {
  const trainer = new Trainer(small);
  const pool = trainer.population.map((p, i) => ({ ...p, fitness: i }));
  const children = breed(pool, trainer.config, createRandom(42), 2, 9);
  assert.deepEqual(children[0].genome, pool[7].genome);
  assert.notEqual(children[0].genome, pool[7].genome);
  assert.deepEqual(children[0].parents, [pool[7].id]);
  assert.equal(children[0].mutations, 0); assert.equal(children[0].origin, 'elite');
  assert.equal(children.length, 8);
});

test('shared world exactly matches manual environments for different actions', () => {
  const world = new World(42);
  const manual = [new Environment(42), new Environment(42)];
  let states = [initialPlayer(world.state), initialPlayer(world.state)];
  for (let tick = 0; tick < 1000; tick++) {
    const actions = ['run', ruleBased(observeState(states[1]))];
    const nextWorld = world.step();
    states = states.map((s, i) => advancePlayer(s, nextWorld, actions[i]));
    for (let i = 0; i < states.length; i++) assert.deepEqual(states[i], manual[i].step(actions[i]));
  }
  assert.equal(states[0].status, 'collision'); assert.equal(states[1].status, 'running');
  assert.equal(world.state.tick, 1000);
});

test('selected/dead policy retains its final trace while the shared world advances', () => {
  const trainer = new Trainer(small);
  trainer.population[0].genome = zeroGenome();
  // A jump-biased second policy ensures another player is active after the first collision.
  trainer.population[1].genome = zeroGenome(); trainer.population[1].genome[121] = 2;
  let guard = 0;
  while (trainer.population[0].state.status === 'running' && guard++ < 1000) trainer.tick();
  const dead = structuredClone(trainer.population[0]);
  const oldWorldTick = trainer.worldState.tick;
  assert.ok(trainer.alive > 0);
  trainer.tick();
  assert.ok(trainer.worldState.tick > oldWorldTick);
  assert.deepEqual(trainer.population[0], dead);
  assert.equal(dead.trace.tick + 1, dead.state.tick);
  assert.equal(dead.trace.action, forward(dead.genome, new Environment(42).observe()).action);
});

test('generation selection waits for every candidate on every training seed', () => {
  const trainer = new Trainer({ ...small, maxGenerations: 2 });
  while (trainer.history.length === 0) {
    assert.equal(trainer.generation, 1);
    trainer.tick();
  }
  for (const p of trainer.population) {
    assert.deepEqual(p.episodes.map(e => e.seed), trainer.config.trainingSeeds);
    assert.equal(p.fitness, p.episodes.reduce((sum, e) => sum + e.distance, 0) / p.episodes.length);
  }
  const retained = trainer.population[0];
  trainer.tick();
  assert.equal(trainer.generation, 2);
  assert.equal(trainer.find(retained.id), retained);
  assert.ok(trainer.population.every(p => p.fitness === null && p.episodes.length === 0));
});

test('independent trainers reproduce generations regardless of render batching', () => {
  const first = finish(new Trainer(small));
  const second = new Trainer(small);
  while (!second.finished) for (let i = 0; i < 20; i++) second.tick();
  assert.deepEqual(first.history, second.history);
  assert.deepEqual(first.population, second.population);
  assert.deepEqual(exportCheckpoint(first), exportCheckpoint(second));
});

test('budgets stop partial evaluation without inventing final fitness', () => {
  const trainer = finish(new Trainer({ ...small, maxEnvironmentSteps: 80 }));
  assert.equal(trainer.environmentSteps, 80);
  assert.equal(trainer.worldTicks, 10);
  assert.equal(trainer.finished, 'step-budget');
  assert.equal(trainer.history.length, 0); assert.equal(trainer.champion, null);
  assert.ok(trainer.population.every(p => p.fitness === null));
  assert.throws(() => exportCheckpoint(trainer));
});

test('checkpoint round-trip preserves decisions and rejects incompatible or malformed policies', () => {
  const trainer = finish(new Trainer({ ...small, maxGenerations: 1 }));
  const data = exportCheckpoint(trainer);
  const imported = importCheckpoint(JSON.parse(JSON.stringify(data)));
  const observation = new Environment(99).observe();
  assert.deepEqual(forward(imported.champion.genome, observation), forward(trainer.champion.genome, observation));
  const bad = structuredClone(data); bad.champion.genome[4] = Infinity;
  assert.throws(() => importCheckpoint(bad));
  const incompatible = structuredClone(data); incompatible.taskVersion = 'different-task';
  assert.throws(() => importCheckpoint(incompatible));
  const inaccurate = structuredClone(data); inaccurate.champion.fitness++;
  assert.throws(() => importCheckpoint(inaccurate));
  const missing = structuredClone(data); delete missing.config;
  assert.throws(() => importCheckpoint(missing));
});

test('evaluation is reproducible and cannot alter future training or its RNG', () => {
  const first = new Trainer(small);
  while (!first.history.length) first.tick();
  const before = exportCheckpoint(first);
  const report = evaluateSuite('validation', first.champion.id, first.config.validationSeeds, first.config.baselineSeed, first.champion.genome);
  assert.deepEqual(report, evaluateSuite('validation', first.champion.id, first.config.validationSeeds, first.config.baselineSeed, first.champion.genome));
  assert.deepEqual(exportCheckpoint(first), before);
  assert.deepEqual(report.rows.map(row => row.policy), ['always-run', 'random-action', 'rule-based', 'neural']);
  assert.deepEqual(report.genome, first.champion.genome);
  assert.equal(evaluatePolicy('always-run', [42], 0).collisions, 1);
  finish(first);
  const alternative = finish(new Trainer({ ...small, validationSeeds: [3001], testSeeds: [4001], baselineSeed: 123 }));
  assert.deepEqual(first.history, alternative.history);
  assert.deepEqual(first.champion, alternative.champion);
});

test('overlapping split seeds and invalid configuration are rejected', () => {
  assert.throws(() => makeConfig({ testSeeds: [42] }));
  assert.throws(() => makeConfig({ trainingSeeds: [42, 42] }));
  assert.throws(() => makeConfig({ eliteCount: 100 }));
  assert.throws(() => makeConfig({ mutationProbability: NaN }));
});

test('dino-v0.2 trajectories match pre-refactor golden hashes', () => {
  const expected = new Map([
    [42, 'f4a686e89dd5f2d628258d83dac98238c0f512582ca8a55926d56b4797ad04d5'],
    [81, '51b1a1da303c8e4f42afe16e941332bffbfe3ec66f3b31e182594ba1d87a9fcc'],
    [813, '7eef154cd2ed5a918534afa17c66a41a8184c726921abb6c78de13d968e9ce0c'],
  ]);
  for (const [seed, checksum] of expected) {
    const env = new Environment(seed), hash = createHash('sha256');
    for (let tick = 0; tick < 3000; tick++) {
      const s = env.step(ruleBased(env.observe()));
      hash.update(JSON.stringify({ taskVersion: s.taskVersion, seed: s.seed, tick: s.tick, distance: s.distance, speed: s.speed,
        elevation: s.elevation, verticalVelocity: s.verticalVelocity, ducking: s.ducking, status: s.status, obstacles: s.obstacles }));
    }
    assert.equal(hash.digest('hex'), checksum);
  }
});
