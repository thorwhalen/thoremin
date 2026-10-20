/**
 * Bar charts drawn at build time from the CSVs under `docs/research/data`, as inline
 * SVG (no chart library, no script on the page). A chart is data in `guide.json`
 * (`csv`, `filter`, `groupBy`, `value`, `agg`), so a new measurement table earns a
 * figure by adding one record.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './config';
import type { Chart } from './schema';

/** A minimal CSV reader: comma separated, no quoted commas (what the measurement scripts write). */
export function parseCsv(text: string): Array<Record<string, string>> {
  const [head, ...rows] = text.trim().split(/\r?\n/);
  const cols = head.split(',');
  return rows.map((r) => Object.fromEntries(r.split(',').map((v, i) => [cols[i], v])));
}

export function aggregate(rows: Array<Record<string, string>>, chart: Chart): Array<{ key: string; value: number }> {
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    if (chart.filter && Object.entries(chart.filter).some(([k, v]) => row[k] !== v)) continue;
    const v = Number(row[chart.value]);
    if (!Number.isFinite(v)) continue;
    const key = row[chart.groupBy];
    groups.set(key, [...(groups.get(key) ?? []), v]);
  }
  const agg = (vs: number[]) =>
    chart.agg === 'max' ? Math.max(...vs) : chart.agg === 'min' ? Math.min(...vs) : vs.reduce((a, b) => a + b, 0) / vs.length;
  return [...groups].map(([key, vs]) => ({ key, value: agg(vs) })).sort((a, b) => b.value - a.value);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** Horizontal bars, labels left, values right; colours come from the page's CSS tokens. */
export function barSvg(bars: Array<{ key: string; value: number }>, { label }: { label: string }): string {
  const rowH = 20, labelW = 150, barW = 220, valueW = 50, top = 8;
  const max = Math.max(...bars.map((b) => b.value), 1e-9);
  const h = top + bars.length * rowH + 22;
  const rows = bars.map((b, i) => {
    const y = top + i * rowH;
    const w = Math.max(1, (b.value / max) * barW);
    return `<text x="${labelW - 6}" y="${y + 14}" text-anchor="end" class="ch-label">${esc(b.key)}</text>`
      + `<rect x="${labelW}" y="${y + 3}" width="${w.toFixed(1)}" height="${rowH - 6}" rx="3" class="ch-bar${i === 0 ? ' ch-top' : ''}"/>`
      + `<text x="${labelW + w + 6}" y="${y + 14}" class="ch-value">${b.value.toFixed(2)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${labelW + barW + valueW + 10} ${h}" role="img" aria-label="${esc(label)}" class="chart">${rows}`
    + `<text x="${labelW}" y="${h - 4}" class="ch-axis">${esc(label)}</text></svg>`;
}

export function renderChart(chart: Chart): string {
  const rows = parseCsv(readFileSync(join(REPO_ROOT, chart.csv), 'utf8'));
  return barSvg(aggregate(rows, chart), { label: `${chart.agg} ${chart.value} by ${chart.groupBy}` });
}
