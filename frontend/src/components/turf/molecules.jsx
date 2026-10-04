/**
 * Turf MOLECULES — atoms combined into the pieces that repeat across screens:
 * the sport strip, a match tile, a contest row, a player row, rank deltas.
 * They take domain-shaped props (match, contest, player) but never call the API,
 * so the same molecule serves web, Android and iOS shells.
 */
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Baseball as CricketBall, Basketball, ChatCircleDots, Coins, Flag, Minus, SoccerBall, Target, Trophy, Users } from "@phosphor-icons/react";
import { ROLES, SPORTS, TURF, countdownParts, money, shortMoney } from "./tokens";
import { TurfCard, TurfChip, TurfCountdown, TurfCrest, TurfEyebrow, TurfLiveDot, TurfMeter, TurfNum, TurfPill } from "./atoms";

// The sport glyph names come from tokens.js, so adding a sport there is the only
// change needed to grow the strip — no screen edits.
const SPORT_ICONS = { Baseball: CricketBall, SoccerBall, Basketball, Target, Flag };

/** Sport selector. Cricket is live today; the rest hold their place on-system. */
export function SportStrip({ sports = SPORTS, active = "cricket", onSelect, testid = "sport-strip" }) {
  return (
    <div className="turf-strip no-bar -mx-4 px-4 sm:mx-0 sm:px-0" data-testid={testid} role="tablist">
      {sports.map((s) => {
        const Glyph = SPORT_ICONS[s.icon] || Flag;
        const on = s.id === active;
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={on}
            data-testid={`sport-${s.id}`}
            data-active={on ? "true" : "false"}
            onClick={() => onSelect?.(s.id)}
            className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[12px] font-extrabold uppercase tracking-wider transition-colors ${
              on ? "bg-turf text-white border-turf shadow-glow-turf" : "bg-ink-card text-zinc-400 border-ink-line hover:border-turf/50 hover:text-zinc-200"
            }`}
          >
            <Glyph size={15} weight={on ? "fill" : "bold"} />
            {s.label}
            {!s.live && <span className={`text-[9px] font-bold ${on ? "text-white/70" : "text-zinc-600"}`}>soon</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Prize callout: what the winner takes, in the size it deserves. */
export function PrizePool({ total, label = "Prize pool", tone = "trophy", testid = "prize-pool" }) {
  const tones = { trophy: "text-trophy-light", brand: "text-turf", neon: "text-neon" };
  return (
    <div data-testid={testid}>
      <TurfEyebrow>{label}</TurfEyebrow>
      <div className={`turf-num text-[19px] leading-tight ${tones[tone] || tones.trophy}`}>{shortMoney(total)}</div>
    </div>
  );
}

/**
 * Match tile — the dashboard's primary object. Shows the fixture, the countdown
 * or LIVE state, and how much is at play, in one glanceable card.
 */
export function MatchTile({ match, selected = false, onOpen, spotsHint, testid }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);
  const live = match.status === "live";
  const locked = !!match.locked || live || match.status === "completed";
  const cd = countdownParts(match.start_time, now);
  const id = testid || `match-tile-${match.id}`;
  return (
    <button
      type="button"
      onClick={() => onOpen?.(match)}
      data-testid={id}
      data-selected={selected ? "true" : "false"}
      className={`turf-card turf-flag text-left w-full p-4 transition-transform active:scale-[0.99] ${
        selected ? "border-turf shadow-glow-turf" : "hover:border-turf/40"
      } ${live || locked ? "is-brand" : ""}`}
      style={selected ? { borderColor: TURF.red } : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <TurfEyebrow className="truncate">{[match.format, match.venue].filter(Boolean).join(" · ") || "Fixture"}</TurfEyebrow>
          <div className="mt-1.5 flex items-center gap-2">
            <TurfCrest name={match.team_a_name} short={match.team_a_short} tone={selected ? "brand" : "neutral"} />
            <span className="font-heading text-[17px] font-extrabold uppercase tracking-tight text-zinc-50 leading-none">
              {(match.team_a_short || "?").slice(0, 5)}
              <span className="text-[11px] font-bold text-zinc-500 mx-1.5">vs</span>
              {(match.team_b_short || "?").slice(0, 5)}
            </span>
            <TurfCrest name={match.team_b_name} short={match.team_b_short} tone={selected ? "brand" : "neutral"} />
          </div>
        </div>
        {live ? <TurfLiveDot /> : locked ? <TurfChip skin="neutral">Started</TurfChip> : null}
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          {!live && !locked && cd && !cd.over && <TurfCountdown iso={match.start_time} overLabel="Started" />}
          {!live && !locked && (!cd || cd.over) && (
            <span className="text-[12px] text-zinc-400 font-semibold">
              {new Date(match.start_time).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
            </span>
          )}
          {spotsHint && <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mt-1">{spotsHint}</div>}
        </div>
        <div className="text-right shrink-0">
          <TurfEyebrow>Contests</TurfEyebrow>
          <TurfNum tone={match.contests_count ? "brand" : "muted"} className="text-[16px]">{match.contests_count ?? 0}</TurfNum>
        </div>
      </div>
    </button>
  );
}

/**
 * Contest row — the lobby's list item: fee, pool, spots left, entries per team.
 */
export function ContestRow({ contest, onJoin, joined = 0, testid }) {
  const total = Math.max(1, Number(contest.max_participants || 0));
  const filled = Math.min(total, Number(contest.participants_count ?? contest.joined_count ?? 0));
  const left = Math.max(0, total - filled);
  const pct = (filled / total) * 100;
  const closed = contest.status !== "open";
  const id = testid || `contest-row-${contest.id}`;
  return (
    <TurfCard className="p-4" edge={closed ? "" : "brand"} testid={id}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-heading text-[15px] font-extrabold uppercase tracking-tight text-zinc-50 truncate" title={contest.title}>
            {contest.title}
          </div>
          <div className="text-[11px] text-zinc-500 mt-0.5 truncate">
            {[contest.kind === "fantasy" ? "Fantasy" : "Classic", contest.match_title || contest.match_id ? "" : ""].filter(Boolean).join(" · ")}
            {contest.description ? ` · ${contest.description}` : ""}
          </div>
        </div>
        <div className="text-right shrink-0">
          <TurfEyebrow>Winner takes</TurfEyebrow>
          <TurfNum tone="trophy" className="text-[15px]">{shortMoney(contest.first_prize ?? contest.winner_prize ?? contest.total_prize)}</TurfNum>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <div>
          <TurfEyebrow>Entry fee</TurfEyebrow>
          <TurfNum className="text-[15px] text-turf">{money(contest.entry_fee)}</TurfNum>
        </div>
        <div>
          <TurfEyebrow>Total pool</TurfEyebrow>
          <TurfNum tone="trophy" className="text-[15px]">{shortMoney(contest.total_prize)}</TurfNum>
        </div>
        <div className="text-right">
          <TurfEyebrow>{contest.expires_at ? "Closes in" : "Status"}</TurfEyebrow>
          {contest.expires_at && !closed ? (
            <TurfCountdown iso={contest.expires_at} overLabel="Closed" compact testid={`${id}-cd`} />
          ) : (
            <TurfChip skin={closed ? "neutral" : "neon"}>{closed ? contest.status : "Open"}</TurfChip>
          )}
        </div>
      </div>

      <div className="mt-3">
        <TurfMeter value={filled} max={total} tone={left === 0 ? "brand" : pct > 75 ? "warn" : "neon"} testid={`${id}-meter`} />
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-1">
            <Users size={11} weight="bold" /> {left === 0 ? "Contest full" : `${left.toLocaleString("en-IN")} spots left`}
          </span>
          <button
            type="button"
            onClick={() => onJoin?.(contest)}
            disabled={closed || left === 0}
            data-testid={`${id}-join`}
            className={`rounded-full px-4 py-1.5 text-[12px] font-extrabold uppercase tracking-wider transition-transform active:scale-95 disabled:opacity-45 ${
              joined > 0 ? "bg-neon/15 border border-neon/40 text-neon" : "turf-cta border-0"
            }`}
          >
            {joined > 0 ? `Joined ${joined}` : closed ? "Closed" : "Join"}
          </button>
        </div>
      </div>
    </TurfCard>
  );
}

/** Role tag in the pitch's own colour language. */
export function RoleTag({ role, className = "", testid }) {
  const cfg = ROLES[role] || { short: role, label: role, skin: "neutral" };
  return <TurfChip skin={cfg.skin} testid={testid || `role-tag-${role}`} className={className}>{cfg.short}</TurfChip>;
}

/** Player row used by the squad list and the pitch's bench. */
export function PlayerTile({ player, picked = false, out = false, disabled = false, onToggle, onInfo, testid }) {
  const role = ROLES[player.role] || { short: player.role, label: player.role, skin: "neutral" };
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 border-b border-ink-line/70 transition-colors ${
        picked ? "bg-turf/10" : out ? "bg-ink-900 opacity-70" : "hover:bg-ink-800"
      }`}
      data-testid={testid || `player-tile-${player.id}`}
      data-out={out ? "true" : "false"}
    >
      <button
        type="button"
        onClick={() => onToggle?.(player)}
        disabled={disabled}
        className="flex-1 min-w-0 flex items-center gap-2.5 text-left disabled:opacity-50"
        data-testid={`player-hit-${player.id}`}
      >
        <span className={`w-5 h-5 rounded-md border grid place-items-center shrink-0 text-[11px] font-extrabold ${
          picked ? "bg-turf border-turf text-white" : out ? "border-ink-line text-zinc-600 line-through" : "border-ink-line text-transparent"
        }`}>
          {picked ? "✓" : "+"}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-[13px] font-bold truncate ${out ? "text-zinc-500 line-through decoration-turf/60" : "text-zinc-50"}`}>
            {player.name}
          </span>
          <span className="flex items-center gap-1.5 mt-0.5">
            <TurfChip skin={role.skin}>{role.short}</TurfChip>
            <span className="text-[10px] font-bold text-zinc-500">{player.team}</span>
            {Number(player.selection_pct) > 0 && (
              <span className="text-[10px] text-zinc-500 flex items-center gap-0.5" data-testid={`sel-pct-${player.id}`}>
                <Users size={10} weight="bold" /> {Math.round(player.selection_pct)}%
              </span>
            )}
          </span>
        </span>
        {Number(player.projection) > 0 && (
          <span className="shrink-0 text-right">
            <TurfEyebrow className="justify-end">Proj</TurfEyebrow>
            <TurfNum tone="neon" className="block text-[12px]">{player.projection}</TurfNum>
          </span>
        )}
        <span className="shrink-0 text-right">
          <TurfEyebrow className="justify-end">Cr</TurfEyebrow>
          <TurfNum className="block text-[12px]">{player.credits}</TurfNum>
        </span>
      </button>
      {onInfo && (
        <button type="button" onClick={() => onInfo?.(player)} data-testid={`player-info-${player.id}`}
          className="shrink-0 p-1.5 rounded-md text-zinc-500 hover:text-turf hover:bg-turf/10" title="Form, value and role rank">
          <ChatCircleDots size={15} weight="bold" />
        </button>
      )}
    </div>
  );
}

/** Up / down / flat rank movement, the unit the leaderboard and My Matches use. */
export function RankDelta({ delta, size = 12, testid = "rank-delta" }) {
  const n = Number(delta || 0);
  if (!Number.isFinite(n) || n === 0) {
    return <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-zinc-500" data-testid={testid}><Minus size={size} weight="bold" /> 0</span>;
  }
  const up = n > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-extrabold ${up ? "text-neon" : "text-turf"}`} data-testid={testid}>
      {up ? <ArrowUp size={size} weight="fill" /> : <ArrowDown size={size} weight="fill" />}
      {Math.abs(n)}
    </span>
  );
}

/** Filter chip group: Mega / Head-to-head / Practice, or a fee band. */
export function FilterChips({ options, value, onChange, testid = "filter-chips" }) {
  return (
    <div className="turf-strip no-bar -mx-4 px-4 sm:mx-0 sm:px-0" data-testid={testid}>
      {options.map((o) => (
        <TurfPill key={o.id} testid={`${testid}-${o.id}`} active={value === o.id} onClick={() => onChange?.(o.id)}>
          {o.icon === "trophy" && <Trophy size={13} weight="fill" />}
          {o.icon === "duel" && <Flag size={13} weight="fill" />}
          {o.icon === "practice" && <Coins size={13} weight="fill" />}
          {o.label}
          {o.count > 0 && <span className="turf-num text-[10px] opacity-70">{o.count}</span>}
        </TurfPill>
      ))}
    </div>
  );
}

export { ROLE_ORDER } from "./tokens";
