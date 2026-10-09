/**
 * Turf ATOMS — the smallest reusable pieces. Nothing here knows about contests,
 * matches or users; they take props and render Turf styling. Every molecule and
 * organism is built from these, which is what keeps iOS / Android / web identical.
 */
import { countdownParts, SKIN, STATUS_SKIN, TURF } from "./tokens";
import { useEffect, useState } from "react";

/** White card with an optional brand edge. */
export function TurfCard({ children, className = "", edge = "", as: Tag = "div", testid, ...rest }) {
  const tone = edge ? `turf-flag ${edge === "brand" ? "" : `is-${edge}`}` : "";
  return (
    <Tag className={`turf-card ${tone} ${className}`} data-testid={testid} {...rest}>
      {children}
    </Tag>
  );
}

/** Condensed uppercase eyebrow label used above sections, stats and rows. */
export function TurfEyebrow({ children, className = "", testid }) {
  return <div className={`turf-eyebrow ${className}`} data-testid={testid}>{children}</div>;
}

/** Section header: eyebrow + title + optional right-hand action. */
export function TurfSection({ title, hint, action, children, className = "", testid = "turf-section" }) {
  return (
    <section className={`mt-6 ${className}`} data-testid={testid}>
      <div className="flex items-end justify-between gap-3 mb-2.5">
        <div className="min-w-0">
          <TurfEyebrow>{title}</TurfEyebrow>
          {hint && <p className="text-[12px] text-zinc-500 mt-0.5 truncate">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Small status chip. skin is a token name from SKIN, not a class string. */
export function TurfChip({ children, skin = "neutral", className = "", testid, title }) {
  return (
    <span
      title={title}
      data-testid={testid}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${SKIN[skin] || SKIN.neutral} ${className}`}
    >
      {children}
    </span>
  );
}

export function TurfStatusChip({ status, testid }) {
  const cfg = STATUS_SKIN[status] || { label: status || "—", skin: "neutral" };
  return <TurfChip skin={cfg.skin} testid={testid}>{cfg.label}</TurfChip>;
}

/** Pill used for filters, counts and money callouts. */
export function TurfPill({ children, active = false, onClick, className = "", testid, disabled }) {
  const base = "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold transition-colors";
  if (!onClick) {
    return (
      <span data-testid={testid} className={`${base} bg-turf/15 border border-turf/40 text-turf ${className}`}>{children}</span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testid}
      data-active={active ? "true" : "false"}
      className={`${base} border disabled:opacity-45 ${
        active ? "bg-turf text-white border-turf shadow-glow-turf" : "bg-ink-card text-zinc-500 border-ink-line hover:border-turf/50 hover:text-zinc-900"
      } ${className}`}
    >
      {children}
    </button>
  );
}

/** Brand CTA. Prefer this over a raw button inside Turf molecules. */
export function TurfButton({ children, onClick, variant = "cta", size = "md", disabled, className = "", testid, type = "button" }) {
  const sizes = { sm: "px-3 py-1.5 text-[12px]", md: "px-4 py-2.5 text-[13px]", lg: "w-full px-5 py-3 text-[15px]" };
  const skins = { cta: "turf-cta", ghost: "turf-ghost", neon: "turf-join" };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      data-testid={testid}
      className={`rounded-full active:scale-95 transition-transform inline-flex items-center justify-center gap-1.5 ${sizes[size]} ${skins[variant] || skins.cta} ${className}`}
    >
      {children}
    </button>
  );
}

/** Pulsing dot + label for a live match. */
export function TurfLiveDot({ label = "LIVE", testid = "turf-live-dot" }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-widest text-turf" data-testid={testid}>
      <span className="relative grid place-items-center w-2 h-2">
        <span className="absolute inset-0 rounded-full bg-turf animate-blip" style={{ backgroundColor: TURF.red }} />
        <span className="w-2 h-2 rounded-full bg-turf" />
      </span>
      {label}
    </span>
  );
}

/**
 * Scoreboard numerals. A value that starts with the rupee sign picks up the
 * money treatment (small ₹, big amount) automatically, so every prize figure in
 * the app is set the same way without the screens having to ask for it.
 */
export function TurfNum({ children, className = "", testid, tone = "" }) {
  const tones = { brand: "text-turf", neon: "text-neon", trophy: "text-trophy-dark", muted: "text-zinc-500" };
  const isMoney = typeof children === "string" && children.trim().startsWith("₹");
  return (
    <span className={`turf-num ${isMoney ? "turf-money" : ""} ${tones[tone] || "text-zinc-950"} ${className}`} data-testid={testid}>
      {children}
    </span>
  );
}

/** One label over one value, the unit every stats row in the app uses. */
export function TurfStat({ label, value, tone = "", hint, className = "", testid }) {
  return (
    <div className={`rounded-lg border border-ink-line bg-ink-soft px-2.5 py-2 text-center ${className}`} data-testid={testid}>
      <TurfEyebrow className="justify-center">{label}</TurfEyebrow>
      <TurfNum tone={tone} className="block text-[15px] leading-tight mt-0.5">{value}</TurfNum>
      {hint && <div className="text-[10px] text-zinc-500 mt-0.5 truncate">{hint}</div>}
    </div>
  );
}

/** Meter for credits, spots filled, wager limits — the same shape everywhere. */
export function TurfMeter({ value, max, tone = "neon", label, testid = "turf-meter" }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const fills = { neon: "bg-neon", brand: "bg-turf", trophy: "bg-trophy", warn: "bg-amber-500" };
  return (
    <div data-testid={testid}>
      {label && (
        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">
          <span>{label}</span>
          <span className="turf-num">{value} / {max}</span>
        </div>
      )}
      <div className="h-2 rounded-full bg-zinc-200 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${fills[tone] || fills.neon}`} style={{ width: `${pct}%` }} data-testid={`${testid}-fill`} />
      </div>
    </div>
  );
}

/**
 * Entry-closing countdown in Turf's scoreboard style. Ticks itself, and goes red
 * inside the last hour so an entry deadline is felt without reading the digits.
 */
export function TurfCountdown({ iso, overLabel = "Entries closed", compact = false, testid = "turf-countdown" }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const parts = countdownParts(iso, now);
  if (!parts) return null;
  if (parts.over) return <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-500" data-testid={testid}>{overLabel}</span>;
  if (compact) {
    return (
      <span className={`turf-num text-[11px] font-extrabold ${parts.urgent ? "text-turf" : "text-zinc-400"}`} data-testid={testid}>
        {parts.text}
      </span>
    );
  }
  const cells = parts.d > 0
    ? [[parts.d, "d"], [parts.h, "h"], [parts.m, "m"]]
    : [[parts.h, "h"], [parts.m, "m"], [parts.s, "s"]];
  return (
    <div className={`flex items-center gap-1 ${parts.urgent ? "text-turf" : "text-zinc-700"}`} data-testid={testid}>
      {cells.map(([v, unit], i) => (
        <span key={unit + i} className="inline-flex items-baseline gap-0.5">
          <span className={`turf-num text-[13px] ${parts.urgent ? "text-turf" : "text-zinc-900"}`}>{parts.pad ? parts.pad(v) : v}</span>
          <span className="text-[9px] font-bold uppercase text-zinc-500">{unit}</span>
          {i < cells.length - 1 && <span className="text-zinc-400 ml-0.5">:</span>}
        </span>
      ))}
    </div>
  );
}

/** Team crest placeholder: first letter of the full name on a Turf tile. */
export function TurfCrest({ name, short, size = 26, tone = "neutral", testid }) {
  const letter = ((name || short || "?").trim().charAt(0) || "?").toUpperCase();
  const tones = {
    neutral: "bg-zinc-100 border-ink-line text-zinc-700",
    brand: "bg-turf/10 border-turf/30 text-turf",
    neon: "bg-neon/10 border-neon/30 text-neon",
    trophy: "bg-trophy/20 border-trophy/40 text-trophy-dark",
  };
  return (
    <span
      aria-hidden="true"
      data-testid={testid}
      className={`grid place-items-center shrink-0 rounded-lg border font-heading font-extrabold ${tones[tone] || tones.neutral}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.46) }}
    >
      {letter}
    </span>
  );
}
