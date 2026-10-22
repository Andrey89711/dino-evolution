import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Environment, CONFIG } from '../.test-build/game/environment.js';

// A fixture controller used to reach later test scenarios, not a measured baseline.
function fixtureAction(observation) {
  const obstacle = observation.obstacle;
  if (!obstacle || obstacle.distance >= observation.speed * 0.28 + 10) return 'run';
  if (obstacle.kind === 'bird' && obstacle.elevation >= CONFIG.duckHeight) return 'duck';
  return observation.grounded ? 'jump' : 'run';
}

function approachBird(elevation) {
  const env = new Environment(42);
  for (let tick = 0; tick < 5000; tick++) {
    const observation = env.observe();
    const obstacle = observation.obstacle;
    if (obstacle?.kind === 'bird' && obstacle.elevation === elevation &&
        obstacle.distance > 190 && obstacle.distance < 205) return env;
    assert.equal(env.step(fixtureAction(observation)).status, 'running');
  }
  assert.fail(`Bird at elevation ${elevation} not reached`);
}

function passageTicks(env) {
  const observation = env.observe();
  return Math.ceil((observation.obstacle.distance + CONFIG.playerWidth + observation.obstacle.width) /
    observation.speed / CONFIG.timeStep) + 3;
}

test('identical seeds and tick-indexed actions reproduce complete trajectories', () => {
  const first = new Environment(813);
  const second = new Environment(813);
  for (let tick = 0; tick < 2000; tick++) {
    const observation = first.observe();
    const action = fixtureAction(observation);
    assert.deepEqual(first.step(action), second.step(action));
  }
  assert.equal(first.state.tick, 2000);
  assert.equal(first.state.status, 'running');
});

test('ducking changes pose and observed distance, then releases on run', () => {
  const standing = new Environment(42);
  const crouched = new Environment(42);
  standing.step('run');
  assert.equal(crouched.step('duck').ducking, true);
  assert.equal(standing.observe().obstacle.distance - crouched.observe().obstacle.distance,
    CONFIG.duckWidth - CONFIG.playerWidth);
  assert.equal(crouched.observe().ducking, true);
  assert.equal(crouched.step('run').ducking, false);
  assert.equal(crouched.step('jump').ducking, false);
  assert.ok(crouched.state.elevation > 0);
});

test('duck in midair accelerates descent and crouches only after landing', () => {
  const normal = new Environment();
  const fast = new Environment();
  normal.step('jump');
  fast.step('jump');
  for (let i = 0; i < 10; i++) { normal.step('run'); fast.step('run'); }
  const regular = normal.step('run');
  const falling = fast.step('duck');
  assert.ok(falling.elevation < regular.elevation);
  assert.ok(falling.verticalVelocity < regular.verticalVelocity);
  assert.equal(falling.ducking, false);
  for (let i = 0; i < 40; i++) fast.step('duck');
  assert.equal(fast.state.elevation, 0);
  assert.equal(fast.state.ducking, true);
});

test('medium bird collides with standing player but clears a crouching player', () => {
  const standing = approachBird(30);
  const crouched = approachBird(30);
  assert.deepEqual(standing.state, crouched.state);
  const steps = passageTicks(standing);
  for (let i = 0; i < steps; i++) { standing.step('run'); crouched.step('duck'); }
  assert.equal(standing.state.status, 'collision');
  assert.equal(crouched.state.status, 'running');
  assert.equal(crouched.state.elevation, 0);
});

test('low bird cannot be ducked under but can be jumped over', () => {
  const crouched = approachBird(10);
  const jumping = approachBird(10);
  const steps = passageTicks(jumping);
  for (let i = 0; i < steps; i++) {
    crouched.step('duck');
    jumping.step(fixtureAction(jumping.observe()));
  }
  assert.equal(crouched.state.status, 'collision');
  assert.equal(jumping.state.status, 'running');
});

test('high bird clears a standing player', () => {
  const env = approachBird(65);
  const steps = passageTicks(env);
  for (let i = 0; i < steps; i++) env.step('run');
  assert.equal(env.state.status, 'running');
  assert.equal(env.state.elevation, 0);
  assert.equal(env.state.ducking, false);
});

test('ducking does not protect against a ground cactus', () => {
  const env = new Environment(42);
  for (let tick = 0; tick < 300; tick++) env.step('duck');
  assert.equal(env.state.status, 'collision');
  assert.equal(env.state.obstacles.find(o => o.x + o.width > CONFIG.playerX).kind, 'cactus');
});

test('reset restores the initial trajectory and seeds change obstacles', () => {
  const env = new Environment(42);
  const initial = env.state;
  for (let i = 0; i < 60; i++) env.step('run');
  assert.deepEqual(env.reset(42), initial);
  assert.notDeepEqual(env.reset(43).obstacles, initial.obstacles);
  assert.throws(() => env.reset(-1), RangeError);
  assert.throws(() => env.reset(1.5), RangeError);
});

test('jump leaves the ground, cannot jump in midair, and lands', () => {
  const env = new Environment();
  const first = env.step('jump');
  assert.ok(first.elevation > 0);
  const second = env.step('jump');
  assert.ok(second.verticalVelocity < first.verticalVelocity);
  for (let i = 0; i < 60; i++) env.step('run');
  assert.equal(env.state.elevation, 0);
  assert.equal(env.state.verticalVelocity, 0);
});

test('no-action policy collides and terminal states stop advancing', () => {
  const env = new Environment();
  for (let i = 0; i < 300; i++) env.step('run');
  assert.equal(env.state.status, 'collision');
  const terminal = env.state;
  assert.deepEqual(env.step('jump'), terminal);
});

test('a timed jump clears the first obstacle', () => {
  const env = new Environment(42);
  while (env.observe().obstacle.distance > 110) env.step('run');
  env.step('jump');
  for (let i = 0; i < 48; i++) env.step('run');
  assert.equal(env.state.status, 'running');
  assert.equal(env.state.elevation, 0);
});

test('state snapshots cannot mutate the environment', () => {
  const env = new Environment();
  const snapshot = env.state;
  snapshot.obstacles[0].x = 0;
  snapshot.speed = 9999;
  assert.equal(env.state.speed, CONFIG.initialSpeed);
  assert.equal(env.state.obstacles[0].x, CONFIG.width);
});

test('render batching does not change simulation outcomes', () => {
  function run(batchSize) {
    const env = new Environment(81);
    for (let frame = 0; frame < 120 / batchSize; frame++) {
      for (let i = 0; i < batchSize; i++) {
        env.step(env.state.tick === 95 ? 'jump' : 'run');
      }
    }
    return env.state;
  }
  assert.deepEqual(run(1), run(4));
  assert.equal(run(1).tick, 120);
  assert.ok(run(1).speed > CONFIG.initialSpeed);
});

test('a surviving episode respects the speed cap and truncates at the tick limit', () => {
  const env = new Environment(42);
  for (let i = 0; i < CONFIG.maxTicks; i++) {
    const observation = env.observe();
    const state = env.step(fixtureAction(observation));
    assert.ok(state.speed <= CONFIG.maxSpeed);
    assert.ok(state.elevation >= 0);
    assert.notEqual(state.status, 'collision');
  }
  assert.equal(env.state.status, 'timeout');
  assert.equal(env.state.tick, CONFIG.maxTicks);
  assert.equal(env.state.speed, CONFIG.maxSpeed);
  const terminal = env.state;
  assert.deepEqual(env.step('run'), terminal);
});
