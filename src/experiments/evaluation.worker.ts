import { evaluateSuite } from './evaluation.js';

self.onmessage = event => {
  try {
    const { split, policyId, seeds, baselineSeed, genome } = event.data;
    self.postMessage({ report: evaluateSuite(split, policyId, seeds, baselineSeed, genome) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
