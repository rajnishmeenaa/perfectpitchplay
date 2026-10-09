/**
 * Sapna11 brand mark — vector, not a raster logo.
 *
 * The geometry mirrors the launcher icon shipped in the Android shell (public/
 * brand/appicon-*.png): a brand-red tile, a heavy white "S" carrying a cricket
 * ball seam, and a translucent "11" sitting behind it. Drawing it from the same
 * tokens as the rest of the system keeps it sharp at any density and lets it
 * re-tint with the palette; the PNG icons exist only where a raster is required.
 */
import { TURF } from "./tokens";

export function TurfMark({ size = 34, rounded = 28, className = "", testid = "turf-mark", glow = false }) {
  return (
    <svg
      viewBox="0 0 128 128"
      width={size}
      height={size}
      role="img"
      aria-label="Sapna11"
      data-testid={testid}
      className={className}
      style={glow ? { filter: `drop-shadow(0 0 10px ${TURF.red}66)` } : undefined}
    >
      <defs>
        <linearGradient id="sapnaTile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FF3B44" />
          <stop offset="0.55" stopColor={TURF.red} />
          <stop offset="1" stopColor={TURF.redDeep} />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="126" height="126" rx={rounded} fill="url(#sapnaTile)" stroke="rgba(0,0,0,0.18)" strokeWidth="2" />

      {/* Translucent "11" behind the letterform — two condensed strokes with flags. */}
      <g fill="#FFFFFF" opacity="0.17">
        <path d="M22 34 L34 28 L34 92 L22 92 Z" />
        <path d="M46 34 L58 28 L58 92 L46 92 Z" />
      </g>

      {/* The "S". */}
      <path
        d="M96 47 C88 38 68 38 63 52 C58 66 79 69 84 77 C89 86 72 94 58 87"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="14"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Ball seam stitched across the lower bowl. */}
      <path
        d="M62 72 C72 84 90 82 99 68"
        fill="none"
        stroke={TURF.redDeep}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray="0.5 11"
      />
    </svg>
  );
}

/** Wordmark: "SAPNA" in ink, the "11" in brand red. */
export function TurfWordmark({ size = "text-xl", accent = "Sapna", rest = "11", className = "" }) {
  return (
    <span className={`font-display font-extrabold uppercase tracking-tight ${size} ${className}`} data-testid="turf-wordmark">
      <span className="text-zinc-950">{accent}</span>
      <span className="text-turf">{rest}</span>
    </span>
  );
}

/** Logo lockup = mark + wordmark. */
export function TurfLogo({ mark = 34, size = "text-xl", className = "", testid = "turf-logo" }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`} data-testid={testid}>
      <TurfMark size={mark} />
      <TurfWordmark size={size} />
    </span>
  );
}
