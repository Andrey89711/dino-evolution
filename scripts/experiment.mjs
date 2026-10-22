import { writeFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Trainer } from '../.test-build/evolution/trainer.js';
import { exportCheckpoint } from '../.test-build/experiments/checkpoint.js';
import { evaluateSuite } from '../.test-build/experiments/evaluation.js';

const args = process.argv.slice(2);
function argument(name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}
const configPath = argument('--config', null);
const config = configPath ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
if (args.includes('--generations')) config.maxGenerations = Number(argument('--generations'));
if (args.includes('--evolution-seed')) config.evolutionSeed = Number(argument('--evolution-seed'));
const trainer = new Trainer(config);
let lastGeneration = 0;
const started = performance.now();
while (!trainer.finished) {
  trainer.tick();
  if (trainer.history.length !== lastGeneration) {
    lastGeneration = trainer.history.length;
    console.log(JSON.stringify(trainer.history.at(-1)));
  }
}
if (!trainer.champion) throw new Error('The budget ended before a complete generation; no champion can be exported.');
const evaluations = args.includes('--validation') ? [evaluateSuite('validation', trainer.champion.id,
  trainer.config.validationSeeds, trainer.config.baselineSeed, trainer.champion.genome)] : [];
let commit = 'not-recorded';
let workingTreeStatus = 'not-recorded';
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  workingTreeStatus = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || 'clean';
} catch { /* Git metadata is optional. */ }
function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? sourceFiles(join(directory, entry.name)) : [join(directory, entry.name)]);
}
const sourceHash = createHash('sha256');
for (const path of [...sourceFiles('src'), ...sourceFiles('scripts'), 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.test.json'].sort()) {
  sourceHash.update(path.replaceAll('\\', '/')); sourceHash.update('\0'); sourceHash.update(readFileSync(path));
}
const checkpoint = exportCheckpoint(trainer, evaluations, {
  node: process.version, platform: process.platform, commit,
  workingTreeStatus, sourceSha256: sourceHash.digest('hex'),
  elapsedSeconds: ((performance.now() - started) / 1000).toFixed(3),
});
const output = argument('--out', 'artifacts/experiment.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(checkpoint, null, 2) + '\n');
console.log(`Saved ${output}; stop reason: ${trainer.finished}. No test seeds were evaluated.`);
