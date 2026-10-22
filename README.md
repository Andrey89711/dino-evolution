# Dino Evolution

A reproducible neuroevolution laboratory for an obstacle-avoidance task inspired by Chrome Dino. Inspect every policy's actual forward pass while a population plays in the same world.

## Abstract

This project implements fixed-topology neural policies optimized through tournament selection, uniform crossover, Gaussian mutation, and elitism. A browser-independent, seeded simulation provides shared obstacle sequences and independent player dynamics. The browser interface visualizes the population, policy activations, genome weights, ancestry, episode outcomes, and generation statistics. Independent baseline evaluation and policy export support reproducible experiments. The implementation is a research prototype; a short integration run demonstrates functioning optimization, not statistical evidence of superiority or transfer to the original Chrome game.

## 1. Research question and scope

**How does an evolved neural policy compare with random-action and rule-based policies on unseen obstacle sequences under a reported computational budget?**

The task identifier is **`dino-v0.2`**. It includes cacti, flying birds, jumping, crouching, and accelerated descent. Original Chromium artwork is used, but equivalence to Chrome Dino physics, obstacle generation, collision detection, or difficulty has not been established. The current population implementation preserves the previous single-player task: regression tests compare complete trajectories against pre-refactor checksums.

## 2. Installation and execution

Use Node.js 22.12+ or a compatible newer release. Validation described below used Node.js 24.20.0 on Windows.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. PowerShell users can substitute `npm.cmd` when execution policy blocks `npm.ps1`.

```sh
npm test
npm run build
npm run preview
```

### 2.1 Browser workflow

The initial session is **Evolution**, paused before the first decision. Click **Start** or **Step one tick** to compute actual network activity.

1. Select a population card or choose an individual by ID. The detailed brain shows normalized inputs, hidden activations, output logits, and the selected action. Expand the raw decision record or the complete weights-and-biases table for exact values.
2. All current-generation players share one field. The selected player is light gray with an outline; other players are dark and translucent. Players do not collide with one another. The selected policy is drawn last.
3. Pause or resume, advance one tick while paused, or change playback scheduling to 1×, 5×, or 20×. Physics remains fixed-step. The renderer receives an 8 ms training scheduling budget per frame; achieved acceleration depends on hardware. Excess wall-clock backlog can be discarded without skipping simulation ticks or changing their order.
4. Click **Reset experiment** to apply configuration changes. Population size, elite count, selection and mutation parameters, seed sets, and stopping budgets are configurable.
5. After a generation completes, export the training champion as JSON. Importing a compatible policy opens a separate, paused replay session and does not insert its genes into training.
6. Run validation comparisons when needed. Reserve **Run held-out test** for final reporting. Each evaluation downloads a JSON report and runs in a separate worker. Evaluation results do not influence training.

Selecting an individual never changes its actions or the training RNG. **Follow leader** is explicit and off by default. Death freezes the last actual decision until the next evaluation episode begins. After a generation ends, previous individuals remain available in an in-memory archive; an archived selection does not silently switch to a new genome. Select a current individual or enable Follow leader to move the selection forward. The archive stores each individual's final episode state and trace, not a full trajectory recording.

Network brightness maps activation to grayscale: unsigned inputs use their normalized value; signed inputs and hidden activations use `(value + 1) / 2`; output brightness uses `(tanh(logit) + 1) / 2`. Numeric output values remain untransformed logits. Connection width reflects absolute weight; negative weights are dashed. Cards use 4 Hz updates, detailed values use 10 Hz updates, and the field uses animation frames. No decorative random activations are generated.

Switch to **Manual control** for keyboard play: Space / Arrow Up jumps, holding Arrow Down / S crouches or accelerates descent, and R restarts. The Duck button toggles crouching; a jump clears that toggle. Pause, restart, and window blur clear held inputs. A jump request takes precedence over down input for one tick. Hiding the tab pauses the session. Manual play and imported-policy replay do not advance the training budget.

### 2.2 Headless experiments

The CLI compiles the browser-independent modules and runs the same trainer without rendering:

```sh
npm run experiment -- --generations 5 --validation --out artifacts/run.json
npm run experiment -- --generations 30 --evolution-seed 2027 --out artifacts/run-2027.json
npm run experiment -- --config experiments/example.json --out artifacts/custom.json
```

Configuration files contain a JSON object with the fields listed in Section 5; omitted fields retain defaults. The included [example configuration](experiments/example.json) uses five generations. The CLI does not evaluate test seeds. `--validation` explicitly adds a comparison of the exported training champion against all baselines on validation seeds.

Artifacts contain policy coefficients, preprocessing, task and evolution configuration, episode outcomes, training history, budgets, optional evaluation reports, Node version, commit identifier, working-tree status, and a SHA-256 of source files, scripts, package files, and TypeScript configuration. Browser exports record the user agent and mark the commit as unrecorded. Artifacts are ignored by Git; publish the artifacts needed to support a reported experiment.

## 3. Environment definition

### 3.1 State transitions and actions

Episodes follow `s_(t+1) = f(s_t, a_t; environment_seed)` with a 1/60-second step. A world advances exactly once per shared tick; every living individual computes its action from the pre-transition state and is tested against the same next-world snapshot. Player trajectories are independent. Dead players no longer run inference, accrue distance, or consume agent-step budget. The world continues while any individual is alive.

Actions are `run`, `jump`, and `duck`. Jumping is allowed only while grounded. Repeated jump actions initiate another jump after landing. Grounded ducking uses a shorter, wider rectangular collision box. Airborne ducking applies three times normal gravitational acceleration and retains standing geometry until landing. Selecting run releases crouching. Vertical motion uses semi-implicit Euler integration; horizontal speed increases before world displacement is applied.

Strict overlap of axis-aligned collision rectangles terminates an episode. Edge contact alone does not count. Collision takes precedence over timeout on the same tick. An episode reaching 10,800 ticks without collision is truncated with status `timeout`, distinct from `collision`. Terminal single-player states remain unchanged until reset.

| Parameter | Value |
| --- | --- |
| Frequency | 60 Hz |
| Initial / maximum speed | 300 / 600 world units per second |
| Horizontal acceleration | 3 units per second squared |
| Gravity magnitude | 1,800 units per second squared |
| Initial jump velocity | 650 units per second |
| Standing collision box | 32 × 44 units |
| Crouching collision box | 52 × 25 units, same left edge and baseline |
| Player horizontal position | 90 units |
| Obstacle spawn position | 960 units |
| Cactus widths / heights | {18, 26, 34} / {30, 40, 50} units, independently uniform |
| Bird eligibility | Spawn-time speed ≥330 units per second |
| Bird probability after eligibility | 0.30 per spawn |
| Bird width × height | 46 × 40 units |
| Bird bottom-edge elevations | {10, 30, 65} units, uniform |
| Spawn-distance increment | Current speed × (1.15 + 0.65 × U), U in [0, 1) |
| Episode cap | 10,800 ticks / 180 simulation seconds |

The initial obstacle is a cactus. After bird eligibility, each spawn samples type; cactus spawns sample width then height, bird spawns sample elevation, and both sample spacing. Before eligibility, the type draw is omitted. The world uses Mulberry32 with an unsigned 32-bit seed and never consumes policy or visualization randomness. Birds move at world speed without an additional velocity offset. Low birds overlap a crouched player; medium birds clear a crouched player but overlap a standing player; high birds clear a grounded standing player but can intersect jumps.

### 3.2 Observations and normalization

Policies receive eleven values in the following order. Clipping occurs after division. Obstacle distance is measured from the current pose's front edge and may be negative during overlap. The nearest relevant obstacle is the first whose trailing edge has not passed the player's left edge. Missing-obstacle features are zero, distinguished from a cactus by the presence input.

| Input | Encoding / divisor | Clipped range |
| --- | --- | --- |
| Speed | /600 | [0, 1] |
| Player elevation | /(650² / (2 × 1,800)) | [0, 1] |
| Vertical velocity | /(650 × 3); positive upward | [-1, 1] |
| Grounded | Boolean → 0 or 1 | {0, 1} |
| Ducking | Boolean → 0 or 1 | {0, 1} |
| Obstacle present | Boolean → 0 or 1 | {0, 1} |
| Distance | /960 | [-1, 1] |
| Obstacle width | /100 | [0, 1] |
| Obstacle height | /100 | [0, 1] |
| Obstacle bottom elevation | /100 | [0, 1] |
| Bird category | Bird=1; cactus or absent=0 | {0, 1} |

Preprocessing is versioned as `observation-v1`. Non-finite continuous observation values are rejected. The raw observation, normalized vector, hidden activations, output logits, decision seed, and pre-transition tick are retained in the last trace. The resulting player state is one tick later.

### 3.3 Rendering and compatibility

Chromium's original sprite atlas provides dinosaur running, jumping, crouching and collision frames, birds, cacti, clouds, ground, score digits, and game-over artwork. Pixel smoothing is disabled. Artwork is fitted to this project's collision geometry; sprite outlines do not define collision masks. Decorative clouds and terrain are deterministic functions of distance.

The canvas score is `round(distance × 0.025)`. Fitness and research metrics use raw world distance. In evolution mode, the canvas HI value is the maximum episode distance of the current training champion, not an additional selection criterion. In standalone play it is the best completed manual or replay episode in the page session.

Determinism refers to the same configuration, seeds, and tick-indexed action sequence. Identical human wall-clock key presses are not a reproducibility guarantee. Bitwise agreement across all JavaScript runtimes has not been established.

## 4. Neural policy

The fixed architecture is **11 → 8 → 3**, with 123 real-valued genes:

`hidden = tanh(W1 × inputs + b1)`

`logits = W2 × hidden + b2`

The output with the largest logit selects run, jump, or duck. Ties choose the lowest index, in that order. No softmax, stochastic sampling, gradient descent, or topology mutation is used.

| Genome region, zero-based half-open interval | Contents |
| --- | --- |
| [0, 88) | W1, hidden-neuron-major rows |
| [88, 96) | Hidden biases |
| [96, 120) | W2, output-neuron-major rows |
| [120, 123) | Output biases |

Weights initialize independently from Xavier uniform distributions, with bounds `sqrt(6 / (fan_in + fan_out))`; biases initialize to zero. All imported genes must be finite and within [-5, 5]. Genomes remain fixed during candidate evaluation.

## 5. Evolutionary method

| Configuration field | Default |
| --- | --- |
| `populationSize` | 100 |
| `eliteCount` | 5 |
| `tournamentSize` | 3 |
| `mutationProbability` | 0.10 per gene |
| `mutationSigma` | 0.15 |
| `evolutionSeed` | 2026 |
| `baselineSeed` | 9001 |
| `trainingSeeds` | [42, 81, 813] |
| `validationSeeds` | [1042, 1081, 1813] |
| `testSeeds` | [2042, 2081, 2813] |
| `maxGenerations` | 30 |
| `maxEnvironmentSteps` | 5,000,000 living-agent transitions |

Each generation evaluates every genome on the same fixed training-seed set. The next episode begins only after all candidates terminate or reach the task time limit. Fitness is the arithmetic mean of episode distances across all training seeds. Cards distinguish completed-episode partial averages from final fitness. The generation's best, mean, and median are recorded only after complete evaluation.

Candidates rank by descending fitness; ties use ascending ID. The top five elites copy their genes exactly into newly identified individuals, with one recorded parent and zero mutations. Other offspring independently select two parents through tournaments sampled with replacement; self-mating is possible. Each gene is inherited from either parent with probability 0.5. Mutation independently selects each gene with probability 0.1, adds a Box–Muller Gaussian perturbation with standard deviation 0.15, and clips the result to [-5, 5]. Mutation counts record genes whose final values actually changed, including the effects of clipping.

An evolution-specific Mulberry32 stream controls initialization and genetic operators. Environment and baseline streams are independent. Selection, rendering, playback speed, and external evaluation never consume this stream. A generation transition allocates new IDs and records parent IDs, origin, generation, and mutation counts. The exported training champion is the highest-fitness completely evaluated individual seen so far; exact ties retain the earlier champion. Validation and test results never select this champion.

Training stops at the generation limit or agent-step budget. A shared tick is advanced only if its entire active population fits the remaining budget; the counter may therefore end slightly below the limit. A partial final generation receives no fabricated fitness and is not used to breed another generation. World ticks and individual transitions are reported separately. Evaluation steps are reported separately from the training budget.

## 6. Evaluation protocol

Training, validation, and test seed sets must be nonempty, internally unique, and mutually disjoint. The trainer only reads training seeds. External evaluation compares the selected exported/imported policy against:

- **Always-run:** run on every tick.
- **Random-action:** independently choose run, jump, or duck with probability 1/3 each tick. Each episode uses a separate Mulberry32 stream seeded with unsigned `baselineSeed XOR environmentSeed`.
- **Rule-based:** run until the nearest obstacle is closer than `speed × 0.28 + 10`; duck if it is a bird whose bottom elevation is at least the crouching height, otherwise jump when grounded and run while airborne. This threshold is a fixed implemented heuristic, not a learned policy or a separately tuned benchmark optimum.
- **Neural:** deterministic inference using the exported genome and versioned preprocessing.

Reports include per-seed distance, tick count, termination reason, aggregate mean and median distance, collision/timeout counts, environment-step totals, and the evaluated genome. No evaluation result is fed back into genetic operators. Baseline and policy results are associated with their report's configuration and coefficients, not with a globally unique numerical individual ID.

For a research comparison, predefine the training budget and hyperparameters, repeat training using multiple independent evolution seeds, use validation data for development choices, and reserve test data for final reporting. Report uncertainty across independent training runs and account for time-limit censoring. A single run or a rising training curve does not establish generalization or superiority. Repeatedly inspecting test results while changing the method invalidates its role as held-out evaluation.

## 7. Validation performed

### 7.1 Automated checks

Thirty tests cover original task behavior, normalized input encoding, analytic forward-pass results, genome round-tripping, seeded initialization, selection ties, crossover, mutation endpoints and clipping, exact elite preservation, shared-world fairness, frozen traces after death, full-seed evaluation boundaries, generation reproducibility under different batching, budget stopping, policy import validation, evaluation independence, and pre-refactor trajectory checksums. `npm run build` also performs strict TypeScript checking and builds the evaluation worker.

The browser interface has not been visually or interactively validated in the implementation session because no browser connection was available. Compilation and HTTP delivery checks do not substitute for that validation.

### 7.2 Integration run, not a benchmark study

The following local smoke experiment used the defaults except `maxGenerations=5`, with evolution seed 2026, Node.js 24.20.0, 100 individuals, and three training seeds:

```sh
npm run experiment -- --generations 5 --validation --out artifacts/smoke-run.json
```

| Measurement | Observed value |
| --- | --- |
| Completed candidate episodes | 1,500 |
| Training agent transitions | 281,745 |
| Shared world ticks | 13,182 |
| Generation 1 best mean training distance | 1,678.24 |
| Generation 5 best mean training distance | 5,700.73 |
| Exported training champion | Individual 254, first obtained in generation 3 |

Validation results on [1042, 1081, 1813]:

| Policy | Mean distance | Collisions | Time-limit truncations | Evaluation agent steps |
| --- | ---: | ---: | ---: | ---: |
| Always-run | 841.55 | 3 | 0 | 498 |
| Random-action | 868.98 | 3 | 0 | 514 |
| Rule-based | 93,002.50 | 0 | 3 | 32,400 |
| Neural training champion | 2,355.39 | 3 | 0 | 1,337 |

These observations verify an operational pipeline and expose a substantial gap to the rule-based controller in this run. They are not an estimate of performance across independent training seeds. No test-split evaluation was performed for this smoke run. Regenerate the ignored local artifact with the command above to inspect full coefficients and episode results.

## 8. Policy format and project structure

`dino-evolution/champion-v1` stores task constants, network layout, preprocessing, all experiment seeds and parameters, current generation and budgets, completed-generation history, training champion coefficients and outcomes, optional evaluation reports, and provenance. Imports check task compatibility, finite bounded genes, configuration, champion metadata, training episodes, and consistency of recorded fitness. Import restores a policy for replay; it is not an exact-resume population/RNG checkpoint.

```text
src/
  game/          # Seeded shared world and independent player transitions
  ai/            # Observation normalization and neural inference
  evolution/     # Configuration, genetic operators, population trainer
  experiments/   # Baselines, evaluation worker, policy serialization
  rendering/     # Original sprite rendering
  ui/            # Brain diagrams, weights, and training curves
  main.ts        # Browser sessions and controls
scripts/
  experiment.mjs # Headless runs and artifact export
tests/           # Task, learning, and reproducibility checks
```

## 9. Limitations and further work

- The policy observes only the nearest relevant obstacle. It has no recurrent state or lookahead to a second obstacle.
- Task geometry uses rectangles and a fixed jump impulse rather than calibrated original Chrome collision masks and jump-release dynamics. Birds retain fixed collision boxes throughout wing animation.
- Shared-seed replay does not prove that every generated sequence is solvable. The training-seed set is small and fixed, so overfitting is a material experimental limitation.
- Training runs on the browser main thread in bounded batches. Evaluation runs in a worker; very large populations can still reduce rendering responsiveness. Requested playback acceleration is not guaranteed wall-clock acceleration.
- The archive retains final states and traces, not all historical decisions. Policy export supports replay rather than exact continuation of an interrupted training population.
- Multiple independent training runs, uncertainty estimates, ablations, browser interaction checks, and transfer to the original Chrome game remain future validation work. No superiority claim is made.

## 10. Contributing and licensing

Contributions should explain the implementation or research problem, document changes to task assumptions, and provide relevant validation. Run `npm test` and `npm run build` before submitting a pull request. Include configuration, seed, runtime, and tick-indexed actions in reproducibility reports. Documentation, interface text, and source comments are maintained in English.

Original project code is MIT licensed: see [LICENSE](LICENSE). Chromium artwork retains its BSD-style license: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [public/assets/CHROMIUM-LICENSE](public/assets/CHROMIUM-LICENSE).
