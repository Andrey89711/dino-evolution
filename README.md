# Dino Evolution

A reproducible experimental environment for evolutionary policy learning in a dinosaur obstacle-avoidance task.

## Abstract

Dino Evolution investigates whether a fixed-topology neural policy, optimized through evolutionary search, can learn obstacle avoidance from low-dimensional state observations. The current implementation provides a deterministic, browser-independent simulation and a browser interface for manual control. Policy learning, evolutionary optimization, and empirical comparisons are planned but not yet implemented. No learning-performance claims are made at this stage.

## 1. Research objective

The intended research question is: **How does an evolved neural policy compare with random-action and rule-based policies on previously unseen obstacle sequences under a fixed evaluation budget?**

The task is inspired by Chrome Dino. This repository implements its own environment; equivalence to the original game's physics, difficulty, or scoring has not been established.

## 2. Task formulation

The current task identifier is **`dino-v0.2`**, exposed as `TASK_VERSION` and included in every state snapshot. This version adds crouching and flying obstacles; its trajectories and results are not directly comparable with the earlier ground-obstacle task, even with identical seeds.

An episode consists of discrete transitions, `s_(t+1) = f(s_t, a_t; seed)`, at a fixed time step of 1/60 second. The player selects `run`, `jump`, or `duck` on each tick. A jump request is applied only while grounded. Repeated jump actions therefore initiate another jump after landing. `duck` switches to a shorter, wider collision box while grounded. In the air it applies three times the usual gravitational acceleration without changing the standing collision box until landing. Selecting `run` releases crouching; selecting `jump` while grounded releases crouching and initiates a jump.

The environment exposes the following unnormalized observations through `observe()`:

| Variable | Definition | Units |
| --- | --- | --- |
| `speed` | Horizontal world speed | world units / second |
| `elevation` | Height of the player's bottom edge above ground | world units |
| `verticalVelocity` | Vertical velocity; positive upwards | world units / second |
| `grounded` | Whether elevation equals zero | boolean |
| `ducking` | Whether the grounded crouching pose is active | boolean |
| `obstacle.kind` | Cactus or flying bird | categorical |
| `obstacle.distance` | Nearest relevant obstacle's leading edge minus player's front edge | world units |
| `obstacle.width`, `obstacle.height` | Dimensions of that obstacle's collision box | world units |
| `obstacle.elevation` | Height of the obstacle's bottom edge above ground | world units |

`obstacle` is `null` when no relevant obstacle is present. An obstacle remains relevant until its trailing edge passes the player's left edge. Distance uses the current pose's front edge and can be negative during horizontal overlap. A future policy adapter must define normalization, category encoding, and missing-obstacle handling explicitly.

Episodes terminate on strict axis-aligned bounding-box overlap on both axes, accounting for player pose and obstacle elevation. An episode that reaches 10,800 ticks without collision is truncated with status `timeout`; this is distinct from collision termination. Edge contact alone is not a collision. Collision geometry uses rectangular boxes rather than per-pixel sprite outlines.

## 3. Environment methodology

### 3.1 Dynamics

Vertical motion uses semi-implicit Euler integration: velocity is updated by gravity before elevation is updated. Horizontal speed increases each tick up to its cap. Obstacles move by the resulting horizontal displacement, which is also accumulated as distance. Collision detection follows movement; collision takes precedence if the time limit is reached on the same tick.

| Parameter | Value |
| --- | --- |
| Simulation frequency | 60 Hz |
| Initial / maximum horizontal speed | 300 / 600 units per second |
| Horizontal acceleration | 3 units per second squared |
| Gravity magnitude | 1,800 units per second squared |
| Initial jump velocity | 650 units per second |
| Player collision box | 32 × 44 units |
| Crouching collision box | 52 × 25 units; same left edge and ground baseline |
| Airborne duck gravity multiplier | 3 |
| Player horizontal position | 90 units |
| Obstacle spawn position | 960 units |
| Cactus width | Uniform choice from {18, 26, 34} units |
| Cactus height | Uniform choice from {30, 40, 50} units |
| Bird eligibility | Spawn-time world speed at least 330 units per second |
| Bird probability after eligibility | 0.30 per spawn |
| Bird collision box | 46 × 40 units |
| Bird bottom-edge elevation | Uniform choice from {10, 30, 65} units |
| Spawn-distance increment | Current speed × (1.15 + 0.65 × U), U in [0, 1) |
| Episode limit | 10,800 ticks / 180 simulation seconds |

The first obstacle is a cactus created at reset. Subsequent obstacles appear when accumulated distance reaches the next spawn threshold. Once bird eligibility is reached (after approximately 10 simulation seconds), each spawn samples obstacle type. Cactus spawns then sample width and height; bird spawns sample elevation. Both branches then sample spacing. Before eligibility, the type draw is omitted. All draws use a Mulberry32 pseudorandom generator initialized with an unsigned 32-bit integer seed. Birds and cacti move at world speed; no additional bird speed offset is applied.

Low birds overlap the crouching box and must be jumped over. Medium birds overlap a standing player but clear a crouching player. High birds clear a standing player on the ground but can intersect a jumping player. These levels and the eligibility threshold define this project's task; they are not a calibration of Chrome Dino. The environment does not use `Math.random()`, wall-clock time, or browser APIs.

### 3.2 Environment API

```ts
import { Environment } from './src/game/environment.js';

const environment = new Environment(42);
const observation = environment.observe();
const nextState = environment.step('jump'); // exactly one simulation tick
const initialState = environment.reset(42);
```

`state`, `reset()`, and `step()` return detached state snapshots. Terminal episodes stop advancing until reset. The TypeScript example is intended for the project toolchain, where `.js` import specifiers resolve to the corresponding `.ts` source modules.

### 3.3 Rendering and manual interaction

Canvas rendering is independent of state transitions. The browser accumulates elapsed time and performs fixed-size steps before drawing. Delays exceeding 250 ms discard excess wall-clock backlog; simulation time may consequently lag real time. Hiding the browser tab pauses the manual session. Determinism is defined for the same seed and **tick-indexed action sequence**, rather than for human key presses at matching wall-clock times. Bitwise equivalence across all JavaScript runtimes has not been evaluated.

The renderer uses Chromium's original Dino sprite atlas for the dinosaur, cacti, clouds, ground, score digits, and game-over panel. Pixel smoothing is disabled. Decorative clouds and terrain depend only on distance and do not consume environment randomness. Sprite artwork is fitted to this task's existing collision geometry; using the original artwork does not establish physical equivalence with Chrome Dino. The canvas score is `round(distance × 0.025)`; the experiment metrics retain raw world units. The displayed high score is the best completed episode in the current page session. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for artwork provenance and licensing.

Controls: **Space / Arrow Up** or **Jump** to jump; hold **Arrow Down / S** to crouch or descend faster; **R / Restart** to replay; **Pause / Resume** to suspend the simulation. The **Duck** button toggles crouching for touch and keyboard accessibility; its pressed state is exposed through `aria-pressed`. A jump request clears this toggle. Pause, restart, and window blur clear held inputs. A jump request takes priority over held down keys for one tick; a down key that remains held then applies accelerated descent. The seed field determines the next restarted episode. Distance is reported in simulation world units, not the original Chrome Dino score.

## 4. Proposed learning method

This section specifies the intended approach, not an implemented algorithm.

1. Encode a feed-forward neural network with one hidden layer as a vector of weights and biases. Freeze and report the topology and observation preprocessing before comparative experiments.
2. Initialize a population of 100 candidate policies using an evolution-specific random seed independent of environment seeds.
3. Evaluate every candidate on a shared training-seed set. Define fitness as mean episode distance with the same episode limit for all policies.
4. Retain elite candidates and generate offspring using tournament selection, crossover, and weight mutation.
5. Repeat under a predefined environment-step budget. Export the selected policy with its preprocessing, configuration, format version, and random seeds.

Selection pressure, elite count, mutation distribution, mutation probability, crossover operator, and network size remain to be specified. They must be recorded with experimental results rather than inferred from defaults.

## 5. Proposed experimental protocol

- Separate training, validation, and held-out test seeds. Use validation seeds for model or hyperparameter selection; reserve test seeds for final reporting.
- Compare against a no-jump policy, a random-action policy with a reported action probability, and a documented obstacle-distance rule.
- Repeat training with multiple independent evolution seeds. Report the number of independent runs and the full evaluation budget, including candidate evaluation episodes.
- Report distance distributions, collision frequency, time-limit frequency, and learning curves against consumed environment steps. Report both aggregate estimates and variability across independent training runs.
- Document configuration, commit identifier, runtime versions, seed lists, and saved policies. Distinguish selection-set fitness from held-out performance.

No training runs or held-out evaluation results are available yet. The automated tests establish implementation properties; they are not evidence of learning performance.

## 6. Reproduction and validation

Use Node.js 22.12+ or a compatible newer release and npm. Clone this repository, then run:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. If PowerShell blocks `npm.ps1`, use `npm.cmd` for these commands.

```sh
npm test
npm run typecheck
npm run build
npm run preview
```

`npm test` compiles the environment and runs Node's built-in test runner. Tests cover seeded trajectory replay, reset behavior, seed validation, jump dynamics, crouching and release, accelerated airborne descent, pose-dependent bird collisions at three elevations, cactus collisions while crouching, obstacle clearance, snapshot isolation, the speed cap, time-limit truncation, and invariance to grouping the same simulation ticks into different rendering batches. Build artifacts are ignored by Git. A deterministic fixture controller is used to reach later test scenarios; it has not undergone the comparative evaluation specified in Section 5.

## 7. Implementation status and roadmap

- [x] Browser-independent environment with fixed-step dynamics.
- [x] Seeded obstacle generation and explicit episode termination / truncation.
- [x] Canvas interface with manual control, pause, restart, and metrics.
- [x] Automated environment validation.
- [ ] Observation normalization and baseline policy evaluation.
- [ ] Neural policy encoding and evolutionary optimization.
- [ ] Experiment runner, independent random streams, and checkpoint export.
- [ ] Learning curves and held-out evaluation across independent runs.
- [x] Flying obstacles and crouching, with the `dino-v0.2` task definition.
- [ ] Transfer experiment against the original Chrome Dino environment.

```text
src/
  game/          # Seeded dynamics, state, and observation API
  rendering/     # Canvas presentation
  main.ts        # Manual browser session
tests/           # Environment validation
```

## 8. Limitations

The current task includes cacti and birds, a fixed jump impulse, crouching, accelerated airborne descent, and rectangular collision boxes. It has no variable-height jump-release mechanic or empirical calibration against Chrome Dino. Birds use fixed-height collision boxes that do not change with wing animation. Seeded replay does not imply that every generated sequence is solvable. Any task changes will require renewed baseline evaluation before comparing results across versions.

## 9. Contributing

Contributions should describe the research or implementation problem, state changes to the task or experimental assumptions, and include relevant validation. Run `npm test` and `npm run build` before submitting a pull request. Report reproducibility issues with the commit identifier, runtime version, seed, and tick-indexed action sequence when available. Keep documentation, source comments, and proposed experimental reports in English.

## 10. License

Original project code: MIT. See [LICENSE](LICENSE). Chromium artwork is distributed under its own BSD-style license; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
