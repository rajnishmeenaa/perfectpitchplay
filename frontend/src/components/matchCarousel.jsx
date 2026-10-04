import { useEffect, useState } from "react";
import { Broadcast } from "@phosphor-icons/react";

/** Team chip. A single letter keeps it distinct from the short code next to it. */
function TeamBadge({ name, short, flip = false }) {
  const letter = ((name || short || "?").trim().charAt(0) || "?").toUpperCase();
  return (
    <span
      className={`h-6 w-6 shrink-0 rounded-md grid place-items-center text-[11px] font-extrabold border ${flip ? "bg-gold/15 border-gold/40 text-gold" : "bg-white/5 border-night-line text-zinc-200"}`}
      aria-hidden="true"
    >
      {letter}
    </span>
  );
}

function whenLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86400000);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  if (sameDay(d, today)) return `Today, ${time}`;
  if (sameDay(d, tomorrow)) return `Tomorrow, ${time}`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) + `, ${time}`;
}

function shortCountdown(iso) {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  if (isNaN(diff) || diff <= 0) return null;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h >= 24) return null;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/**
 * Horizontal match strip. Tapping a match filters the contest list below it,
 * and tapping it again clears the filter — the same gesture players use on
 * apps they already know, so it needs no explanation.
 */
export function MatchCarousel({ matches, selectedId, onSelect }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  if (!matches?.length) return null;

  return (
    <div
      className="-mx-4 sm:mx-0 px-4 sm:px-0 flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scroll-smooth"
      style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      data-testid="match-carousel"
      data-tick={tick}
    >
      {matches.map((m) => {
        const on = selectedId === m.id;
        const live = m.status === "live";
        const cd = !live && !m.locked ? shortCountdown(m.start_time) : null;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onSelect(on ? null : m.id)}
            className={`snap-start shrink-0 w-[200px] rounded-2xl border px-4 py-3 text-left transition-colors ${on ? "border-gold bg-gold/10" : "border-night-line bg-night-card hover:border-gold/40"}`}
            data-testid={`match-card-${m.id}`}
            data-selected={on ? "true" : "false"}
          >
            <div className="text-[11px] font-semibold text-zinc-500 truncate">
              {[m.format, m.venue].filter(Boolean).join(" · ") || "Upcoming match"}
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <TeamBadge name={m.team_a_name} short={m.team_a_short} />
              <span className="font-heading text-lg font-extrabold uppercase tracking-tight text-zinc-50 truncate">
                {(m.team_a_short || "?").slice(0, 4)}
                <span className="text-[11px] font-bold text-zinc-500 mx-1">v</span>
                {(m.team_b_short || "?").slice(0, 4)}
              </span>
              <TeamBadge name={m.team_b_name} short={m.team_b_short} flip />
            </div>
            <div className="mt-2 text-[12px] font-bold tabular truncate" data-testid={`match-when-${m.id}`}>
              {live ? (
                <span className="inline-flex items-center gap-1.5 text-red-400">
                  <Broadcast size={12} weight="fill" /> LIVE NOW
                </span>
              ) : m.locked ? (
                <span className="text-zinc-500">Started</span>
              ) : cd ? (
                <span className="text-gold">{cd}</span>
              ) : (
                <span className="text-zinc-400">{whenLabel(m.start_time)}</span>
              )}
            </div>
            {m.contests_count > 0 && (
              <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500" data-testid={`match-contests-${m.id}`}>
                {m.contests_count} contest{m.contests_count === 1 ? "" : "s"}
                {m.my_teams_count ? ` · ${m.my_teams_count} team${m.my_teams_count === 1 ? "" : "s"}` : ""}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
