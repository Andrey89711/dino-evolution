import './style.css';
import { CONFIG, Environment, TASK_VERSION } from './game/environment.js';
import { render } from './rendering/canvas.js';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Application root #app is missing.');
app.innerHTML = `
  <main>
    <header><p class="eyebrow">Evolutionary learning · ${TASK_VERSION}</p>
    <h1>Dino Evolution</h1>
    <p>A reproducible environment for learning to survive.</p></header>
    <section class="experiment" aria-label="Manual experiment">
      <div class="toolbar"><span class="tag">Manual control</span><span id="status" role="status"></span></div>
      <canvas width="960" height="300" tabindex="0" aria-label="Dinosaur game. Space or Arrow Up to jump; Arrow Down or S to duck; R to restart."></canvas>
      <div class="metrics">
        <div><span>Distance</span><strong id="distance">0</strong><small>world units</small></div>
        <div><span>Speed</span><strong id="speed">300</strong><small>units / second</small></div>
        <div><span>Elapsed</span><strong id="elapsed">0.00</strong><small>simulation seconds</small></div>
      </div>
      <form id="controls">
        <label>Environment seed<input id="seed" type="number" min="0" max="4294967295" step="1" value="42" required></label>
        <button type="submit">Restart</button>
        <button id="pause" type="button">Pause</button>
        <button id="jump" type="button">Jump ↑</button>
        <button id="duck" type="button" aria-pressed="false">Duck ↓</button>
      </form>
      <p class="hint">Space / ↑ jump · Hold ↓ / S to duck or fall faster · R replay · Duck button toggles crouching</p>
    </section>
    <footer><span>01 / Environment</span><p>Fixed-step physics · Seeded obstacles · Learning algorithm under development</p></footer>
  </main>`;

function element<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing element: ${selector}`);
  return node;
}
const canvas = element<HTMLCanvasElement>('canvas');
const context = canvas.getContext('2d');
if (!context) throw new Error('Canvas 2D is unavailable.');
const ctx = context;
const pixelRatio = Math.max(1, Math.ceil(window.devicePixelRatio || 1));
canvas.width = CONFIG.width * pixelRatio;
canvas.height = CONFIG.height * pixelRatio;
ctx.scale(pixelRatio, pixelRatio);
const atlas = new Image();
atlas.src = new URL('assets/chromium-dino.png', document.baseURI).href;
const seedInput = element<HTMLInputElement>('#seed');
const pauseButton = element<HTMLButtonElement>('#pause');
const duckButton = element<HTMLButtonElement>('#duck');
const distance = element('#distance');
const speed = element('#speed');
const elapsed = element('#elapsed');
const status = element('#status');
const environment = new Environment(42);
let paused = false;
let pendingJump = false;
let accumulator = 0;
let lastTime = performance.now();
let bestDistance = 0;
const duckKeys = new Set<string>();
let duckToggled = false;

function clearInput(): void {
  pendingJump = false;
  duckKeys.clear();
  duckToggled = false;
  duckButton.setAttribute('aria-pressed', 'false');
}

function requestJump(): void {
  if (paused || environment.state.status !== 'running') return;
  pendingJump = true;
  duckToggled = false;
  duckButton.setAttribute('aria-pressed', 'false');
}

function restart(): void {
  if (!seedInput.reportValidity()) return;
  environment.reset(Number(seedInput.value));
  paused = false;
  clearInput();
  accumulator = 0;
  lastTime = performance.now();
  pauseButton.textContent = 'Pause';
  canvas.focus({ preventScroll: true });
}
function togglePause(): void {
  if (environment.state.status !== 'running') return;
  paused = !paused;
  accumulator = 0;
  clearInput();
  lastTime = performance.now();
  pauseButton.textContent = paused ? 'Resume' : 'Pause';
}
element<HTMLFormElement>('#controls').addEventListener('submit', event => {
  event.preventDefault();
  restart();
});
pauseButton.addEventListener('click', togglePause);
element('#jump').addEventListener('click', requestJump);
duckButton.addEventListener('click', () => {
  if (paused || environment.state.status !== 'running') return;
  duckToggled = !duckToggled;
  duckButton.setAttribute('aria-pressed', String(duckToggled));
});
canvas.addEventListener('click', () => {
  if (environment.state.status !== 'running') restart();
});
window.addEventListener('keydown', event => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.code === 'Space' && event.target instanceof HTMLButtonElement) return;
  if (event.code === 'ArrowDown' || event.code === 'KeyS') {
    event.preventDefault();
    if (!paused) duckKeys.add(event.code);
  }
  if (event.code === 'Space' || event.code === 'ArrowUp') {
    event.preventDefault();
    if (!event.repeat) requestJump();
  }
  if (event.code === 'KeyR' && !event.repeat) restart();
});
window.addEventListener('keyup', event => { duckKeys.delete(event.code); });
window.addEventListener('blur', clearInput);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !paused) togglePause();
});
function frame(now: number): void {
  // Drop wall-clock backlog after a stall; simulation ticks remain fixed-size.
  const delta = Math.min((now - lastTime) / 1000, 0.25);
  lastTime = now;
  if (!paused) {
    accumulator += delta;
    while (accumulator >= CONFIG.timeStep) {
      environment.step(pendingJump ? 'jump' : duckToggled || duckKeys.size > 0 ? 'duck' : 'run');
      pendingJump = false;
      accumulator -= CONFIG.timeStep;
    }
  }
  const state = environment.state;
  if (state.status !== 'running') bestDistance = Math.max(bestDistance, state.distance);
  render(ctx, state, paused, atlas, bestDistance);
  distance.textContent = state.distance.toFixed(0);
  speed.textContent = state.speed.toFixed(1);
  elapsed.textContent = (state.tick * CONFIG.timeStep).toFixed(2);
  status.textContent = paused ? 'Paused' : state.status === 'running' ? 'Running' : state.status === 'collision' ? 'Collision' : 'Time limit';
  pauseButton.disabled = state.status !== 'running';
  duckButton.disabled = paused || state.status !== 'running';
  requestAnimationFrame(frame);
}
atlas.decode().then(() => {
  lastTime = performance.now();
  requestAnimationFrame(frame);
}).catch(() => {
  status.textContent = 'Unable to load game artwork. Reload to retry.';
});
