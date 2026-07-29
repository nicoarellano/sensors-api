"use client";

// Dependency-free multi-series chart for the playground: several seeds of one
// sensor drawn over the same window, with a crosshair for reading exact values.
//
// Discrete sensors are drawn as step lines — `state` and `movement` hold a value
// until they change, and interpolating between "idle" and "error" would be a lie.

import { useMemo, useState } from "react";
import {
  compactNumber,
  shortTime,
  type ManifestEntry,
  type Point,
} from "./seriesQuery";

export interface Series {
  label: string;
  /** A CSS custom property from the validated categorical palette. */
  color: string;
  points: Point[];
}

/** Room for axis labels, and for the direct labels at the right-hand end. */
const PAD = { top: 10, right: 74, bottom: 22, left: 48 };
const VIEW_W = 760;
const Y_TICKS = 5;
const X_TICKS = 6;
/** Minimum vertical gap between two direct labels before they are pushed apart. */
const LABEL_GAP = 13;

function niceTicks(lo: number, hi: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => lo + ((hi - lo) * i) / (count - 1));
}

/**
 * The value band to draw. Discrete sensors get their whole label set so the rows
 * stay put as the data moves; continuous ones get the data plus a little air. A
 * series that never leaves zero still gets a real axis rather than a degenerate
 * one, so "flat at zero" reads as zero rather than as no data.
 */
function valueBand(series: Series[], entry: ManifestEntry): { lo: number; hi: number } {
  if (entry.kind === "enum") return { lo: 0, hi: Math.max(1, (entry.values?.length ?? 2) - 1) };
  if (entry.kind === "binary") return { lo: 0, hi: 1 };
  const values = series.flatMap((s) => s.points.map((p) => p.value));
  if (!values.length) return { lo: 0, hi: 1 };
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (hi - lo < 1e-9) return { lo: Math.min(0, lo), hi: Math.min(0, lo) + 1 };
  const air = (hi - lo) * 0.08;
  // A quantity that never went negative must not get a negative axis: -7 W is
  // not a reading this API can produce, so it has no business on the scale.
  return { lo: lo >= 0 ? Math.max(0, lo - air) : lo - air, hi: hi + air };
}

/** Push overlapping direct labels apart, keeping their order. */
function declutter(entries: { y: number; series: Series; value: number }[]) {
  const sorted = [...entries].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].y - sorted[i - 1].y;
    if (gap < LABEL_GAP) sorted[i].y = sorted[i - 1].y + LABEL_GAP;
  }
  return sorted;
}

export function SeriesChart({
  series,
  entry,
  height = 260,
}: {
  series: Series[];
  entry: ManifestEntry;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const count = series.reduce((n, s) => Math.max(n, s.points.length), 0);
  const plot = {
    x0: PAD.left,
    x1: VIEW_W - PAD.right,
    y0: PAD.top,
    y1: height - PAD.bottom,
  };
  const { lo, hi } = useMemo(() => valueBand(series, entry), [series, entry]);
  const discrete = entry.kind !== "continuous";

  const x = (i: number) =>
    count < 2 ? plot.x0 : plot.x0 + (i / (count - 1)) * (plot.x1 - plot.x0);
  const y = (v: number) =>
    plot.y1 - ((v - lo) / (hi - lo || 1)) * (plot.y1 - plot.y0);

  const paths = useMemo(
    () =>
      series.map((s) => {
        let d = "";
        s.points.forEach((p, i) => {
          const px = x(i).toFixed(1);
          const py = y(p.value).toFixed(1);
          if (i === 0) d += `M${px},${py}`;
          else if (discrete) d += `H${px}V${py}`;
          else d += `L${px},${py}`;
        });
        return d;
      }),
    // x and y are derived from these; recomputing the closures each render is
    // cheaper than memoizing them separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, lo, hi, count, height, discrete],
  );

  const times = series[0]?.points ?? [];
  const at = hover !== null ? times[Math.min(hover, times.length - 1)] : undefined;

  const labelled = declutter(
    series
      .map((s) => {
        const last = s.points[s.points.length - 1];
        return last ? { y: y(last.value), series: s, value: last.value } : null;
      })
      .filter((e): e is { y: number; series: Series; value: number } => e !== null),
  );

  const tickLabel = (v: number) =>
    entry.kind === "enum"
      ? (entry.values?.[Math.round(v)] ?? "")
      : entry.kind === "binary"
        ? v >= 0.5
          ? "true"
          : "false"
        : compactNumber(v);
  const yTickValues = discrete
    ? Array.from({ length: Math.round(hi - lo) + 1 }, (_, i) => lo + i)
    : niceTicks(lo, hi, Y_TICKS);

  if (!count) {
    return (
      <div
        className="flex items-center justify-center text-sm text-foreground/40"
        style={{ height }}
      >
        no data
      </div>
    );
  }

  return (
    <figure className="flex flex-col gap-2 m-0">
      {series.length > 1 && (
        <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground/60">
          {series.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ background: s.color }}
              />
              <span className="font-mono">{s.label}</span>
            </span>
          ))}
        </figcaption>
      )}
      <svg
        viewBox={`0 0 ${VIEW_W} ${height}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={`${entry.type} over time, ${series.length} series, ${count} points each`}
        onMouseLeave={() => setHover(null)}
      >
        {/* Gridlines and value axis */}
        {yTickValues.map((v) => (
          <g key={v}>
            <line
              x1={plot.x0}
              x2={plot.x1}
              y1={y(v)}
              y2={y(v)}
              stroke="var(--chart-grid)"
              strokeWidth={1}
            />
            <text
              x={plot.x0 - 6}
              y={y(v)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={10}
              fill="var(--chart-muted)"
              className="tabular-nums"
            >
              {tickLabel(v)}
            </text>
          </g>
        ))}

        {/* Time axis */}
        <line
          x1={plot.x0}
          x2={plot.x1}
          y1={plot.y1}
          y2={plot.y1}
          stroke="var(--chart-axis)"
          strokeWidth={1}
        />
        {Array.from({ length: X_TICKS }, (_, i) =>
          Math.round((i * (count - 1)) / (X_TICKS - 1)),
        ).map((i, n) => (
          <text
            key={i}
            x={x(i)}
            y={height - 6}
            textAnchor={n === 0 ? "start" : n === X_TICKS - 1 ? "end" : "middle"}
            fontSize={10}
            fill="var(--chart-muted)"
            className="tabular-nums"
          >
            {shortTime(times[i]?.time ?? "")}
          </text>
        ))}

        {/* Series */}
        {paths.map((d, i) => (
          <path
            key={series[i].label}
            d={d}
            fill="none"
            stroke={series[i].color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {/* Direct labels: identity without relying on colour alone. */}
        {labelled.map((e) => (
          <g key={e.series.label}>
            <circle cx={plot.x1 + 5} cy={e.y} r={3} fill={e.series.color} />
            <text
              x={plot.x1 + 12}
              y={e.y}
              dominantBaseline="middle"
              fontSize={10}
              fill="var(--chart-muted)"
              className="tabular-nums"
            >
              {e.series.label}
            </text>
          </g>
        ))}

        {/* Crosshair */}
        {hover !== null && (
          <g>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={plot.y0}
              y2={plot.y1}
              stroke="var(--chart-axis)"
              strokeWidth={1}
            />
            {series.map((s) => {
              const p = s.points[hover];
              if (!p) return null;
              return (
                <circle
                  key={s.label}
                  cx={x(hover)}
                  cy={y(p.value)}
                  r={4}
                  fill={s.color}
                  stroke="var(--chart-surface)"
                  strokeWidth={2}
                />
              );
            })}
          </g>
        )}

        <rect
          x={plot.x0}
          y={plot.y0}
          width={plot.x1 - plot.x0}
          height={plot.y1 - plot.y0}
          fill="transparent"
          onMouseMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            const ratio = (event.clientX - box.left) / box.width;
            setHover(Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1)))));
          }}
        />
      </svg>

      {/* Read-out below the plot rather than a floating box: it never covers the
          data, and it is the same numbers a tooltip would carry. */}
      <div className="min-h-[1.5rem] flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono tabular-nums text-foreground/60">
        {at ? (
          <>
            <span className="text-foreground/80">{at.time}</span>
            {series.map((s) => {
              const p = s.points[hover ?? 0];
              if (!p) return null;
              return (
                <span key={s.label} className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ background: s.color }}
                  />
                  {s.label} {tickLabel(p.value)}
                  {entry.kind === "continuous" ? ` ${entry.unit}` : ""}
                </span>
              );
            })}
          </>
        ) : (
          <span className="text-foreground/40">
            hover the chart to read exact values
          </span>
        )}
      </div>
    </figure>
  );
}
