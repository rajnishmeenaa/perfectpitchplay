import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { toast } from "sonner";
import { Flag, Users, Lock, Trophy, ChartBar, Info, PencilSimple, Trash, Check, X, Clock, Plus, ShieldCheck, Medal } from "@phosphor-icons/react";

const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const ROLES = ["WK", "BAT", "AR", "BOWL"];
const ROLE_LABEL = { WK: "Wicketkeeper", BAT: "Batter", AR: "All-rounder", BOWL: "Bowler" };
const ROLE_SKIN = {
  WK: "bg-violet-100 text-violet-800 border-violet-200",
  BAT: "bg-sky-100 text-sky-800 border-sky-200",
  AR: "bg-amber-100 text-amber-800 border-amber-200",
  BOWL: "bg-rose-100 text-rose-800 border-rose-200",
};
const LIMITS = { WK: [1, 4], BAT: [3, 6], AR: [1, 4], BOWL: [3, 6] };
const TEAM_SIZE = 11;
const CREDIT_BUDGET = 100;
const MAX_PER_SIDE = 7;

function useCountdown(iso) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!iso) return null;
  const diff = new Date(iso).getTime() - now;
  if (isNaN(diff)) return null;
  if (diff <= 0) return { over: true, urgent: false, text: "Match started" };
  const d = Math.floor(diff / 86400000), h = Math.floor((diff % 86400000) / 3600000), m = Math.floor((diff % 3600000) / 60000), s = Math.floor((diff % 60000) / 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return { over: false, urgent: diff < 3600000, text: d > 0 ? `${d}d ${pad(h)}h ${pad(m)}m` : `${pad(h)}:${pad(m)}:${pad(s)}` };
}

const fmtWhen = (iso) => {
  if (!iso) return "Time to be announced";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });
};

const StatusChip = ({ status }) => {
  const map = { upcoming: "bg-emerald-100 text-emerald-800", live: "bg-orange-100 text-orange-800", completed: "bg-zinc-200 text-zinc-700", abandoned: "bg-red-100 text-red-700" };
  return <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest ${map[status] || "bg-zinc-100 text-zinc-600"}`} data-testid={`match-status-${status}`}>{status === "upcoming" ? "upcoming" : status}</span>;
};

export default function FantasyApp({ config, walletBalance = 0, focusMatchId, entries = [], onJoinFantasy }) {
  const [matches, setMatches] = useState([]);
  const [matchId, setMatchId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  const loadMatches = async () => {
    try {
      const { data } = await api.get("/matches");
      // Open matches first; completed/locked ones sink to the bottom as history.
      const ordered = [...data].sort((a, b) => (a.locked === b.locked ? new Date(a.start_time) - new Date(b.start_time) : a.locked ? 1 : -1));
      setMatches(ordered);
      setMatchId((cur) => cur || focusMatchId || (ordered[0] && ordered[0].id) || null);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load matches");
    }
  };

  useEffect(() => { loadMatches(); /* eslint-disable-next-line */ }, []);

  useEffect(() => {
    if (!focusMatchId) return;
    setMatchId(focusMatchId);
  }, [focusMatchId]);

  const loadDetail = async (id) => {
    if (!id) return;
    setLoadingDetail(true);
    try {
      const { data } = await api.get(`/matches/${id}`);
      setDetail(data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load match");
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  useEffect(() => { loadDetail(matchId); /* eslint-disable-next-line */ }, [matchId, entries.length]);

  if (!matches.length) {
    return (
      <div className="bg-white border border-zinc-200 rounded-lg p-10 text-center" data-testid="fantasy-empty">
        <Flag size={40} weight="duotone" className="mx-auto text-zinc-300" />
        <h3 className="font-heading text-xl font-extrabold text-zinc-900 mt-3">No fantasy matches yet</h3>
        <p className="text-sm text-zinc-500 mt-1 max-w-sm mx-auto">The admin announces a match with both squads, then you can build your XI and enter contests.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-extrabold tracking-tight text-zinc-950 flex items-center gap-2">
            <Flag size={22} weight="fill" className="text-emerald-600" /> Fantasy Cricket
          </h2>
          <p className="text-sm text-zinc-500 mt-0.5">Pick 11 players, captain (2x) and vice-captain (1.5x). Points update when the admin posts the scorecard.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setRulesOpen(true)} className="rounded-full border-zinc-300 font-bold" data-testid="points-rules-btn">
          <Info size={16} weight="bold" className="mr-1" /> Points system
        </Button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {matches.map((m) => (
          <MatchCard key={m.id} match={m} active={m.id === matchId} onOpen={() => setMatchId(m.id)} />
        ))}
      </div>

      {detail && (
        <MatchWorkspace
          key={matchId}
          detail={detail}
          reload={() => loadDetail(matchId)}
          config={config}
          walletBalance={walletBalance}
          onJoinFantasy={onJoinFantasy}
        />
      )}
      {loadingDetail && !detail && <div className="text-sm text-zinc-500">Loading match…</div>}

      <RulesDialog open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </div>
  );
}

function MatchCard({ match, active, onOpen }) {
  const cd = useCountdown(match.start_time);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`text-left bg-white border rounded-lg p-5 transition-all hover:-translate-y-0.5 ${active ? "border-emerald-500 ring-2 ring-emerald-100" : "border-zinc-200 hover:border-emerald-300"}`}
      data-testid={`match-card-${match.id}`}
    >
      <div className="flex items-center justify-between">
        <StatusChip status={match.status} />
        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">{match.format}</span>
      </div>
      <div className="flex items-center justify-between gap-2 mt-3">
        <div className="font-heading text-lg font-extrabold text-zinc-950">{match.team_a_short}</div>
        <div className="text-xs font-bold text-zinc-400">vs</div>
        <div className="font-heading text-lg font-extrabold text-zinc-950 text-right">{match.team_b_short}</div>
      </div>
      <div className="text-xs text-zinc-500 mt-1 truncate">{match.team_a_name} vs {match.team_b_name}</div>
      {cd && (
        <div className={`mt-3 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-bold tabular ${cd.over ? "bg-zinc-100 text-zinc-600" : cd.urgent ? "bg-red-50 text-red-700 border border-red-200" : "bg-orange-50 text-orange-800"}`} data-testid={`match-countdown-${match.id}`}>
          <Clock size={13} weight="bold" /> {cd.over ? cd.text : `Starts in ${cd.text}`}
        </div>
      )}
      <div className="flex items-center gap-3 mt-3 text-[11px] font-bold uppercase tracking-wider text-zinc-500">
        <span className="flex items-center gap-1"><Users size={13} /> {match.players_count}</span>
        <span className="flex items-center gap-1"><Trophy size={13} /> {match.contests_count}</span>
        <span className="flex items-center gap-1 ml-auto text-emerald-700"><Check size={13} weight="bold" /> {match.my_teams_count} team{match.my_teams_count === 1 ? "" : "s"}</span>
      </div>
    </button>
  );
}

function MatchWorkspace({ detail, reload, config, walletBalance, onJoinFantasy }) {
  const { match, players, contests, my_teams } = detail;
  // Draft lives here so switching sub-tabs never throws away an in-progress XI.
  const [draft, setDraft] = useState({ ids: [], captain: "", vice: "", name: "", editingId: null });
  const byTeam = useMemo(() => {
    const g = {};
    players.forEach((p) => { (g[p.team] = g[p.team] || []).push(p); });
    Object.values(g).forEach((list) => list.sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || b.credits - a.credits));
    return g;
  }, [players]);
  const sides = [match.team_a_short, match.team_b_short];
  const squadsReady = players.length >= 2 * TEAM_SIZE;

  return (
    <div className="space-y-5" data-testid="match-workspace">
      <div className="bg-white border border-zinc-200 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-heading text-xl font-extrabold text-zinc-950">{match.team_a_name} vs {match.team_b_name}</h3>
              <StatusChip status={match.status} />
              {match.locked && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-red-700 bg-red-50 border border-red-200 rounded px-2 py-0.5" data-testid="teams-locked-chip">
                  <Lock size={11} weight="bold" /> teams locked
                </span>
              )}
            </div>
            <div className="text-sm text-zinc-500 mt-1">{fmtWhen(match.start_time)}{match.venue ? ` · ${match.venue}` : ""}</div>
          </div>
          {!squadsReady && (
            <div className="text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2" data-testid="squads-pending">
              Squads not announced yet ({players.length}/22 players)
            </div>
          )}
        </div>
      </div>

      <Tabs defaultValue="build" className="w-full">
        <TabsList className="bg-zinc-100 border border-zinc-200 rounded-full p-1 h-auto">
          <TabsTrigger value="build" className="rounded-full data-[state=active]:bg-emerald-600 data-[state=active]:text-white px-4 py-1.5 text-sm font-bold" data-testid="fsub-tab-build">
            <Plus size={15} weight="bold" className="mr-1.5" /> Build team
          </TabsTrigger>
          <TabsTrigger value="teams" className="rounded-full data-[state=active]:bg-emerald-600 data-[state=active]:text-white px-4 py-1.5 text-sm font-bold" data-testid="fsub-tab-teams">
            <Users size={15} weight="bold" className="mr-1.5" /> My teams ({my_teams.length})
          </TabsTrigger>
          <TabsTrigger value="contests" className="rounded-full data-[state=active]:bg-emerald-600 data-[state=active]:text-white px-4 py-1.5 text-sm font-bold" data-testid="fsub-tab-contests">
            <Trophy size={15} weight="bold" className="mr-1.5" /> Contests ({contests.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="build" className="mt-4">
          {squadsReady ? (
            <TeamBuilder match={match} players={players} byTeam={byTeam} sides={sides} myTeams={my_teams} draft={draft} setDraft={setDraft} onSaved={reload} />
          ) : (
            <div className="bg-white border border-zinc-200 rounded-lg p-8 text-center text-sm text-zinc-500">
              Team selection opens once both squads are announced.
            </div>
          )}
        </TabsContent>

        <TabsContent value="teams" className="mt-4">
          <MyTeams teams={my_teams} players={players} match={match} onReload={reload} />
        </TabsContent>

        <TabsContent value="contests" className="mt-4">
          <FantasyContests
            contests={contests}
            myTeams={my_teams}
            match={match}
            config={config}
            walletBalance={walletBalance}
            onJoinFantasy={onJoinFantasy}
            onReload={reload}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function tally(players, ids) {
  const picked = ids.map((id) => players.find((p) => p.id === id)).filter(Boolean);
  const roles = { WK: 0, BAT: 0, AR: 0, BOWL: 0 };
  const sides = {};
  let credits = 0;
  picked.forEach((p) => { roles[p.role] = (roles[p.role] || 0) + 1; sides[p.team] = (sides[p.team] || 0) + 1; credits += Number(p.credits || 0); });
  return { roles, sides, credits: Math.round(credits * 100) / 100, picked };
}

function TeamBuilder({ match, players, byTeam, sides, myTeams, draft, setDraft, onSaved }) {
  const { ids, captain, vice, name, editingId } = draft;
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [busy, setBusy] = useState(false);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const t = tally(players, ids);
  const locked = !!match.locked;

  const toggle = (p) => {
    if (locked) { toast.error("Teams are locked for this match"); return; }
    if (ids.includes(p.id)) {
      set({
        ids: ids.filter((x) => x !== p.id),
        captain: captain === p.id ? "" : captain,
        vice: vice === p.id ? "" : vice,
      });
      return;
    }
    if (ids.length >= TEAM_SIZE) { toast.error(`You already have ${TEAM_SIZE} players — remove one first`); return; }
    const credits = t.credits + Number(p.credits || 0);
    if (credits > CREDIT_BUDGET) { toast.error(`Only ${(CREDIT_BUDGET - t.credits).toFixed(1)} credits left`); return; }
    if ((t.sides[p.team] || 0) >= MAX_PER_SIDE) { toast.error(`Max ${MAX_PER_SIDE} players from ${p.team}`); return; }
    if ((t.roles[p.role] || 0) >= LIMITS[p.role][1]) { toast.error(`Max ${LIMITS[p.role][1]} ${ROLE_LABEL[p.role]}s`); return; }
    set({ ids: [...ids, p.id] });
  };

  const loadForEdit = (team) => {
    set({ ids: team.player_ids || [], captain: team.captain_id || "", vice: team.vice_captain_id || "", name: team.name || "", editingId: team.id });
    toast(`Editing ${team.name}`);
  };

  const reset = () => set({ ids: [], captain: "", vice: "", name: "", editingId: null });

  const ready = ids.length === TEAM_SIZE && !!captain && !!vice && captain !== vice && !locked;

  const save = async () => {
    setBusy(true);
    try {
      const payload = { match_id: match.id, player_ids: ids, captain_id: captain, vice_captain_id: vice, name: name || undefined };
      if (editingId) await api.patch(`/fantasy/teams/${editingId}`, payload);
      else await api.post("/fantasy/teams", payload);
      toast.success(editingId ? "Team updated" : "Team saved! Now join a contest.");
      reset();
      onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save team");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2 bg-white border border-zinc-200 rounded-lg" data-testid="squad-picker">
        <div className="p-4 border-b border-zinc-100 flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">Select players</span>
          <div className="flex gap-1 ml-auto">
            {["ALL", ...ROLES].map((r) => (
              <button key={r} type="button" onClick={() => setRoleFilter(r)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors ${roleFilter === r ? "bg-emerald-600 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"}`}
                data-testid={`role-filter-${r}`}>{r}</button>
            ))}
          </div>
        </div>
        <div className="divide-y divide-zinc-100 max-h-[520px] overflow-y-auto">
          {sides.map((side) => (
            <div key={side}>
              <div className="px-4 py-2 bg-zinc-50 text-xs font-extrabold uppercase tracking-widest text-zinc-600 sticky top-0">
                {side} · {t.sides[side] || 0}/{MAX_PER_SIDE} picked
              </div>
              {(byTeam[side] || []).filter((p) => roleFilter === "ALL" || p.role === roleFilter).map((p) => (
                <PlayerRow key={p.id} player={p} picked={ids.includes(p.id)} disabled={locked} onToggle={() => toggle(p)} />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <div className="bg-white border border-zinc-200 rounded-lg p-5" data-testid="team-summary">
          <div className="flex items-center justify-between">
            <h4 className="font-heading font-extrabold text-zinc-950">{editingId ? "Edit team" : "New team"}</h4>
            {editingId && (
              <button type="button" onClick={reset} className="text-xs font-bold text-zinc-500 hover:text-zinc-800 flex items-center gap-1" data-testid="cancel-edit"><X size={13} /> cancel</button>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2 mt-4">
            <Stat label="Players" value={`${ids.length}/${TEAM_SIZE}`} ok={ids.length === TEAM_SIZE} testId="stat-players" />
            <Stat label="Credits" value={`${t.credits}/${CREDIT_BUDGET}`} ok={t.credits <= CREDIT_BUDGET} testId="stat-credits" />
            <Stat label="Captain" value={captain ? "Set" : "—"} ok={!!captain} testId="stat-captain" />
          </div>

          <div className="grid grid-cols-4 gap-2 mt-3">
            {ROLES.map((r) => {
              const [lo, hi] = LIMITS[r];
              const n = t.roles[r] || 0;
              const good = n >= lo && n <= hi;
              return (
                <div key={r} className={`rounded-md border px-2 py-1.5 text-center ${good ? "border-emerald-200 bg-emerald-50" : "border-zinc-200 bg-zinc-50"}`} data-testid={`role-count-${r}`}>
                  <div className="text-[10px] font-bold uppercase text-zinc-500">{r}</div>
                  <div className={`text-sm font-extrabold tabular ${good ? "text-emerald-800" : "text-zinc-700"}`}>{n}</div>
                  <div className="text-[9px] text-zinc-400 tabular">{lo}–{hi}</div>
                </div>
              );
            })}
          </div>

          <input
            value={name}
            onChange={(e) => set({ name: e.target.value })}
            maxLength={30}
            placeholder="Team name (optional)"
            className="mt-4 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            data-testid="team-name-input"
          />

          {ids.length > 0 && (
            <div className="mt-4">
              <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Choose captain & vice-captain</div>
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {t.picked.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 text-sm" data-testid={`leaders-row-${p.id}`}>
                    <span className="flex-1 truncate font-semibold text-zinc-800">{p.name}</span>
                    <span className="text-[11px] text-zinc-400">{p.team}</span>
                    <button type="button" onClick={() => set({ captain: p.id, vice: vice === p.id ? "" : vice })}
                      className={`w-7 h-7 rounded-full text-[11px] font-extrabold transition-colors ${captain === p.id ? "bg-amber-500 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-amber-100"}`}
                      data-testid={`captain-${p.id}`}>C</button>
                    <button type="button" onClick={() => set({ vice: p.id, captain: captain === p.id ? "" : captain })}
                      className={`w-7 h-7 rounded-full text-[10px] font-extrabold transition-colors ${vice === p.id ? "bg-sky-600 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-sky-100"}`}
                      data-testid={`vice-${p.id}`}>VC</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Button disabled={!ready || busy} onClick={save} className="mt-5 w-full rounded-full bg-emerald-600 hover:bg-emerald-700 font-bold active:scale-95" data-testid="save-team-btn">
            {locked ? <><Lock size={16} weight="bold" className="mr-1" /> Teams locked</> : busy ? "Saving…" : <><Check size={16} weight="bold" className="mr-1" /> {editingId ? "Update team" : "Save team"}</>}
          </Button>
          {!ready && !locked && ids.length > 0 && (
            <p className="text-[11px] text-zinc-500 mt-2" data-testid="team-hint">
              Pick {TEAM_SIZE} players with valid role counts{captain && vice ? "" : " · set captain and vice-captain"}
            </p>
          )}
        </div>

        {myTeams.length > 0 && (
          <div className="bg-white border border-zinc-200 rounded-lg p-4" data-testid="saved-teams-quick">
            <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Your saved teams</div>
            <div className="space-y-2">
              {myTeams.map((tm) => (
                <div key={tm.id} className="flex items-center gap-2 text-sm border border-zinc-100 rounded-md px-3 py-2" data-testid={`saved-team-${tm.id}`}>
                  <span className="flex-1 truncate font-bold text-zinc-800">{tm.name}</span>
                  <span className="text-[11px] text-zinc-500 tabular">{tm.credits_used} cr</span>
                  <button type="button" onClick={() => loadForEdit(tm)} disabled={!!match.locked} className="p-1 rounded text-zinc-500 hover:text-emerald-700 disabled:opacity-40" title="Edit" data-testid={`edit-team-${tm.id}`}>
                    <PencilSimple size={15} weight="bold" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, ok, testId }) {
  return (
    <div className={`rounded-md border px-2 py-2 text-center ${ok ? "border-emerald-200 bg-emerald-50" : "border-zinc-200 bg-zinc-50"}`} data-testid={testId}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`text-sm font-extrabold tabular ${ok ? "text-emerald-800" : "text-zinc-700"}`}>{value}</div>
    </div>
  );
}

function PlayerRow({ player, picked, disabled, onToggle }) {
  const live = player.points != null && player.points !== 0;
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors disabled:opacity-50 ${picked ? "bg-emerald-50" : "hover:bg-zinc-50"}`}
      data-testid={`player-row-${player.id}`}
    >
      <span className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${picked ? "bg-emerald-600 border-emerald-600 text-white" : "border-zinc-300 text-transparent"}`}>
        <Check size={12} weight="bold" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-zinc-900 truncate">{player.name}{!player.playing && <span className="ml-1.5 text-[10px] font-bold text-red-600 uppercase">not playing</span>}</span>
        <span className={`inline-block mt-0.5 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${ROLE_SKIN[player.role]}`}>{ROLE_LABEL[player.role]}</span>
      </span>
      {live && <span className="text-[11px] font-extrabold text-orange-700 tabular" data-testid={`player-points-${player.id}`}>{player.points} pts</span>}
      <span className="text-xs font-extrabold text-zinc-600 tabular shrink-0" data-testid={`player-credits-${player.id}`}>{player.credits}</span>
    </button>
  );
}

function MyTeams({ teams, players, match, onReload }) {
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!teams.length) {
    return <div className="bg-white border border-zinc-200 rounded-lg p-8 text-center text-sm text-zinc-500" data-testid="no-teams">No teams yet — build your XI in the Build team tab.</div>;
  }
  const remove = async (id) => {
    setBusy(true);
    try {
      await api.delete(`/fantasy/teams/${id}`);
      toast.success("Team deleted");
      onReload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not delete team");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid md:grid-cols-2 gap-4">
      {teams.map((tm) => {
        const rows = (tm.players || []).filter(Boolean);
        const expanded = openId === tm.id;
        return (
          <div key={tm.id} className="bg-white border border-zinc-200 rounded-lg p-5" data-testid={`my-team-${tm.id}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-heading font-extrabold text-zinc-950 truncate">{tm.name}</div>
                <div className="text-xs text-zinc-500 mt-0.5 tabular">{tm.credits_used} credits · {tm.match_label}</div>
              </div>
              <button type="button" disabled={busy || !!match.locked} onClick={() => remove(tm.id)} className="p-1.5 rounded text-zinc-400 hover:text-red-600 disabled:opacity-40" title="Delete team" data-testid={`delete-team-${tm.id}`}>
                <Trash size={16} weight="bold" />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {rows.map((p) => {
                const isC = p.id === tm.captain_id, isVC = p.id === tm.vice_captain_id;
                return (
                  <span key={p.id} className={`text-[11px] font-bold px-2 py-1 rounded border ${isC ? "bg-amber-50 border-amber-300 text-amber-900" : isVC ? "bg-sky-50 border-sky-300 text-sky-900" : "bg-zinc-50 border-zinc-200 text-zinc-700"}`}>
                    {p.name}{isC ? " (C)" : isVC ? " (VC)" : ""}
                  </span>
                );
              })}
            </div>
            <button type="button" onClick={() => setOpenId(expanded ? null : tm.id)} className="mt-3 text-xs font-bold text-emerald-700 hover:text-emerald-900" data-testid={`toggle-xi-${tm.id}`}>
              {expanded ? "Hide playing XI" : "Show playing XI"}
            </button>
            {expanded && (
              <div className="mt-2 divide-y divide-zinc-100 border border-zinc-100 rounded-md" data-testid={`xi-${tm.id}`}>
                {rows.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                    <span className="flex-1 truncate text-zinc-800 font-semibold">{p.name}</span>
                    <span className="text-[10px] font-bold uppercase text-zinc-500">{p.role}</span>
                    <span className="text-[11px] text-zinc-500">{p.team}</span>
                    {p.points != null && <span className="text-[11px] font-extrabold text-orange-700 tabular">{p.points}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FantasyContests({ contests, myTeams, match, config, walletBalance, onJoinFantasy, onReload }) {
  const [picked, setPicked] = useState({});
  const [boardFor, setBoardFor] = useState(null);
  if (!contests.length) {
    return <div className="bg-white border border-zinc-200 rounded-lg p-8 text-center text-sm text-zinc-500" data-testid="no-fantasy-contests">No fantasy contest for this match yet. The admin can create one.</div>;
  }
  return (
    <div className="space-y-3">
      {myTeams.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-900 flex items-center gap-2" data-testid="need-team-banner">
          <Info size={16} weight="bold" /> Save a team first — every entry plays with one of your XIs.
        </div>
      )}
      {contests.map((c) => {
        const joined = (c.my_entries || []).map((e) => e.team_id).filter(Boolean);
        const available = myTeams.filter((tm) => !joined.includes(tm.id));
        const chosen = picked[c.id] || (available[0] && available[0].id) || "";
        const team = myTeams.find((tm) => tm.id === chosen);
        const max = Number(c.max_teams_per_user || 1);
        const closed = c.status !== "open" || !!match.locked;
        return (
          <div key={c.id} className="bg-white border border-zinc-200 rounded-lg p-5 hover:border-emerald-300 transition-colors" data-testid={`fantasy-contest-${c.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="font-heading font-extrabold text-zinc-950 truncate">{c.title}</h4>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">fantasy</span>
                </div>
                {c.description && <p className="text-sm text-zinc-500 mt-1 line-clamp-2">{c.description}</p>}
                <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-xs text-zinc-600 tabular">
                  <span>Entry <b className="text-zinc-900">{money(c.entry_fee)}</b></span>
                  <span>Prize pool <b className="text-orange-700">{money(c.prize_pool)}</b></span>
                  <span>{c.participants_count || 0}/{c.max_participants} joined</span>
                  <span>{max} team{max === 1 ? "" : "s"} per user</span>
                </div>
                {(c.prize_breakdown || []).length > 0 && (
                  <div className="flex flex-wrap gap-x-3 mt-1.5 text-[11px] text-zinc-500" data-testid={`f-prizes-${c.id}`}>
                    {c.prize_breakdown.map((it) => <span key={it.rank}>Rank {it.rank}: <b className="text-orange-700">{money(it.amount)}</b></span>)}
                  </div>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={() => setBoardFor(c)} className="rounded-full border-zinc-300 font-bold shrink-0" data-testid={`leaderboard-btn-${c.id}`}>
                <ChartBar size={15} weight="bold" className="mr-1" /> Leaderboard
              </Button>
            </div>

            <div className="mt-4 pt-4 border-t border-zinc-100 flex flex-wrap items-center gap-3">
              {myTeams.length > 0 && (
                <div className="flex flex-wrap gap-2" data-testid={`team-choose-${c.id}`}>
                  {myTeams.map((tm) => {
                    const used = joined.includes(tm.id);
                    return (
                      <button key={tm.id} type="button" disabled={used || closed} onClick={() => setPicked({ ...picked, [c.id]: tm.id })}
                        className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors disabled:opacity-45 ${chosen === tm.id && !used ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-zinc-700 border-zinc-200 hover:border-emerald-400"}`}
                        data-testid={`choose-team-${c.id}-${tm.id}`}>
                        {used ? `${tm.name} · joined` : `${tm.name} · ${tm.credits_used} cr`}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="ml-auto flex items-center gap-2">
                {c.settled_at ? (
                  <span className="text-xs font-bold text-zinc-600" data-testid={`settled-${c.id}`}>Result declared</span>
                ) : closed ? (
                  <span className="text-xs font-bold text-zinc-500 flex items-center gap-1"><Lock size={12} /> entries closed</span>
                ) : (
                  <Button
                    disabled={!team}
                    onClick={() => onJoinFantasy(c, { id: team.id, name: team.name, credits_used: team.credits_used })}
                    className="rounded-full bg-orange-600 hover:bg-orange-700 text-white font-bold active:scale-95"
                    data-testid={`join-fantasy-${c.id}`}
                  >
                    <Trophy size={16} weight="fill" className="mr-1" /> Join · {money(c.entry_fee)}
                  </Button>
                )}
              </div>
            </div>
            {walletBalance < Number(c.entry_fee || 0) && !closed && config.razorpay_enabled && (
              <p className="text-[11px] text-amber-700 mt-2" data-testid={`wallet-short-${c.id}`}>
                Wallet has {money(walletBalance)} — pay online, or add money from the Wallet tab.
              </p>
            )}
          </div>
        );
      })}
      {boardFor && <LeaderboardDialog contest={boardFor} onClose={() => setBoardFor(null)} onReload={onReload} />}
    </div>
  );
}

function LeaderboardDialog({ contest, onClose }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(true);
  const load = async () => {
    setBusy(true);
    try {
      const { data: d } = await api.get(`/fantasy/contests/${contest.id}/leaderboard`);
      setData(d);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load leaderboard");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [contest.id]);
  const rows = data?.leaderboard || [];
  const settled = !!data?.contest?.settled_at;
  const mine = rows.find((r) => r.is_me);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="leaderboard-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl font-extrabold tracking-tight flex items-center gap-2">
            <Medal size={22} weight="fill" className="text-orange-600" /> {contest.title}
          </DialogTitle>
          <DialogDescription>
            {data?.match ? `${data.match.team_a_short} vs ${data.match.team_b_short} · ` : ""}
            {settled ? "Final result — prizes credited to wallets." : data && !data.scorecard_entered ? "Live standings will appear once the match scorecard is posted." : "Running standings (updates with every scorecard edit)."}
          </DialogDescription>
        </DialogHeader>

        {busy && <div className="text-sm text-zinc-500 py-6 text-center">Loading standings…</div>}

        {!busy && rows.length === 0 && (
          <div className="text-center py-8 text-sm text-zinc-500 border border-dashed border-zinc-200 rounded-lg" data-testid="leaderboard-empty">
            Nobody has joined yet. Be the first to enter your XI.
          </div>
        )}

        {!busy && rows.length > 0 && (
          <>
            <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5 mb-3 text-sm" data-testid="my-standing">
              <span className="font-bold text-emerald-900">Your position</span>
              {mine ? (
                <span className="text-emerald-900 tabular">
                  Rank <b>#{mine.rank}</b> of {rows.length} · <b>{mine.points}</b> pts{mine.prize > 0 && <> · <b className="text-orange-700">{money(mine.prize)}</b></>}
                </span>
              ) : <span className="text-emerald-700">Not entered yet</span>}
            </div>
            <div className="divide-y divide-zinc-100 border border-zinc-200 rounded-lg overflow-hidden">
              {rows.map((r) => (
                <div key={r.entry_id} className={`flex items-center gap-3 px-4 py-2.5 text-sm ${r.is_me ? "bg-emerald-50" : ""}`} data-testid={`lb-row-${r.rank}`}>
                  <span className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-xs font-extrabold tabular ${r.rank === 1 ? "bg-amber-400 text-amber-950" : r.rank === 2 ? "bg-zinc-300 text-zinc-700" : r.rank === 3 ? "bg-orange-200 text-orange-800" : "bg-zinc-100 text-zinc-600"}`}>
                    {r.rank}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold text-zinc-900 truncate">{r.is_me ? `${r.team_name || "Your team"} (you)` : r.user_name}</span>
                    <span className="block text-[11px] text-zinc-500 truncate">{r.team_name || ""}</span>
                  </span>
                  {r.prize > 0 && <span className="text-[11px] font-extrabold text-orange-700 tabular">{money(r.prize)}</span>}
                  <span className="font-heading font-extrabold text-zinc-950 tabular w-14 text-right" data-testid={`lb-points-${r.rank}`}>{r.points}</span>
                </div>
              ))}
            </div>
            {mine && mine.breakdown && mine.breakdown.length > 0 && (
              <div className="mt-4">
                <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Your XI · player points</div>
                <div className="grid sm:grid-cols-2 gap-x-4 border border-zinc-200 rounded-lg overflow-hidden" data-testid="my-breakdown">
                  {mine.breakdown.map((b) => (
                    <div key={b.player_id} className="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-zinc-100" data-testid={`breakdown-${b.player_id}`}>
                      <span className="flex-1 truncate text-zinc-800 font-semibold">{b.name || "Player"}</span>
                      <span className="text-[10px] font-bold uppercase text-zinc-400">{b.team}</span>
                      {b.is_captain && <span className="text-[10px] font-extrabold text-amber-700">C ×2</span>}
                      {b.is_vice_captain && <span className="text-[10px] font-extrabold text-sky-700">VC ×1.5</span>}
                      <span className="text-zinc-400 tabular w-8 text-right">{b.base}</span>
                      <span className="font-extrabold text-zinc-900 tabular w-9 text-right">{b.points}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={load} className="rounded-full font-bold" data-testid="lb-refresh"><Clock size={14} className="mr-1" /> Refresh</Button>
          <Button onClick={onClose} className="rounded-full bg-emerald-600 hover:bg-emerald-700 font-bold">Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RulesDialog({ open, onClose }) {
  const [rules, setRules] = useState(null);
  useEffect(() => {
    if (!open || rules) return;
    api.get("/fantasy/points-rules").then(({ data }) => setRules(data)).catch(() => toast.error("Could not load points rules"));
  }, [open, rules]);
  const groups = rules?.rules || {};
  const names = { batting: "Batting", bowling: "Bowling", fielding: "Fielding", other: "Team & multipliers" };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="rules-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl font-extrabold tracking-tight flex items-center gap-2">
            <ShieldCheck size={22} weight="fill" className="text-emerald-600" /> Dream11-style points
          </DialogTitle>
          <DialogDescription>T20 scoring. Captain gets 2x and vice-captain 1.5x of a player's points.</DialogDescription>
        </DialogHeader>
        {!rules && <div className="text-sm text-zinc-500 py-4">Loading…</div>}
        {rules && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-2"><div className="text-[10px] font-bold uppercase text-zinc-500">Players</div><div className="font-extrabold text-zinc-900 tabular">{rules.team_size}</div></div>
              <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-2"><div className="text-[10px] font-bold uppercase text-zinc-500">Credits</div><div className="font-extrabold text-zinc-900 tabular">{rules.credit_budget}</div></div>
              <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-2"><div className="text-[10px] font-bold uppercase text-zinc-500">Max per side</div><div className="font-extrabold text-zinc-900 tabular">{rules.max_per_side}</div></div>
            </div>
            {Object.keys(names).map((key) => groups[key] && (
              <div key={key} data-testid={`rules-${key}`}>
                <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1.5">{names[key]}</div>
                <div className="divide-y divide-zinc-100 border border-zinc-200 rounded-lg overflow-hidden">
                  {groups[key].map(([label, pts]) => (
                    <div key={label} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                      <span className="text-zinc-700">{label}</span>
                      <span className={`font-extrabold tabular shrink-0 ${String(pts).startsWith("-") ? "text-red-600" : "text-emerald-700"}`}>{pts}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <p className="text-[11px] text-zinc-500">The admin posts each player's scorecard after the match; points and the leaderboard are then calculated automatically and prizes are credited to your wallet.</p>
          </div>
        )}
        <div className="flex justify-end mt-2">
          <Button onClick={onClose} className="rounded-full bg-emerald-600 hover:bg-emerald-700 font-bold" data-testid="rules-close">Got it</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
