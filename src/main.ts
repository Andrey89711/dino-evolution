import './style.css';
import { CONFIG, Environment, TASK_VERSION, initialPlayer } from './game/environment.js';
import { forward } from './ai/network.js';
import { Trainer, type Individual } from './evolution/trainer.js';
import { makeConfig, type EvolutionConfig } from './evolution/config.js';
import { exportCheckpoint, importCheckpoint, type Checkpoint } from './experiments/checkpoint.js';
import type { EvaluationReport } from './experiments/evaluation.js';
import { drawPlayer, render } from './rendering/canvas.js';
import { brainTooltip, drawBrain, weightTable } from './ui/brain.js';
import { drawHistory } from './ui/history.js';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Application root #app is missing.');
app.innerHTML = `
<main>
  <header><p class="eyebrow">Neuroevolution laboratory / ${TASK_VERSION}</p>
    <h1>Dino Evolution</h1><p>One environment. One hundred policies. Watch the decisions evolve.</p>
    <div class="topline"><label>Session <select id="mode"><option value="evolution">Evolution</option><option value="manual">Manual control</option><option value="replay" disabled>Imported policy replay</option></select></label>
    <span class="tag">11 inputs → 8 hidden → 3 actions / 123 genes</span></div>
  </header>

  <section class="panel" aria-labelledby="brain-title" id="brain-panel">
    <div class="section-head"><div><p class="eyebrow">01 / Decision microscope</p><h2 id="brain-title">Selected brain</h2></div>
    <div class="inline"><label>Individual <select id="selection" aria-label="Select individual"></select></label><label class="check"><input id="follow" type="checkbox"> Follow leader</label></div></div>
    <p id="selected-meta" class="metadata"></p>
    <div class="brain-scroll"><canvas id="brain" width="900" height="430" aria-label="Selected neural network. Numeric values and weights are available in the table below."></canvas></div>
    <p id="trace-meta" class="metadata"></p>
    <p class="legend">Brightness = activation · Width = |weight| · Dashed = negative weight · Box = chosen action</p>
    <output id="brain-tooltip">Hover a neuron or connection to inspect its value.</output>
    <details><summary>Raw observations and exact decision values</summary><pre id="decision-values" class="table-scroll"></pre></details>
    <details id="weights"><summary>All 123 weights and biases</summary><div id="weight-table" class="table-scroll"></div></details>
  </section>

  <section class="experiment" aria-label="Shared game field">
    <div class="toolbar"><span class="tag" id="field-mode">Shared population</span><span id="status" role="status">Ready</span></div>
    <canvas id="field" width="960" height="300" tabindex="0" aria-label="Dinosaur game field. In manual mode, Space to jump, Down or S to duck, R to restart."></canvas>
    <p class="field-caption" id="field-caption"></p>
    <div class="metrics" id="metrics"></div>
    <div class="controls">
      <button id="start" class="primary">Start</button><button id="step">Step one tick</button>
      <label>Playback <select id="speed"><option value="1">1×</option><option value="5">5×</option><option value="20">20×</option></select></label>
      <button id="reset">Reset experiment</button>
      <div class="manual-controls" hidden><label>Seed <input id="manual-seed" type="number" min="0" max="4294967295" step="1" value="42"></label><button id="restart">Restart episode</button><button id="jump">Jump ↑</button><button id="duck" aria-pressed="false">Duck ↓</button></div>
    </div>
    <p class="hint" id="controls-hint">Start evolves the population. Step advances one shared physics tick while paused. Selection never affects training.</p>
  </section>

  <section class="panel" id="population-panel" aria-labelledby="population-title">
    <div class="section-head"><div><p class="eyebrow">02 / Population</p><h2 id="population-title">Every brain, one field</h2></div><span id="population-summary" class="metadata"></span></div>
    <p class="metadata">Cards show the last actual decision. Fitness is final only after every training seed; completed-episode averages are marked partial.</p>
    <div id="population" class="population-grid"></div>
  </section>

  <section class="panel" id="progress-panel" aria-labelledby="progress-title">
    <div class="section-head"><div><p class="eyebrow">03 / Training record</p><h2 id="progress-title">Generation history</h2></div><span class="metadata">Training performance ≠ held-out performance</span></div>
    <canvas id="history" width="900" height="220" aria-label="Best, mean, and median fitness against cumulative agent environment steps"></canvas>
    <details><summary>Generation metrics</summary><div id="history-table" class="table-scroll"></div></details>
    <div class="controls"><button id="export">Export training champion</button><button id="import">Import policy JSON</button><input id="file" type="file" accept="application/json,.json" hidden></div>
    <p id="checkpoint-status" class="metadata">No fully evaluated training champion yet. Imported policies replay separately from evolution.</p>
  </section>

  <section class="panel" aria-labelledby="evaluation-title">
    <p class="eyebrow">04 / Independent evaluation</p><h2 id="evaluation-title">Compare with baselines</h2>
    <p class="metadata">Always-run, uniform random actions, a fixed distance rule, and the training champion. These results never enter selection or mutation.</p>
    <div class="controls"><button id="validate">Evaluate validation split</button><button id="test">Run held-out test</button></div>
    <p id="evaluation-status" class="metadata">Complete a generation or import a policy first. Reserve the test split for final reporting.</p>
    <div id="evaluation-results" class="table-scroll"></div>
  </section>

  <details class="panel" id="config-panel"><summary>Experiment configuration · applies on Reset experiment</summary>
    <form id="configuration" class="config-grid"></form><p class="metadata">Seed sets must be unique and disjoint. The budget counts individual policy steps, not rendered frames.</p>
  </details>
  <p id="error" role="alert"></p>
  <footer><span>Fixed-step simulation / seeded evolution</span><p>Original Chromium artwork · Research prototype · No claim of transfer to Chrome Dino</p></footer>
</main>`;

function el<T extends HTMLElement = HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing element: ${selector}`);
  return node;
}
function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable.');
  return ctx;
}
const field = el<HTMLCanvasElement>('#field'), ctx = context(field);
const ratio = Math.max(1, Math.ceil(devicePixelRatio || 1));
field.width = CONFIG.width * ratio; field.height = CONFIG.height * ratio; ctx.scale(ratio, ratio);
const brain = el<HTMLCanvasElement>('#brain');
const modeSelect = el<HTMLSelectElement>('#mode');
const selection = el<HTMLSelectElement>('#selection');
const follow = el<HTMLInputElement>('#follow');
const startButton = el<HTMLButtonElement>('#start');
const stepButton = el<HTMLButtonElement>('#step');
const duckButton = el<HTMLButtonElement>('#duck');
const atlas = new Image();
atlas.src = new URL('assets/chromium-dino.png', document.baseURI).href;
const selectedAtlas = document.createElement('canvas');
let loaded = false;
let trainer = new Trainer();
let selectedId = trainer.population[0]!.id;
let mode: 'evolution' | 'manual' | 'replay' = 'evolution';
let running = false, started = false;
let accumulator = 0, lastTime = performance.now(), lastDetail = -Infinity, lastCards = -Infinity;
let cardsGeneration = 0, weightsKey = '', historyLength = -1;
let imported: Checkpoint | null = null;
let replayIndividual: Individual | null = null;
let single = new Environment(42);
let manualBest = 0;
let pendingJump = false, duckToggle = false;
const duckKeys = new Set<string>();
const reports: EvaluationReport[] = [];
let evaluationWorker: Worker | null = null;

const configFields: [keyof EvolutionConfig, string, string][] = [
  ['populationSize', 'Population size', '1'], ['eliteCount', 'Elite count', '1'], ['tournamentSize', 'Tournament size', '1'],
  ['mutationProbability', 'Mutation probability', '0.01'], ['mutationSigma', 'Mutation sigma', '0.01'],
  ['evolutionSeed', 'Evolution seed', '1'], ['baselineSeed', 'Baseline seed', '1'],
  ['maxGenerations', 'Generation limit', '1'], ['maxEnvironmentSteps', 'Agent-step budget', '1'],
  ['trainingSeeds', 'Training seeds', 'text'], ['validationSeeds', 'Validation seeds', 'text'], ['testSeeds', 'Held-out test seeds', 'text'],
];
el('#configuration').innerHTML = configFields.map(([key, label, step]) => `<label>${label}<input name="${key}" type="${step === 'text' ? 'text' : 'number'}" ${step === 'text' ? '' : `step="${step}"`} value="${Array.isArray(trainer.config[key]) ? (trainer.config[key] as number[]).join(', ') : trainer.config[key]}" required></label>`).join('');
el<HTMLFormElement>('#configuration').addEventListener('submit', event => event.preventDefault());

function error(message = ''): void { el('#error').textContent = message; }
function readConfig(): EvolutionConfig {
  const data = new FormData(el<HTMLFormElement>('#configuration'));
  const entries = configFields.map(([key, , step]) => {
    const value = String(data.get(key));
    if (!value.trim()) throw new Error(`Missing ${key}.`);
    return [key, step === 'text' ? value.split(',').map(part => {
      if (!part.trim()) throw new Error('Empty seed value.');
      return Number(part.trim());
    }) : Number(value)];
  });
  return makeConfig(Object.fromEntries(entries));
}
function clearInput(): void {
  pendingJump = false; duckToggle = false; duckKeys.clear(); duckButton.setAttribute('aria-pressed', 'false');
}
function selected(): Individual | undefined {
  return mode === 'replay' ? replayIndividual ?? undefined : trainer.find(selectedId);
}
function invalidate(): void { lastCards = -Infinity; lastDetail = -Infinity; }
function selectIndividual(id: number): void {
  selectedId = id; follow.checked = false; weightsKey = ''; invalidate();
}

function updateSelectionOptions(): void {
  const archived = trainer.population.some(p => p.id === selectedId) ? null : trainer.find(selectedId);
  selection.replaceChildren(...trainer.population.map(p => new Option(`#${p.id} · G${p.generation}`, String(p.id))));
  if (archived) selection.add(new Option(`#${archived.id} · G${archived.generation} · archived`, String(archived.id)));
  selection.value = String(selectedId);
}

function rebuildCards(): void {
  const container = el('#population');
  container.innerHTML = trainer.population.map(p => `<button class="brain-card" data-id="${p.id}" aria-label="Inspect individual ${p.id}" aria-pressed="false"><span class="card-heading"><b>#${p.id}</b><span class="card-status">Awaiting</span></span><canvas width="136" height="78" aria-hidden="true"></canvas><span class="card-action"></span><span class="card-distance"></span><span class="card-fitness"></span></button>`).join('');
  cardsGeneration = trainer.generation;
  updateSelectionOptions();
}

function refreshDetails(): void {
  const individual = selected();
  if (!individual) return;
  const archived = mode === 'evolution' && individual.generation !== trainer.generation;
  const fitness = individual.fitness === null ? 'pending' : individual.fitness.toFixed(1);
  el('#selected-meta').textContent = `#${individual.id} · Generation ${individual.generation} · ${individual.origin} · Parents ${individual.parents.length ? individual.parents.map(id => '#' + id).join(', ') : 'none'} · ${individual.mutations} mutated genes · ${individual.state.status === 'running' ? 'alive' : individual.state.status} · ${individual.state.distance.toFixed(1)} units · Fitness ${fitness}${archived ? ' · ARCHIVED SELECTION' : ''}`;
  const trace = individual.trace;
  el('#decision-values').textContent = trace ? JSON.stringify(trace, null, 2) : 'Awaiting first decision.';
  el('#trace-meta').textContent = trace ? `Actual decision at seed ${trace.seed}, input tick ${trace.tick} → state tick ${individual.state.tick}. Action: ${trace.action}. ${individual.state.status === 'running' ? '' : `Final trace frozen after ${individual.state.status}.`}` : 'No decision yet. Start or step to compute the first forward pass.';
  drawBrain(brain, individual);
  const key = `${mode}:${individual.id}:${individual.generation}`;
  if (key !== weightsKey) { el('#weight-table').innerHTML = weightTable(individual); weightsKey = key; }
}

function refreshCards(): void {
  if (cardsGeneration !== trainer.generation) rebuildCards();
  for (const individual of trainer.population) {
    const card = el<HTMLButtonElement>(`.brain-card[data-id="${individual.id}"]`);
    card.setAttribute('aria-pressed', String(individual.id === selectedId));
    card.dataset.state = individual.state.status;
    card.querySelector('.card-status')!.textContent = individual.state.status === 'running' ? '● alive' : `× ${individual.state.status}`;
    card.querySelector('.card-action')!.textContent = individual.trace ? `Action: ${individual.trace.action}` : 'No decision';
    card.querySelector('.card-distance')!.textContent = `Distance ${individual.state.distance.toFixed(0)}`;
    card.querySelector('.card-fitness')!.textContent = individual.fitness === null
      ? `Partial ${individual.episodes.length ? trainer.partialScore(individual).toFixed(0) : '—'} · ${individual.episodes.length}/${trainer.config.trainingSeeds.length}`
      : `Fitness ${individual.fitness.toFixed(1)}`;
    drawBrain(card.querySelector('canvas')!, individual, true);
  }
  el('#population-summary').textContent = `${trainer.alive}/${trainer.config.populationSize} alive · Generation ${trainer.generation}`;
}

function refreshMetrics(): void {
  const state = single.state;
  const latest = trainer.history.at(-1);
  const values = mode === 'evolution' ? [
    ['Generation', `${trainer.generation} / ${trainer.config.maxGenerations}`],
    ['Seed / episode', `${trainer.worldState.seed} / ${trainer.episodeIndex + 1}`],
    ['Alive', `${trainer.alive} / ${trainer.config.populationSize}`],
    ['Agent steps', trainer.environmentSteps.toLocaleString('en-US')],
    ['Best fitness¹', latest?.best.toFixed(0) ?? '—'],
    ['Mean / median¹', latest ? `${latest.mean.toFixed(0)} / ${latest.median.toFixed(0)}` : '—'],
  ] : [['Distance', state.distance.toFixed(0)], ['Speed', state.speed.toFixed(1)], ['Simulation seconds', (state.tick * CONFIG.timeStep).toFixed(2)]];
  el('#metrics').innerHTML = values.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('');
  if (mode === 'evolution') {
    el('#status').textContent = trainer.finished ? `Finished · ${trainer.finished}` : running ? 'Evolving' : started ? 'Paused' : 'Ready';
    el('#controls-hint').textContent = '¹ Last fully evaluated generation, training seeds only. Speed changes scheduling, never the physics step. Step advances one tick while paused.';
  } else {
    el('#status').textContent = `${running ? 'Running' : 'Paused'} · ${state.status}`;
    el('#controls-hint').textContent = mode === 'manual' ? 'Space / ↑ jump · Hold ↓ / S to crouch or fall faster · Duck button toggles · R restarts' : 'Imported policy replay. No weights are inserted into the training population.';
  }
  startButton.textContent = running ? 'Pause' : started ? 'Resume' : 'Start';
  startButton.disabled = !loaded || (mode === 'evolution' ? !!trainer.finished : state.status !== 'running');
  stepButton.disabled = !loaded || running || (mode === 'evolution' ? !!trainer.finished : state.status !== 'running');
  el<HTMLButtonElement>('#export').disabled = !trainer.champion;
  for (const selector of ['#validate', '#test']) el<HTMLButtonElement>(selector).disabled = !!evaluationWorker || !(mode === 'replay' ? imported : trainer.champion);
}

function refreshHistory(): void {
  if (historyLength === trainer.history.length) return;
  historyLength = trainer.history.length;
  drawHistory(el('#history'), trainer.history);
  el('#history-table').innerHTML = `<table><thead><tr><th>Generation</th><th>Best</th><th>Mean</th><th>Median</th><th>Agent steps</th><th>Changed genes</th></tr></thead><tbody>${trainer.history.map(row => `<tr><td>${row.generation}</td><td>${row.best.toFixed(2)}</td><td>${row.mean.toFixed(2)}</td><td>${row.median.toFixed(2)}</td><td>${row.environmentSteps}</td><td>${row.mutations}</td></tr>`).join('')}</tbody></table>`;
  if (trainer.champion) el('#checkpoint-status').textContent = `Training champion #${trainer.champion.id}, generation ${trainer.champion.generation}: ${trainer.champion.fitness!.toFixed(1)} mean training distance. This is not a held-out performance claim.`;
}

function drawPopulation(): void {
  const world = trainer.worldState;
  render(ctx, initialPlayer(world), false, atlas,
    Math.max(0, ...(trainer.champion?.episodes.map(episode => episode.distance) ?? [])), false);
  const individual = selected();
  const paint = (p: Individual, isSelected: boolean): void => {
    const alive = p.state.status === 'running';
    const opacity = alive ? 1 : Math.max(0, 1 - (world.tick - p.state.tick) / 30);
    if (opacity <= 0) return;
    ctx.save();
    ctx.globalAlpha = opacity * (isSelected ? 1 : 0.16);
    if (isSelected) {
      for (const [x, y] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        ctx.save(); ctx.translate(x!, y!); drawPlayer(ctx, p.state, atlas); ctx.restore();
      }
      drawPlayer(ctx, p.state, selectedAtlas);
    } else drawPlayer(ctx, p.state, atlas);
    ctx.restore();
  };
  for (const p of trainer.population) if (p.id !== selectedId) paint(p, false);
  const current = individual && individual.generation === trainer.generation;
  if (current) {
    paint(individual, true);
    ctx.fillStyle = '#535353'; ctx.font = '12px monospace';
    ctx.fillText(`#${individual.id} · ${individual.state.status}`, 60, 50);
  }
  el('#field-caption').textContent = current
    ? `Selected #${individual.id}: light sprite with outline. Other policies: dark translucent sprites. ${individual.state.status !== 'running' ? 'Selected policy has ended; the shared world continues.' : ''}`
    : 'Selected policy belongs to an earlier generation. Its brain is archived; choose a current policy or enable Follow leader.';
}

function advance(): boolean {
  if (mode === 'evolution') return trainer.tick();
  if (single.state.status !== 'running') return false;
  let action = pendingJump ? 'jump' as const : duckToggle || duckKeys.size ? 'duck' as const : 'run' as const;
  if (mode === 'replay' && replayIndividual) {
    const trace = { ...forward(replayIndividual.genome, single.observe()), tick: single.state.tick, seed: single.state.seed };
    replayIndividual.trace = trace; action = trace.action;
  }
  const state = single.step(action);
  if (replayIndividual && mode === 'replay') replayIndividual.state = state;
  if (state.status !== 'running') manualBest = Math.max(manualBest, state.distance);
  pendingJump = false;
  return true;
}

function restartSingle(): void {
  const input = el<HTMLInputElement>('#manual-seed');
  const seed = Number(input.value);
  if (!input.value.trim() || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Enter an unsigned 32-bit episode seed.');
  single.reset(seed); clearInput();
  if (mode === 'replay' && imported) replayIndividual = {
    ...structuredClone(imported.champion), origin: 'imported', state: single.state, trace: null,
  };
  accumulator = 0; invalidate();
}

el('#population').addEventListener('click', event => {
  const card = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-id]');
  if (card) { selectIndividual(Number(card.dataset.id)); updateSelectionOptions(); }
});
selection.addEventListener('change', () => selectIndividual(Number(selection.value)));
follow.addEventListener('change', invalidate);
brain.addEventListener('pointermove', event => {
  const individual = selected();
  if (!individual) return;
  const rect = brain.getBoundingClientRect();
  el('#brain-tooltip').textContent = brainTooltip(individual, (event.clientX - rect.left) / rect.width * 900, (event.clientY - rect.top) / rect.height * 430);
});

startButton.addEventListener('click', () => {
  running = !running; started = true; accumulator = 0; lastTime = performance.now(); clearInput(); invalidate();
});
stepButton.addEventListener('click', () => { if (!running) { advance(); started = true; invalidate(); } });
el('#reset').addEventListener('click', () => {
  try {
    if (mode !== 'evolution') { restartSingle(); running = false; started = false; error(); return; }
    const next = new Trainer(readConfig());
    trainer = next; selectedId = trainer.population[0]!.id;
    running = false; started = false; cardsGeneration = 0; historyLength = -1; weightsKey = '';
    follow.checked = false; accumulator = 0; reports.length = 0;
    evaluationWorker?.terminate(); evaluationWorker = null;
    el('#evaluation-results').replaceChildren(); el('#evaluation-status').textContent = 'Experiment reset. Evaluation has not been run.';
    el('#checkpoint-status').textContent = 'No fully evaluated training champion yet.';
    clearInput(); error(); invalidate();
  } catch (failure) { error(failure instanceof Error ? failure.message : String(failure)); }
});
modeSelect.addEventListener('change', () => {
  mode = modeSelect.value as typeof mode; running = false; started = false; accumulator = 0; clearInput();
  for (const id of ['#population-panel', '#progress-panel', '#config-panel']) el(id).hidden = mode !== 'evolution';
  el('#brain-panel').hidden = mode === 'manual';
  el('.manual-controls').hidden = mode === 'evolution';
  el<HTMLButtonElement>('#jump').hidden = mode === 'replay'; duckButton.hidden = mode === 'replay';
  selection.disabled = mode !== 'evolution'; follow.disabled = mode !== 'evolution';
  el('#field-mode').textContent = mode === 'evolution' ? 'Shared population' : mode === 'manual' ? 'Manual control' : 'Imported policy replay';
  try { if (mode !== 'evolution') restartSingle(); } catch (failure) { error(String(failure)); }
  invalidate();
});
el('#restart').addEventListener('click', () => { try { restartSingle(); error(); } catch (failure) { error(String(failure)); } });
function requestJump(): void {
  if (mode !== 'manual' || !running) return;
  pendingJump = true; duckToggle = false; duckButton.setAttribute('aria-pressed', 'false');
}
el('#jump').addEventListener('click', requestJump);
duckButton.addEventListener('click', () => {
  if (mode !== 'manual' || !running) return;
  duckToggle = !duckToggle; duckButton.setAttribute('aria-pressed', String(duckToggle));
});
window.addEventListener('keydown', event => {
  if (mode !== 'manual' || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if ((event.code === 'Space' || event.code === 'Enter') && event.target instanceof HTMLButtonElement) return;
  if (event.code === 'ArrowDown' || event.code === 'KeyS') { event.preventDefault(); if (running) duckKeys.add(event.code); }
  if (event.code === 'Space' || event.code === 'ArrowUp') { event.preventDefault(); if (!event.repeat) requestJump(); }
  if (event.code === 'KeyR' && !event.repeat) { try { restartSingle(); } catch (failure) { error(String(failure)); } }
});
window.addEventListener('keyup', event => duckKeys.delete(event.code));
window.addEventListener('blur', clearInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) { running = false; accumulator = 0; clearInput(); invalidate(); } });

function download(value: unknown, name: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
el('#export').addEventListener('click', () => {
  try {
    download(exportCheckpoint(trainer, reports, { runtime: navigator.userAgent, commit: 'not-recorded', exportedAt: new Date().toISOString() }), `dino-champion-g${trainer.champion!.generation}.json`);
    error();
  } catch (failure) { error(String(failure)); }
});
el('#import').addEventListener('click', () => el<HTMLInputElement>('#file').click());
el<HTMLInputElement>('#file').addEventListener('change', async event => {
  try {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 2_000_000) throw new Error('Policy JSON must be smaller than 2 MB.');
    const checkpoint = importCheckpoint(JSON.parse(await file.text()));
    imported = checkpoint;
    modeSelect.options[2]!.disabled = false; modeSelect.value = 'replay';
    modeSelect.dispatchEvent(new Event('change')); error();
    el('#evaluation-status').textContent = `Imported policy #${checkpoint.champion.id}. Replay is paused; press Start. Training population is unchanged.`;
  } catch (failure) { error(failure instanceof Error ? failure.message : String(failure)); }
  finally { (event.target as HTMLInputElement).value = ''; }
});

function displayEvaluations(): void {
  el('#evaluation-results').innerHTML = reports.map(report => `<h3>${report.split === 'test' ? 'Held-out test' : 'Validation'} · Policy #${report.policyId} · seeds ${report.seeds.join(', ')}</h3><table><thead><tr><th>Policy</th><th>Mean distance</th><th>Median</th><th>Collisions</th><th>Timeouts</th><th>Agent steps</th></tr></thead><tbody>${report.rows.map(row => `<tr><td>${row.policy}</td><td>${row.meanDistance.toFixed(1)}</td><td>${row.medianDistance.toFixed(1)}</td><td>${row.collisions}</td><td>${row.timeouts}</td><td>${row.environmentSteps}</td></tr>`).join('')}</tbody></table>`).join('');
}
function evaluate(split: 'validation' | 'test'): void {
  if (evaluationWorker) return;
  const policy = mode === 'replay' ? imported?.champion : trainer.champion;
  if (!policy) return;
  const config = mode === 'replay' ? imported!.config : trainer.config;
  const seeds = split === 'validation' ? config.validationSeeds : config.testSeeds;
  evaluationWorker = new Worker(new URL('./experiments/evaluation.worker.ts', import.meta.url), { type: 'module' });
  el('#evaluation-status').textContent = `Evaluating ${split} seeds in a worker. These results are excluded from training.`;
  evaluationWorker.onmessage = event => {
    const { report, error: failure } = event.data;
    if (failure) error(String(failure));
    else {
      reports.push(report as EvaluationReport); displayEvaluations();
      el('#evaluation-status').textContent = `${split} evaluation completed. Report is associated with policy #${policy.id}; repeat independent training runs before making performance claims.`;
      download({ taskVersion: TASK_VERSION, report, policy: { id: policy.id, genome: policy.genome }, config }, `dino-${split}-policy-${policy.id}.json`);
    }
    evaluationWorker?.terminate(); evaluationWorker = null; invalidate();
  };
  evaluationWorker.onerror = () => { error('Evaluation worker failed.'); evaluationWorker?.terminate(); evaluationWorker = null; invalidate(); };
  evaluationWorker.postMessage({ split, policyId: policy.id, seeds, baselineSeed: config.baselineSeed, genome: policy.genome });
  invalidate();
}
el('#validate').addEventListener('click', () => evaluate('validation'));
el('#test').addEventListener('click', () => evaluate('test'));

function frame(now: number): void {
  const delta = Math.min((now - lastTime) / 1000, 0.25); lastTime = now;
  if (running && loaded) {
    accumulator = Math.min(accumulator + delta * Number(el<HTMLSelectElement>('#speed').value), 2);
    const deadline = performance.now() + 8;
    while (accumulator >= CONFIG.timeStep && performance.now() < deadline) {
      if (!advance()) { running = false; break; }
      accumulator -= CONFIG.timeStep;
      if (mode === 'evolution' ? trainer.finished : single.state.status !== 'running') { running = false; break; }
    }
  }
  if (mode === 'evolution' && follow.checked) {
    const leader = trainer.leader();
    if (leader.id !== selectedId) { selectedId = leader.id; updateSelectionOptions(); weightsKey = ''; invalidate(); }
  }
  if (loaded) {
    if (mode === 'evolution') drawPopulation();
    else {
      render(ctx, single.state, !running && single.state.status === 'running', atlas, manualBest);
      el('#field-caption').textContent = mode === 'manual' ? 'Manual session uses the same dino-v0.2 physics as training.' : 'Replaying imported weights with their original observation preprocessing.';
    }
  }
  if (now - lastDetail >= 100) {
    refreshMetrics(); if (mode !== 'manual') refreshDetails(); refreshHistory(); lastDetail = now;
  }
  if (mode === 'evolution' && now - lastCards >= 250) { refreshCards(); lastCards = now; }
  requestAnimationFrame(frame);
}

rebuildCards(); refreshMetrics(); refreshDetails(); refreshHistory();
atlas.decode().then(() => {
  selectedAtlas.width = atlas.naturalWidth; selectedAtlas.height = atlas.naturalHeight;
  const tint = context(selectedAtlas); tint.drawImage(atlas, 0, 0);
  tint.globalCompositeOperation = 'source-in'; tint.fillStyle = '#ccc'; tint.fillRect(0, 0, selectedAtlas.width, selectedAtlas.height);
  loaded = true; lastTime = performance.now(); invalidate();
}).catch(() => error('Unable to load Chromium artwork. Reload to retry.'));
requestAnimationFrame(frame);
