/**
 * Turf design tokens — the single source of truth shared by the web build, the
 * Capacitor Android shell and (later) iOS. Components must read colours, role
 * skins and sport metadata from here instead of hard-coding values, so a brand
 * change lands in one place on every platform.
 *
 * The same values exist as Tailwind tokens in tailwind.config.js (turf / ink /
 * neon / trophy). This module exists for the cases where JS needs the raw value:
 * SVG fills, native splash bars, push-notification accents and canvas draws.
 */

export const TURF = {
  // Brand
  red: "#ED1B24",
  redDark: "#C6121A",
  redDeep: "#8E0C12",
  fire: "#FF4B52",
  ember: "#FF8A8F",
  // Surfaces
  ink: "#0A0C11",
  inkSoft: "#0E1117",
  inkCard: "#12151C",
  inkLine: "#272E3A",
  inkMuted: "#93A0B0",
  // Status
  neon: "#2BF57C",
  neonBright: "#6BFFA8",
  neonDeep: "#0B7A43",
  trophy: "#F2B632",
  trophyLight: "#FFD35C",
  trophyDark: "#B97F14",
};

/** Colour the OS chrome with (status bar, notification accent). */
export const PLATFORM_ACCENT = TURF.red;

/**
 * Sports the shell is built to carry. Only cricket has a rules and points engine
 * today; the others are listed so the strip, the tiles and the empty states are
 * already on-system when a second sport lands, rather than a bespoke screen each time.
 */
export const SPORTS = [
  { id: "cricket", label: "Cricket", icon: "Baseball", live: true },
  { id: "football", label: "Football", icon: "SoccerBall", live: false },
  { id: "kabaddi", label: "Kabaddi", icon: "Target", live: false },
  { id: "basketball", label: "Basketball", icon: "Basketball", live: false },
];

/** Fantasy roles, with the pitch position the builder lays out. */
export const ROLES = {
  WK: { short: "WK", label: "Wicket-keeper", order: 0, line: 3, skin: "violet" },
  BAT: { short: "BAT", label: "Batter", order: 1, line: 2, skin: "sky" },
  AR: { short: "AR", label: "All-rounder", order: 2, line: 1, skin: "trophy" },
  BOWL: { short: "BOWL", label: "Bowler", order: 3, line: 0, skin: "neon" },
};

export const ROLE_ORDER = ["WK", "BAT", "AR", "BOWL"];

/** Soft badge skins. Class strings, so they ride the charcoal tints in index.css. */
export const SKIN = {
  violet: "bg-violet-100 text-violet-800 border-violet-200",
  sky: "bg-sky-100 text-sky-800 border-sky-200",
  trophy: "bg-amber-100 text-amber-800 border-amber-200",
  neon: "bg-emerald-100 text-emerald-800 border-emerald-200",
  brand: "bg-red-100 text-red-800 border-red-200",
  neutral: "bg-zinc-200 text-zinc-700 border-zinc-300",
};

/** Match / contest status language shared by every board and tile. */
export const STATUS_SKIN = {
  upcoming: { label: "Upcoming", skin: "neon", tone: "is-neon" },
  live: { label: "Live", skin: "brand", tone: "" },
  started: { label: "Started", skin: "brand", tone: "" },
  completed: { label: "Completed", skin: "neutral", tone: "" },
  settled: { label: "Settled", skin: "trophy", tone: "is-trophy" },
  abandoned: { label: "Abandoned", skin: "neutral", tone: "" },
  open: { label: "Open", skin: "neon", tone: "is-neon" },
  closed: { label: "Closed", skin: "neutral", tone: "" },
};

export const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

/** Compact Indian money for prize pools: 1.5L, 25Cr. */
export function shortMoney(n) {
  const v = Number(n || 0);
  if (!Number.isFinite(v) || v <= 0) return money(0);
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(v % 10000000 ? 1 : 0)}Cr`;
  if (v >= 100000) return `₹${(v / 100000).toFixed(v % 100000 ? 1 : 0)}L`;
  if (v >= 1000) return `₹${(v / 1000).toFixed(v % 1000 ? 1 : 0)}K`;
  return money(v);
}

/** Countdown split into scoreboard cells: {d,h,m,s,urgent,over}. */
export function countdownParts(iso, now = Date.now()) {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - now;
  if (Number.isNaN(diff)) return null;
  if (diff <= 0) return { over: true, urgent: false, d: 0, h: 0, m: 0, s: 0 };
  const pad = (n) => String(n).padStart(2, "0");
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return { over: false, urgent: diff < 3600000, d, h, m, s, pad, text: d > 0 ? `${d}d ${pad(h)}h ${pad(m)}m` : `${pad(h)}:${pad(m)}:${pad(s)}` };
}
