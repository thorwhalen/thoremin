/**
 * Bar charts drawn at build time as inline SVG (no chart library, no script on the
 * page): from a doc's own numbers (`data`) or from a CSV under `docs/research/data`
 * (`csv`, `filter`, `groupBy`, `value`, `agg`), and an experiment's headline number
 * against its baseline and threshold. A chart is one record in `guide.json`, so a new
 * measurement earns a figure without code.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './config';
import type { Chart, Measure } from './schema';

/** A minimal CSV reader: comma separated, no quoted commas (what the measurement scripts write). */
export function parseCsv(text: string): Array<Record<string, string>> {
  const [head, ...rows] = text.trim().split(/\r?\n/);
  const cols = head.split(',');
  return rows.map((r) => Object.fromEntries(r.split(',').map((v, i) => [cols[i], v])));
}

export function aggregate(rows: Array<Record<string, string>>, chart: Pick<Chart, 'filter' | 'value' | 'groupBy' | 'agg'>): Array<{ key: string; value: number }> {
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    if (chart.filter && Object.entries(chart.filter).some(([k, v]) => row[k] !== v)) continue;
    const v = Number(row[chart.value!]);
    if (!Number.isFinite(v)) continue;
    const key = row[chart.groupBy!];
    groups.set(key, [...(groups.get(key) ?? []), v]);
  }
  const agg = (vs: number[]) =>
    chart.agg === 'max' ? Math.max(...vs) : chart.agg === 'min' ? Math.min(...vs) : vs.reduce((a, b) => a + b, 0) / vs.length;
  return [...groups].map(([key, vs]) => ({ key, value: agg(vs) })).sort((a, b) => b.value - a.value);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2).replace(/\.?0+$/, '') || '0');

/**
 * Horizontal bars, labels left, values right, an optional reference line; colours come
 * from the page's CSS tokens. Bars are magnitudes; the value text keeps the sign.
 */
export function barSvg(
  bars: Array<{ key: string; value: number; tone?: string }>,
  { label, unit = '', threshold }: { label: string; unit?: string; threshold?: { value: number; label: string } },
): string {
  const rowH = 20, labelW = 150, barW = 220, valueW = 60, top = 8;
  const max = Math.max(...bars.map((b) => Math.abs(b.value)), threshold ? Math.abs(threshold.value) : 0, 1e-9);
  const h = top + bars.length * rowH + (threshold ? 36 : 22);
  const rows = bars.map((b, i) => {
    const y = top + i * rowH;
    const w = Math.max(1, (Math.abs(b.value) / max) * barW);
    const cls = b.tone ?? (i === 0 ? 'ch-top' : '');
    return `<text x="${labelW - 6}" y="${y + 14}" text-anchor="end" class="ch-label">${esc(b.key.length > 24 ? `${b.key.slice(0, 23)}…` : b.key)}<title>${esc(b.key)}</title></text>`
      + `<rect x="${labelW}" y="${y + 3}" width="${w.toFixed(1)}" height="${rowH - 6}" rx="3" class="ch-bar ${cls}"/>`
      + `<text x="${labelW + w + 6}" y="${y + 14}" class="ch-value">${fmt(b.value)}${esc(unit ? ` ${unit}` : '')}</text>`;
  }).join('');
  const ref = threshold
    ? (() => {
      const x = labelW + (Math.abs(threshold.value) / max) * barW;
      const y2 = top + bars.length * rowH;
      return `<line x1="${x.toFixed(1)}" y1="${top}" x2="${x.toFixed(1)}" y2="${y2}" class="ch-ref"/>`
        + `<text x="${Math.min(x, labelW + barW - 10).toFixed(1)}" y="${y2 + 12}" text-anchor="middle" class="ch-axis">${esc(`${threshold.label} (${fmt(threshold.value)}${unit ? ` ${unit}` : ''})`)}</text>`;
    })()
    : '';
  return `<svg viewBox="0 0 ${labelW + barW + valueW + 10} ${h}" role="img" aria-label="${esc(label)}" class="chart">${rows}${ref}`
    + `<text x="${labelW}" y="${h - 4}" class="ch-axis">${esc(label)}</text></svg>`;
}

export function renderChart(chart: Chart): string {
  if (chart.data?.length) {
    return barSvg(chart.data.map((d) => ({ key: d.key, value: d.value })), { label: chart.title, unit: chart.unit, threshold: chart.threshold });
  }
  const rows = parseCsv(readFileSync(join(REPO_ROOT, chart.csv!), 'utf8'));
  return barSvg(aggregate(rows, chart), { label: `${chart.agg} ${chart.value} by ${chart.groupBy}`, unit: chart.unit, threshold: chart.threshold });
}

/** An experiment's number as a small chart: the result, its baseline, and the bar it had to clear. */
export function measureSvg(m: Measure): string {
  const passed = m.threshold
    ? (m.better === 'higher' ? m.value >= m.threshold.value : m.value <= m.threshold.value)
    : m.baseline ? (m.better === 'higher' ? m.value >= m.baseline.value : m.value <= m.baseline.value) : undefined;
  const bars = [
    { key: m.label, value: m.value, tone: passed === undefined ? 'ch-top' : passed ? 'ch-pass' : 'ch-fail' },
    ...(m.baseline ? [{ key: m.baseline.label, value: m.baseline.value, tone: 'ch-base' }] : []),
  ];
  return barSvg(bars, { label: `${m.better} is better`, unit: m.unit, threshold: m.threshold });
}
