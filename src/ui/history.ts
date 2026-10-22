import type { GenerationMetrics } from '../evolution/trainer.js';

export function drawHistory(canvas: HTMLCanvasElement, history: GenerationMetrics[]): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const width = 900, height = 220;
  ctx.clearRect(0, 0, width, height);
  ctx.font = '12px monospace'; ctx.fillStyle = '#757575';
  if (!history.length) { ctx.fillText('Complete a generation to plot training-set fitness.', 24, 100); return; }
  const maxX = Math.max(1, history.at(-1)!.environmentSteps);
  const maxY = Math.max(1, ...history.map(row => row.best));
  ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = 175 - i * 37;
    ctx.beginPath(); ctx.moveTo(65, y); ctx.lineTo(870, y); ctx.stroke();
    ctx.fillText((maxY * i / 4).toFixed(0), 8, y + 4);
  }
  for (const [metric, color, dash] of [['best', '#333', []], ['mean', '#777', [7, 3]], ['median', '#aaa', [2, 3]]] as const) {
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([...dash]); ctx.beginPath();
    history.forEach((row, i) => {
      const x = 65 + row.environmentSteps / maxX * 805, y = 175 - row[metric] / maxY * 148;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }); ctx.stroke();
    ctx.setLineDash([]);
    for (const row of history) {
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(65 + row.environmentSteps / maxX * 805, 175 - row[metric] / maxY * 148, 3, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.fillStyle = '#757575'; ctx.fillText('0', 65, 198);
  ctx.fillText(`${maxX.toLocaleString('en-US')} agent steps`, 650, 198);
  ctx.fillText('Best ━    Mean ┄    Median ⋯  ·  Mean episode distance, training seeds', 100, 218);
}
