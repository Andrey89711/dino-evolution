import { ACTIONS, connections } from '../ai/network.js';
import { INPUT_LABELS } from '../ai/observation.js';
import type { Individual } from '../evolution/trainer.js';

interface Point { x: number; y: number }
const point = (layer: number, index: number, width: number, height: number, miniature: boolean): Point => {
  const sizes = [11, 8, 3];
  return {
    x: miniature ? 12 + layer * (width - 24) / 2 : [230, 475, 710][layer]!,
    y: miniature ? 9 + index * (height - 18) / (sizes[layer]! - 1) :
      layer === 0 ? 33 + index * 36 : layer === 1 ? 68 + index * 42 : 115 + index * 100,
  };
};

export function drawBrain(canvas: HTMLCanvasElement, individual: Individual, miniature = false): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const width = miniature ? 136 : 900;
  const height = miniature ? 78 : 430;
  ctx.clearRect(0, 0, width, height);
  const trace = individual.trace;
  if (!trace) {
    ctx.fillStyle = '#757575';
    ctx.font = miniature ? '10px monospace' : '14px monospace';
    ctx.fillText('Awaiting first decision', miniature ? 0 : 25, height / 2);
    return;
  }
  for (const link of connections(individual.genome)) {
    const from = point(link.layer, link.from, width, height, miniature);
    const to = point(link.layer + 1, link.to, width, height, miniature);
    ctx.strokeStyle = miniature ? '#ddd' : '#bbb';
    ctx.lineWidth = miniature ? 0.4 : 0.3 + Math.min(3, Math.abs(link.weight)) * 0.8;
    ctx.setLineDash(link.weight < 0 ? miniature ? [1, 2] : [4, 4] : []);
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
  }
  ctx.setLineDash([]);
  const layers = [trace.inputs, trace.hidden, trace.outputs];
  layers.forEach((values, layer) => values.forEach((value, index) => {
    const p = point(layer, index, width, height, miniature);
    const activation = layer === 0 ? (index === 2 || index === 6 ? (value + 1) / 2 : value) :
      layer === 1 ? (value + 1) / 2 : (Math.tanh(value) + 1) / 2;
    const shade = Math.round(35 + 200 * activation);
    ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
    ctx.strokeStyle = '#535353'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p.x, p.y, miniature ? 2.7 : 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (!miniature) {
      ctx.fillStyle = '#535353'; ctx.font = '12px monospace';
      if (layer === 0) {
        ctx.fillText(INPUT_LABELS[index]!, 10, p.y + 4);
        ctx.fillText(value.toFixed(3), 165, p.y + 4);
      } else {
        ctx.fillText(layer === 2 ? `${ACTIONS[index]}  ${value.toFixed(3)}` : `h${index + 1} ${value.toFixed(3)}`, p.x + 18, p.y + 4);
      }
    }
    if (layer === 2 && ACTIONS[index] === trace.action) {
      ctx.strokeStyle = '#222'; ctx.lineWidth = 2;
      ctx.strokeRect(p.x - (miniature ? 5 : 15), p.y - (miniature ? 5 : 16), miniature ? 10 : 165, miniature ? 10 : 32);
    }
  }));
}

export function brainTooltip(individual: Individual, x: number, y: number): string {
  const trace = individual.trace;
  if (!trace) return 'No decision has been computed yet.';
  for (const [layer, values] of [trace.inputs, trace.hidden, trace.outputs].entries()) {
    for (let i = 0; i < values.length; i++) {
      const p = point(layer, i, 900, 430, false);
      if (Math.hypot(x - p.x, y - p.y) < 15) {
        const label = layer === 0 ? INPUT_LABELS[i] : layer === 1 ? `Hidden ${i + 1}` : ACTIONS[i];
        const bias = layer === 0 ? '' : ` · bias ${individual.genome[(layer === 1 ? 88 : 120) + i]!.toFixed(6)}`;
        return `${label}: ${values[i]!.toFixed(6)}${bias}`;
      }
    }
  }
  let nearest = Infinity;
  let description = 'Hover a neuron or a connection for its value.';
  for (const link of connections(individual.genome)) {
    const a = point(link.layer, link.from, 900, 430, false);
    const b = point(link.layer + 1, link.to, 900, 430, false);
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
    const distance = Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
    if (distance < 5 && distance < nearest) {
      nearest = distance;
      description = `${link.layer === 0 ? INPUT_LABELS[link.from] : `Hidden ${link.from + 1}`} → ${link.layer === 0 ? `Hidden ${link.to + 1}` : ACTIONS[link.to]}: weight ${link.weight.toFixed(6)}`;
    }
  }
  return description;
}

export function weightTable(individual: Individual): string {
  const rows = connections(individual.genome).map(link => `<tr><td>${link.layer === 0 ? `Input ${link.from + 1}` : `Hidden ${link.from + 1}`}</td><td>${link.layer === 0 ? `Hidden ${link.to + 1}` : ACTIONS[link.to]}</td><td>${link.weight.toFixed(6)}</td></tr>`);
  for (let i = 0; i < 8; i++) rows.push(`<tr><td>Bias</td><td>Hidden ${i + 1}</td><td>${individual.genome[88 + i]!.toFixed(6)}</td></tr>`);
  for (let i = 0; i < 3; i++) rows.push(`<tr><td>Bias</td><td>${ACTIONS[i]}</td><td>${individual.genome[120 + i]!.toFixed(6)}</td></tr>`);
  return `<table><thead><tr><th>From</th><th>To</th><th>Weight / bias</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}
