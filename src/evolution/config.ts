export interface EvolutionConfig {
  populationSize: number;
  eliteCount: number;
  tournamentSize: number;
  mutationProbability: number;
  mutationSigma: number;
  evolutionSeed: number;
  baselineSeed: number;
  trainingSeeds: number[];
  validationSeeds: number[];
  testSeeds: number[];
  maxGenerations: number;
  maxEnvironmentSteps: number;
}

export const DEFAULT_CONFIG: EvolutionConfig = {
  populationSize: 100, eliteCount: 5, tournamentSize: 3,
  mutationProbability: 0.1, mutationSigma: 0.15,
  evolutionSeed: 2026, baselineSeed: 9001,
  trainingSeeds: [42, 81, 813], validationSeeds: [1042, 1081, 1813], testSeeds: [2042, 2081, 2813],
  maxGenerations: 30, maxEnvironmentSteps: 5_000_000,
};

export function makeConfig(overrides: Partial<EvolutionConfig> = {}): EvolutionConfig {
  const config = structuredClone({ ...DEFAULT_CONFIG, ...overrides });
  const integer = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;
  if (!integer(config.populationSize, 2, 1000) || !integer(config.eliteCount, 1, config.populationSize - 1) ||
      !integer(config.tournamentSize, 1, config.populationSize) || !integer(config.maxGenerations, 1, 1000) ||
      !integer(config.maxEnvironmentSteps, config.populationSize, Number.MAX_SAFE_INTEGER) ||
      !Number.isFinite(config.mutationProbability) || config.mutationProbability < 0 || config.mutationProbability > 1 ||
      !Number.isFinite(config.mutationSigma) || config.mutationSigma < 0 || config.mutationSigma > 5 ||
      !integer(config.evolutionSeed, 0, 0xffffffff) || !integer(config.baselineSeed, 0, 0xffffffff)) {
    throw new RangeError('Invalid evolution parameters. Check sizes, probabilities, seeds, and budgets.');
  }
  const all: number[] = [];
  for (const seeds of [config.trainingSeeds, config.validationSeeds, config.testSeeds]) {
    if (!Array.isArray(seeds) || seeds.length < 1 || seeds.length > 100 ||
        seeds.some(seed => !integer(seed, 0, 0xffffffff))) throw new RangeError('Each seed set needs 1–100 uint32 values.');
    all.push(...seeds);
  }
  if (new Set(all).size !== all.length) throw new RangeError('Training, validation, and test seeds must be unique and disjoint.');
  return config;
}
