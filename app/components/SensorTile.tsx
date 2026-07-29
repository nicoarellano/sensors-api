"use client";

// One sensor as a tile: its latest value and the shape of the window behind it.
// Every type gets one, so a bad curve is visible without opening anything.

import { useMemo } from "react";
import { formatValue, type ManifestEntry, type Point } from "./seriesQuery";

const W = 240;
const H = 52;

/** Area sparkline over parsed points; step-shaped for discrete sensors. */
function Sparkline({ points, step }: { points: Point[]; step: boolean }) {
  const { line, area } = useMemo(() => {
    if (points.length < 2) return { line: "", area: "" };
    const values = points.map((p) => p.value);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    // A flat series is drawn on the floor of its own band, not through the
    // middle of it: a sensor sitting at zero should look like it.
    const span = hi - lo || Math.max(Math.abs(hi), 1);
    const x = (i: number) => (i / (points.length - 1)) * W;
    const y = (v: number) => H - 3 - ((v - lo) / span) * (H - 6);
    let d = "";
    points.forEach((p, i) => {
      const px = x(i).toFixed(1);
      const py = y(p.value).toFixed(1);
      if (i === 0) d += `M${px},${py}`;
      else if (step) d += `H${px}V${py}`;
      else d += `L${px},${py}`;
    });
    return { line: d, area: `${d} L${W},${H} L0,${H} Z` };
  }, [points, step]);

  if (!line) return <div style={{ height: H }} />;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height: H }}
      aria-hidden
    >
      <path d={area} fill="var(--series-1)" fillOpacity={0.12} />
      <path d={line} fill="none" stroke="var(--series-1)" strokeWidth={1.5} />
    </svg>
  );
}

export function SensorTile({
  entry,
  points,
  error,
  focused,
  onFocus,
}: {
  entry: ManifestEntry;
  points: Point[];
  error: string | null;
  focused: boolean;
  onFocus: () => void;
}) {
  const last = points[points.length - 1];

  return (
    <button
      type="button"
      onClick={onFocus}
      aria-pressed={focused}
      className={`text-left rounded-lg border p-3 flex flex-col gap-1.5 transition-colors ${
        focused
          ? "border-blue-600 dark:border-blue-400"
          : "border-black/10 dark:border-white/15 hover:border-black/25 dark:hover:border-white/30"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-mono text-xs text-foreground/70 truncate">{entry.type}</h3>
        <span className="text-[10px] text-foreground/40 shrink-0">
          {error ? "error" : points.length ? `${points.length} pts` : "…"}
        </span>
      </div>
      <div className="font-mono text-xl tabular-nums truncate">
        {error ? (
          <span className="text-xs text-red-600 dark:text-red-400 font-sans">{error}</span>
        ) : last ? (
          <>
            {formatValue(last.value, entry)}
            {entry.kind === "continuous" && (
              <span className="text-xs text-foreground/50 ml-1">{entry.unit}</span>
            )}
          </>
        ) : (
          <span className="text-foreground/30">…</span>
        )}
      </div>
      <Sparkline points={points} step={entry.kind !== "continuous"} />
    </button>
  );
}
