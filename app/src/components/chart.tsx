import { useEffect, useMemo, useRef, useState } from "react";

/**
 * A line chart drawn to one scale, in the app's own tokens. Each series is a run of points on the
 * same x buckets. A faint grid, y labels that name real values, dates along the bottom, the latest
 * point emphasised, and a crosshair with every series' value under the pointer. No library: the
 * charts here are lines over a few hundred buckets at most, and the bundle is big enough already.
 */
export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  points: { t: string; v: number }[];
  /** The whole that the other series are parts of: drawn wider and quieter, under them. */
  whole?: boolean;
}

const PAD = { top: 16, right: 16, bottom: 34, left: 48 };

/** The drawing is laid out in the container's own pixels, measured, so text and strokes never stretch. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    setWidth(Math.max(240, Math.round(el.getBoundingClientRect().width)));
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Round ticks: 1, 2, 5 × 10^n, so a y axis never reads 0, 23.7, 47.4. */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.999; v += step) ticks.push(v);
  return ticks;
}

function fmtDate(t: string): string {
  const d = new Date(`${t}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

export function LineChart({ series, height = 280, emptyText = "Nothing in this window." }: { series: ChartSeries[]; height?: number; emptyText?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [box, W] = useWidth<HTMLDivElement>();
  const H = height;
  const n = series[0]?.points.length ?? 0;
  const max = useMemo(() => Math.max(0, ...series.flatMap((s) => s.points.map((p) => p.v))), [series]);
  const ticks = useMemo(() => niceTicks(max), [max]);
  const top = ticks[ticks.length - 1] || 1;
  const x = (i: number) => PAD.left + (n <= 1 ? (W - PAD.left - PAD.right) / 2 : (i * (W - PAD.left - PAD.right)) / (n - 1));
  const y = (v: number) => PAD.top + (1 - v / top) * (H - PAD.top - PAD.bottom);
  const path = (pts: { v: number }[]) => pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(W / 110))));
  const dates = series[0]?.points ?? [];

  if (n === 0 || max === 0) {
    return <div className="chart-empty" style={{ height }}>{emptyText}</div>;
  }

  return (
    <div className="chart" style={{ height }} ref={box}>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={series.map((s) => `${s.label}: ${s.points.reduce((a, p) => a + p.v, 0)} across the window`).join(". ")}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          const i = Math.round(((px - PAD.left) / (W - PAD.left - PAD.right)) * (n - 1));
          setHover(Math.max(0, Math.min(n - 1, i)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="chart-grid" />
            <text x={PAD.left - 8} y={y(v)} className="chart-label" textAnchor="end" dominantBaseline="middle">{v.toLocaleString()}</text>
          </g>
        ))}
        {dates.map((p, i) => (i % labelEvery === 0 || i === n - 1) && (
          <text key={p.t} x={x(i)} y={H - 10} className="chart-label" textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>{fmtDate(p.t)}</text>
        ))}
        {series.map((s) => (
          <g key={s.key}>
            {/* The whole draws first, wider and quieter, so its parts sit over it and it still shows where they coincide. */}
            <path d={path(s.points)} fill="none" stroke={s.color} strokeWidth={s.whole ? 3.5 : 2} strokeOpacity={s.whole && series.length > 1 ? 0.55 : 1} strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={x(n - 1)} cy={y(s.points[n - 1].v)} r={4} fill={s.color} />
          </g>
        ))}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} className="chart-cursor" />
            {series.map((s) => <circle key={s.key} cx={x(hover)} cy={y(s.points[hover].v)} r={5} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} />)}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <div className="chart-tip-date">{fmtDate(dates[hover].t)}</div>
          {series.map((s) => (
            <div key={s.key} className="chart-tip-row"><span className="chart-swatch" style={{ background: s.color }} />{s.label}<b className="num">{s.points[hover].v.toLocaleString()}</b></div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChartLegend({ series }: { series: ChartSeries[] }) {
  return (
    <div className="row wrap chart-legend">
      {series.map((s) => (
        <span key={s.key} className="row chart-legend-item"><span className="chart-swatch" style={{ background: s.color }} />{s.label}</span>
      ))}
    </div>
  );
}
