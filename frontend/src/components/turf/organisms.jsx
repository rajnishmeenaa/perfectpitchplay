/**
 * Turf ORGANISMS — full screen regions assembled from atoms and molecules:
 * the match dashboard, the contest lobby, the team-creation pitch, the
 * leaderboard board and the contest chat thread. These are the four surfaces
 * the product is judged on, so they own the layout and nothing below them does.
 */
import { useMemo, useState } from "react";
import { ArrowCircleLeft, ChatsCircle, Lock, PaperPlaneRight, ShieldCheck, Sparkle, Trophy, Users } from "@phosphor-icons/react";
import { ROLES, ROLE_ORDER, TURF, money } from "./tokens";
import { TurfCard, TurfChip, TurfCountdown, TurfEyebrow, TurfLiveDot, TurfNum, TurfSection, TurfStat } from "./atoms";
import { ContestRow, FilterChips, MatchTile, RankDelta, SportStrip } from "./molecules";

/**
 * HOME / MATCH DASHBOARD. Sport strip on top, then the live match (if any) and
 * the upcoming fixtures the user can enter. Tiles carry team letters, a
 * countdown and the contest pool callout, exactly the order a player scans in.
 */
export function MatchDashboard({
  sports,
  sport,
  onSport,
  matches,
  selectedId,
  onSelect,
  contestCount,
  className = "",
}) {
  const live = (matches || []).filter((m) => m.status === "live");
  const soon = (matches || []).filter((m) => m.status !== "live");
  return (
    <div className={className} data-testid="match-dashboard">
      <SportStrip sports={sports} active={sport} onSelect={onSport} />

      {live.length > 0 && (
        <TurfSection title="Live now" hint="Points move while you watch" testid="dashboard-live">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {live.map((m) => (
              <MatchTile
                key={m.id}
                match={m}
                selected={selectedId === m.id}
                onOpen={(x) => onSelect?.(selectedId === x.id ? null : x.id)}
                spotsHint={`${m.contests_count ?? 0} contest${m.contests_count === 1 ? "" : "s"} running`}
                testid={`match-card-${m.id}`}
              />
            ))}
          </div>
        </TurfSection>
      )}

      <TurfSection
        title={live.length ? "Upcoming" : "Matches"}
        hint={contestCount ? `${contestCount} contest${contestCount === 1 ? "" : "s"} open across them` : "Tap a fixture to filter the lobby"}
        testid="dashboard-upcoming"
      >
        {soon.length === 0 && !live.length ? (
          <TurfCard className="p-6 text-center">
            <ShieldCheck size={26} weight="duotone" className="mx-auto text-zinc-600" />
            <div className="font-heading text-[15px] font-extrabold text-zinc-200 mt-2">No fixture announced yet</div>
            <p className="text-[12px] text-zinc-500 mt-1">The organiser publishes a match with both squads, then contests open here.</p>
          </TurfCard>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {soon.map((m) => (
              <MatchTile
                key={m.id}
                match={m}
                selected={selectedId === m.id}
                onOpen={(x) => onSelect?.(selectedId === x.id ? null : x.id)}
                spotsHint={m.locked ? "Teams locked" : `${m.players_count ?? 0} in the squads`}
                testid={`match-card-${m.id}`}
              />
            ))}
          </div>
        )}
      </TurfSection>
    </div>
  );
}

const LOBBY_FILTERS = [
  { id: "all", label: "All contests" },
  { id: "mega", label: "Mega", icon: "trophy", test: (c) => Number(c.max_participants || 0) >= 1000 },
  { id: "small", label: "Small", test: (c) => { const n = Number(c.max_participants || 0); return n > 0 && n < 1000; } },
  { id: "duel", label: "Head to head", icon: "duel", test: (c) => Number(c.max_participants || 0) === 2 },
  { id: "practice", label: "Practice", icon: "practice", test: (c) => Number(c.entry_fee || 0) === 0 },
  { id: "fantasy", label: "Fantasy", test: (c) => c.kind === "fantasy" },
  { id: "joined", label: "Joined", test: (c) => (c.my_entries || []).length > 0 || Number(c.joined_count || 0) > 0 },
];

const SORTS = [
  { id: "prize", label: "Prize first" },
  { id: "fee_low", label: "Fee: low to high" },
  { id: "fee_high", label: "Fee: high to low" },
  { id: "filling", label: "Filling fast" },
];

/**
 * CONTEST LOBBY. Filter chips then a sort control then the rows. Filtering and
 * sorting happen in the browser so the list reacts instantly to a tap.
 */
export function ContestLobby({ contests, onJoin, joinedOf, filter, onFilter, sort, onSort, matchLabel, onClearFilter, empty, renderItem, columns = "md:grid-cols-2" }) {
  const [localFilter, setLocalFilter] = useState("all");
  const [localSort, setLocalSort] = useState("prize");
  const activeFilter = filter !== undefined ? filter : localFilter;
  const activeSort = sort !== undefined ? sort : localSort;
  const setFilter = onFilter || setLocalFilter;
  const setSort = onSort || setLocalSort;

  const counts = useMemo(() => {
    const out = { all: contests.length };
    LOBBY_FILTERS.forEach((f) => { if (f.test) out[f.id] = contests.filter(f.test).length; });
    return out;
  }, [contests]);

  const visible = useMemo(() => {
    const def = LOBBY_FILTERS.find((f) => f.id === activeFilter);
    let list = def && def.test ? contests.filter(def.test) : [...contests];
    const prize = (c) => Number(c.total_prize || c.prize_pool || 0);
    const fee = (c) => Number(c.entry_fee || 0);
    const fill = (c) => {
      const cap = Number(c.max_participants || 0);
      return cap > 0 ? Number(c.participants_count ?? c.joined_count ?? 0) / cap : 0;
    };
    if (activeSort === "prize") list.sort((a, b) => prize(b) - prize(a));
    if (activeSort === "fee_low") list.sort((a, b) => fee(a) - fee(b));
    if (activeSort === "fee_high") list.sort((a, b) => fee(b) - fee(a));
    if (activeSort === "filling") list.sort((a, b) => fill(b) - fill(a));
    return list;
  }, [contests, activeFilter, activeSort]);

  return (
    <div data-testid="contest-lobby">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <TurfEyebrow testid="lobby-scope">{matchLabel || "All matches"}</TurfEyebrow>
          {onClearFilter && (
            <button
              type="button"
              onClick={onClearFilter}
              data-testid="lobby-clear-filter"
              className="inline-flex items-center gap-1 rounded-full border border-turf/40 bg-turf/10 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-widest text-turf hover:bg-turf/20"
            >
              clear
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-zinc-500">
          <span className="turf-eyebrow">Sort</span>
          <select
            value={activeSort}
            onChange={(e) => setSort(e.target.value)}
            data-testid="lobby-sort"
            className="rounded-md border border-ink-line bg-ink-card text-[12px] font-bold text-zinc-200 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-turf"
          >
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
      </div>

      <FilterChips
        testid="lobby-filters"
        value={activeFilter}
        onChange={setFilter}
        options={LOBBY_FILTERS.map((f) => ({ id: f.id, label: f.label, icon: f.icon, count: f.id === "all" ? 0 : counts[f.id] || 0 }))}
      />

      {visible.length === 0 ? (
        empty || (
          <TurfCard className="p-8 text-center mt-4">
            <Users size={26} weight="duotone" className="mx-auto text-zinc-600" />
            <div className="font-heading text-[15px] font-extrabold text-zinc-200 mt-2">Nothing in this filter</div>
            <p className="text-[12px] text-zinc-500 mt-1">Try All contests, or pick another match above.</p>
          </TurfCard>
        )
      ) : (
        <div className={`grid ${columns} gap-4 mt-4`}>
          {visible.map((c) => renderItem ? renderItem(c) : (
            <ContestRow key={c.id} contest={c} onJoin={onJoin} joined={joinedOf ? joinedOf(c) : 0} testid={`contest-card-${c.id}`} />
          ))}
        </div>
      )}
    </div>
  );
}

const LINES = { BOWL: "text-neon", AR: "text-trophy-light", BAT: "text-sky-300", WK: "text-violet-300" };

/**
 * TEAM CREATION — the pitch view. Four role lines on mowed turf; tapping a tile
 * picks or drops the player, and the credit bar sits under the field so the
 * budget is always in view while names are being chosen.
 */
export function PitchField({ players, pickedIds = [], captain, vice, onToggle, budget = 100, perSide = {}, locked = false, outIds = [] }) {
  const byLine = useMemo(() => {
    const g = {};
    ROLE_ORDER.forEach((r) => { g[r] = []; });
    players.forEach((p) => { if (g[p.role]) g[p.role].push(p); });
    Object.values(g).forEach((list) => list.sort((a, b) => Number(b.projection || 0) - Number(a.projection || 0)));
    return g;
  }, [players]);
  const used = pickedIds.length;
  const credits = useMemo(
    () => players.filter((p) => pickedIds.includes(p.id)).reduce((n, p) => n + Number(p.credits || 0), 0),
    [players, pickedIds]
  );

  return (
    <div className="turf-pitch rounded-turf border border-ink-line overflow-hidden" data-testid="pitch-field">
      <div className="flex items-center justify-between px-4 py-2.5 bg-ink-950/70 border-b border-ink-line">
        <div className="flex items-center gap-2">
          <TurfNum tone={used === 11 ? "neon" : "brand"} className="text-[15px]">{used}/11</TurfNum>
          <span className="turf-eyebrow">picked</span>
        </div>
        {locked && (
          <span className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-widest text-turf">
            <Lock size={11} weight="bold" /> teams locked
          </span>
        )}
        {!locked && <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">tap a player to pick</span>}
      </div>

      <div className="relative px-3 py-4 space-y-3">
        <div className="pointer-events-none absolute inset-x-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-28 h-28 rounded-full border border-neon/20" aria-hidden="true" />
        {ROLE_ORDER.map((role) => {
          const cfg = ROLES[role];
          const list = byLine[role] || [];
          return (
            <div key={role} className="relative" data-testid={`pitch-line-${role}`}>
              <div className={`flex items-center gap-2 mb-1.5 ${LINES[role]}`}>
                <span className="text-[9px] font-extrabold uppercase tracking-[0.2em]">{cfg.label}</span>
                <span className="h-px flex-1 bg-ink-line" />
                <span className="turf-num text-[10px] text-zinc-500">{list.filter((p) => pickedIds.includes(p.id)).length} picked</span>
              </div>
              <div className="flex flex-wrap justify-center gap-x-2 gap-y-3">
                {list.map((p) => {
                  const on = pickedIds.includes(p.id);
                  const out = outIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={locked}
                      onClick={() => onToggle?.(p)}
                      data-testid={`pitch-pick-${p.id}`}
                      data-picked={on ? "true" : "false"}
                      className="w-[62px] shrink-0 flex flex-col items-center gap-1 disabled:opacity-60"
                    >
                      <span className="relative grid place-items-center">
                        <span className={`w-11 h-11 rounded-full grid place-items-center border-2 font-heading font-extrabold text-[13px] transition-colors ${
                          out ? "border-ink-line bg-ink-800 text-zinc-600"
                            : on ? "border-turf bg-turf text-white shadow-glow-turf"
                            : "border-ink-line bg-ink-card text-zinc-300"
                        }`} style={on ? { borderColor: TURF.red, backgroundColor: TURF.red } : undefined}>
                          {(p.name || "?").charAt(0).toUpperCase()}
                        </span>
                        {captain === p.id && <span className="absolute -right-1 -bottom-1 grid place-items-center w-4 h-4 rounded-full bg-trophy text-[8px] font-black text-ink-950">C</span>}
                        {vice === p.id && <span className="absolute -right-1 -bottom-1 grid place-items-center w-4 h-4 rounded-full bg-trophy/80 text-[7px] font-black text-ink-950">VC</span>}
                        {out && <span className="absolute inset-0 grid place-items-center text-turf text-[18px] font-black">×</span>}
                      </span>
                      <span className="text-[9px] font-bold text-zinc-300 leading-tight text-center truncate w-full">{(p.name || "").split(" ").slice(-1)[0]}</span>
                      <span className="turf-num text-[9px] text-zinc-500">{p.credits} cr</span>
                    </button>
                  );
                })}
                {!list.length && <span className="text-[11px] text-zinc-600">No {cfg.label.toLowerCase} listed yet</span>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-4 py-3 bg-ink-950/70 border-t border-ink-line">
        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-zinc-500">
          <span>Credits used</span>
          <span className="turf-num" data-testid="pitch-credits">{credits.toFixed(1)} / {budget}</span>
        </div>
        <div className="mt-1.5 h-2 rounded-full bg-ink-700 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${credits > budget ? "bg-turf" : credits > 95 ? "bg-trophy" : "bg-neon"}`}
            style={{ width: `${Math.min(100, (credits / budget) * 100)}%` }}
            data-testid="pitch-credits-bar"
          />
        </div>
        {Object.keys(perSide).length > 0 && (
          <div className="flex items-center gap-3 mt-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            {Object.entries(perSide).map(([team, n]) => (
              <span key={team} className="inline-flex items-center gap-1"><Users size={11} weight="bold" />{team} {n}/7</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** MY MATCHES / LEADERBOARD row: rank, movement, points and the prize at stake. */
export function LeaderRow({ row, rank, delta = 0, me = false, prize, testid }) {
  const place = rank ?? row.rank ?? row.position;
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 border-b border-ink-line/70 ${me ? "bg-turf/10" : ""}`}
      data-testid={testid || "leader-row"}
      data-me={me ? "true" : "false"}
    >
      <span className={`shrink-0 w-9 h-9 grid place-items-center rounded-lg font-heading font-extrabold text-[13px] ${
        place === 1 ? "bg-trophy text-ink-950" : place <= 3 ? "bg-ink-700 text-trophy-light" : "bg-ink-800 text-zinc-400"
      }`}>
        {place}
      </span>
      <div className="min-w-0 flex-1">
        <div className={`text-[13px] font-bold truncate ${me ? "text-turf" : "text-zinc-100"}`} title={row.name || row.user_name}>
          {row.name || row.user_name || "Anonymous"}{me ? " · you" : ""}
        </div>
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
          {row.team_name && <span className="truncate">{row.team_name}</span>}
          {delta !== 0 && <RankDelta delta={delta} />}
        </div>
      </div>
      <div className="text-right shrink-0">
        <TurfNum tone={me ? "brand" : "neon"} className="text-[15px]">{Number(row.points ?? row.fantasy_points ?? 0)}</TurfNum>
        <div className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">pts</div>
      </div>
      {prize !== undefined && prize !== null && (
        <div className="text-right shrink-0 w-16">
          <TurfNum tone="trophy" className="text-[12px]">{money(prize)}</TurfNum>
          <div className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">prize</div>
        </div>
      )}
    </div>
  );
}

/**
 * Contest chat: entrants talk about the same match while points move.
 * Rows come from /contests/{id}/chat and are trimmed to the last window.
 */
export function ChatThread({ messages = [], onSend, busy = false, testid = "contest-chat" }) {
  const [draft, setDraft] = useState("");
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    onSend?.(text);
    setDraft("");
  };
  return (
    <TurfCard className="flex flex-col overflow-hidden" testid={testid}>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-ink-line bg-ink-950/60">
        <ChatsCircle size={15} weight="fill" className="text-turf" />
        <span className="turf-eyebrow">Contest chat</span>
        <span className="ml-auto text-[10px] text-zinc-500">{messages.length} message{messages.length === 1 ? "" : "s"}</span>
      </div>
      <div className="max-h-64 overflow-y-auto px-3 py-3 space-y-2">
        {messages.length === 0 && (
          <p className="text-[12px] text-zinc-500 text-center py-4" data-testid="chat-empty">No one has spoken yet. Set the tone.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className="flex gap-2" data-testid={`chat-row-${m.id}`}>
            <span className="w-7 h-7 shrink-0 grid place-items-center rounded-lg bg-ink-700 text-[10px] font-extrabold text-zinc-300">
              {(m.name || "?").charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                {m.name} · {new Date(m.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
              </div>
              <div className="text-[12.5px] text-zinc-100 leading-snug break-words">{m.text}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 px-3 py-2.5 border-t border-ink-line">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          maxLength={240}
          placeholder="Say something about this contest"
          data-testid="chat-input"
          className="flex-1 min-w-0 rounded-full border border-ink-line bg-ink-soft px-3.5 py-2 text-[13px] text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-turf"
        />
        <button
          type="button"
          onClick={send}
          disabled={busy || !draft.trim()}
          data-testid="chat-send"
          className="turf-cta rounded-full px-3.5 py-2 border-0 disabled:opacity-45"
        >
          <PaperPlaneRight size={15} weight="fill" />
        </button>
      </div>
    </TurfCard>
  );
}

/** Compact live-state header used above a leaderboard or ticker. */
export function LiveStrip({ match, score, right }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-turf border border-ink-line bg-ink-950" data-testid="live-strip">
      <TurfLiveDot />
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-bold text-zinc-100 truncate">{match?.team_a_short} vs {match?.team_b_short}</div>
        {score && <div className="turf-num text-[11px] text-zinc-400 truncate">{score}</div>}
      </div>
      {right}
    </div>
  );
}
