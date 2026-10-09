/**
 * Turf brand mark — vector, not a raster logo.
 *
 * Drawing the mark from the same tokens as the rest of the system means it
 * re-tints with the brand, stays sharp on any display density, and needs no
 * image assets in the Android / iOS shells. The identical geometry is exported
 * as public/brand/turf-mark.svg for the favicon and native app icons.
 */
import { TURF } from "./tokens";

export function TurfMark({ size = 34, rounded = 28, className = "", testid = "turf-mark", glow = false }) {
  return (
    <svg
      viewBox="0 0 128 128"
      width={size}
      height={size}
      role="img"
      aria-label="PitchPlay"
      data-testid={testid}
      className={className}
      style={glow ? { filter: `drop-shadow(0 0 10px ${TURF.red}66)` } : undefined}
    >
      <defs>
        <linearGradient id="turfTile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={TURF.airRaised} />
          <stop offset="1" stopColor={TURF.air} />
        </linearGradient>
        <linearGradient id="turfBall" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={TURF.fire} />
          <stop offset="0.55" stopColor={TURF.red} />
          <stop offset="1" stopColor={TURF.redDeep} />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="126" height="126" rx={rounded} fill="url(#turfTile)" stroke={TURF.airLine} strokeWidth="2" />
      <path d="M18 98 L52 64" stroke={TURF.neonAir} strokeWidth="7" strokeLinecap="round" opacity="0.9" />
      <path d="M26 108 L64 70" stroke={TURF.neonAir} strokeWidth="4" strokeLinecap="round" opacity="0.45" />
      <circle cx="80" cy="50" r="29" fill="url(#turfBall)" />
      <path d="M63 32 C73 44 73 56 65 68" stroke={TURF.air} strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M98 32 C88 44 88 56 96 68" stroke={TURF.air} strokeWidth="4" fill="none" strokeLinecap="round" />
      <rect x="20" y="112" width="88" height="5" rx="2.5" fill={TURF.red} opacity="0.9" />
    </svg>
  );
}

/** Wordmark: the condensed Turf lockup used in headers and the landing page. */
export function TurfWordmark({ size = "text-xl", accent = "Pitch", rest = "Play", className = "" }) {
  return (
    <span className={`font-heading font-extrabold uppercase tracking-tight ${size} ${className}`} data-testid="turf-wordmark">
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
