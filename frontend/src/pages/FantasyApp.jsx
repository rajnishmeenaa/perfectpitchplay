import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { toast } from "sonner";
import { isNative, notificationPermission, syncReminders } from "../lib/notifications";
import { XiChip, XiBoard, XiAlerts } from "../components/xiNews";
import { PitchField, ChatThread, TURF } from "../components/turf";
import { Flag, Users, Lock, Trophy, ChartBar, Info, PencilSimple, Trash, Check, X, Clock, Plus, ShieldCheck, Medal, Broadcast, Sparkle, ShareNetwork, Wallet, ArrowsClockwise, CaretUp, CaretDown, ChartLine, Star, Eye, WarningCircle, CheckCircle, ArrowsLeftRight, ChatsCircle } from "@phosphor-icons/react";

const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const XI_OUT = ["rested", "injured", "dropped"];
const playerStatus = (p) => p?.status || (p?.playing === false ? "dropped" : "projected");
const isOutOfXi = (p) => XI_OUT.includes(playerStatus(p));
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

const COMPONENT_LABELS = {
  playing_xi: "in starting XI", runs: "runs", fours: "fours", sixes: "sixes",
  half_century: "50 bonus", century: "100 bonus", bronze_dinger: "30 bonus",
  strike_rate: "strike rate", batting_bonus: "batting bonus",
  wickets: "wickets", bowled_lbw: "bowled/lbw", four_wicket_haul: "4-wicket bonus",
  five_wicket_haul: "5-wicket bonus", maiden: "maiden over", economy: "economy",
  catching_bonus: "catching bonus", fielding_bonus: "fielding bonus",
  stumpings: "stumpings", run_out_direct: "direct run out", run_out_thrower: "run out throw",
};
const prettyComponent = (k) => COMPONENT_LABELS[k] || String(k).replace(/_/g, " ");

const StatusChip = ({ status }) => {
  const map = { upcoming: "bg-emerald-100 text-emerald-800", live: "bg-orange-100 text-orange-800", completed: "bg-zinc-200 text-zinc-700", abandoned: "bg-red-100 text-red-700" };
  return <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest ${map[status] || "bg-zinc-100 text-zinc-600"}`} data-testid={`match-status-${status}`}>{status === "upcoming" ? "upcoming" : status}</span>;
};

export default function FantasyApp({ config, walletBalance = 0, bonusBalance = 0, coinCfg = null, focusMatchId, entries = [], onJoinFantasy, onMoneyChanged }) {
  // Bonus cash pays entry fees too, so affordability uses the combined amount.
  const spendable = Number(walletBalance || 0) + Number(bonusBalance || 0);
  const [matches, setMatches] = useState([]);
  const [matchId, setMatchId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  // Keeps the phone's reminder schedule in sync: "build your XI" if we have no team
  // for a match yet, "locks in 10 minutes" once we do.
  const remind = (rows, coveredOverride = null) => {
    if (!isNative()) return;
    const covered = {};
    rows.forEach((m) => { covered[m.id] = (m.my_teams_count || 0) > 0; });
    if (coveredOverride) Object.assign(covered, coveredOverride);
    syncReminders(rows, covered);
  };

  const loadMatches = async () => {
    try {
      const { data } = await api.get("/matches");
      // Open matches first; completed/locked ones sink to the bottom as history.
      const ordered = [...data].sort((a, b) => (a.locked === b.locked ? new Date(a.start_time) - new Date(b.start_time) : a.locked ? 1 : -1));
      setMatches(ordered);
      setMatchId((cur) => cur || focusMatchId || (ordered[0] && ordered[0].id) || null);
      if (isNative()) notificationPermission(); // asks once, here because the user is opting into fantasy
      remind(ordered);
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
      const hasTeam = (data.my_teams || []).length > 0
        || (data.contests || []).some((c) => (c.my_entries || []).length > 0);
      remind(matches, { [id]: hasTeam });
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

      <XiAlerts onFixed={() => { loadDetail(matchId); onMoneyChanged?.(); }} />

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
          walletBalance={spendable}
          coinCfg={coinCfg}
          onJoinFantasy={onJoinFantasy}
          onMoneyChanged={onMoneyChanged}
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
      className={`text-left bg-white border rounded-lg p-5 transition-all hover:-translate-y-0.5 ${active ? "border-turf ring-2 ring-emerald-100" : "border-zinc-200 hover:border-emerald-300"}`}
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
      {cd && match.status === "upcoming" && (
        <div className={`mt-3 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-bold tabular ${cd.over ? "bg-zinc-100 text-zinc-600" : cd.urgent ? "bg-red-50 text-red-700 border border-red-200" : "bg-orange-50 text-orange-800"}`} data-testid={`match-countdown-${match.id}`}>
          <Clock size={13} weight="bold" /> {cd.over ? cd.text : `Starts in ${cd.text}`}
        </div>
      )}
      {match.status !== "upcoming" && (
        <div className={`mt-3 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-bold ${match.status === "live" ? "bg-red-600 text-white" : "bg-zinc-100 text-zinc-600"}`} data-testid={`match-state-${match.status}`}>
          <Broadcast size={13} weight="fill" /> {match.status === "live" ? "Match is live now" : "Match finished"}
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

function MatchWorkspace({ detail, reload, config, walletBalance, coinCfg = null, onJoinFantasy, onMoneyChanged }) {
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

      <LiveCentre match={match} />

      <Tabs defaultValue="build" className="w-full">
        <TabsList className="bg-zinc-100 border border-zinc-200 rounded-full p-1 h-auto">
          <TabsTrigger value="build" className="rounded-full data-[state=active]:bg-turf data-[state=active]:text-white px-4 py-1.5 text-sm font-bold" data-testid="fsub-tab-build">
            <Plus size={15} weight="bold" className="mr-1.5" /> Build team
          </TabsTrigger>
          <TabsTrigger value="teams" className="rounded-full data-[state=active]:bg-turf data-[state=active]:text-white px-4 py-1.5 text-sm font-bold" data-testid="fsub-tab-teams">
            <Users size={15} weight="bold" className="mr-1.5" /> My teams ({my_teams.length})
          </TabsTrigger>
          <TabsTrigger value="contests" className="rounded-full data-[state=active]:bg-turf data-[state=active]:text-white px-4 py-1.5 text-sm font-bold" data-testid="fsub-tab-contests">
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
            coinCfg={coinCfg}
            onJoinFantasy={onJoinFantasy}
            onMoneyChanged={onMoneyChanged}
            onReload={reload}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RunRateChart({ series }) {
  if (!series || series.length < 2) return null;
  const w = 600, h = 120, pad = 6;
  const maxRuns = Math.max(...series.map((p) => Number(p.runs) || 0), 1);
  const maxWk = Math.max(...series.map((p) => Number(p.wickets) || 0), 1);
  const x = (i) => pad + (i * (w - pad * 2)) / (series.length - 1);
  const y = (v, max) => h - pad - (v / max) * (h - pad * 2);
  const line = series.map((p, i) => `${x(i).toFixed(1)},${y(Number(p.runs) || 0, maxRuns).toFixed(1)}`).join(" ");
  return (
    <div className="mt-3" data-testid="run-rate-chart">
      <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-1">Runs and wickets per over</div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-24 bg-zinc-900 rounded-md" role="img" aria-label="run rate graph">
        <polyline points={line} fill="none" stroke={TURF.neonAir} strokeWidth="2.5" />
        {series.map((p, i) => (Number(p.wickets) ? (
          <circle key={`w${i}`} cx={x(i)} cy={y(Number(p.wickets), maxWk)} r="3.5" fill={TURF.fire} />
        ) : null))}
      </svg>
      <div className="flex justify-between text-[10px] text-zinc-500 tabular mt-1">
        <span>over {series[0].over}</span>
        <span className="text-red-400">{maxWk} wkt</span>
        <span>over {series[series.length - 1].over} · {maxRuns} runs</span>
      </div>
    </div>
  );
}

const ballSkin = (e) => {
  if (e.wicket) return "bg-red-600 text-white border-red-500";
  if (Number(e.runs) === 6) return "bg-violet-600 text-white border-violet-500";
  if (Number(e.runs) === 4) return "bg-amber-400 text-amber-950 border-amber-300";
  if (!Number(e.runs)) return "bg-zinc-800 text-zinc-300 border-zinc-700";
  return "bg-zinc-700 text-white border-zinc-600";
};

function LiveCentre({ match }) {
  const [live, setLive] = useState(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState("ticker");
  const [filter, setFilter] = useState("all");
  const interesting = ["live", "completed"].includes(match.status) || match.auto_live;

  const load = async () => {
    try {
      const { data } = await api.get(`/matches/${match.id}/live`);
      setLive(data);
    } catch (e) { /* keep whatever we already had on screen */ }
  };

  useEffect(() => {
    if (!interesting) return undefined;
    load(); // eslint-disable-next-line
    const t = setInterval(load, match.status === "live" ? 30000 : 300000);
    return () => clearInterval(t);
  }, [match.id, match.status, interesting]);

  const refresh = async () => { setBusy(true); await load(); setBusy(false); };

  const events = live?.events || [];
  const shown = useMemo(() => {
    let list = [...events].reverse();
    if (filter === "mine") list = list.filter((e) => e.mine);
    if (filter === "wickets") list = list.filter((e) => e.wicket);
    if (filter === "boundaries") list = list.filter((e) => e.boundary || Number(e.runs) >= 4);
    return list.slice(0, 40);
  }, [events, filter]);
  const lastOver = events.length ? String(events[events.length - 1].over ?? "") : "";
  const thisOver = events.filter((e) => String(e.over ?? "") === lastOver);

  if (!interesting) return null;

  const views = [
    { key: "ticker", label: "Ball by ball", icon: Broadcast },
    { key: "card", label: "Scorecard", icon: ChartLine },
    { key: "mine", label: "My rank", icon: Medal },
  ];
  const filters = [
    { key: "all", label: "All balls" }, { key: "mine", label: "My players" },
    { key: "wickets", label: "Wickets" }, { key: "boundaries", label: "Boundaries" },
  ];

  return (
    <div className="bg-zinc-950 text-white rounded-lg p-4" data-testid="live-strip">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-widest rounded px-2 py-1 ${match.status === "live" ? "bg-red-600 text-white animate-pulse" : "bg-zinc-800 text-zinc-300"}`} data-testid="live-badge">
          <Broadcast size={11} weight="fill" /> {match.status === "live" ? "live" : match.status}
        </span>
        <span className="text-sm font-bold truncate" data-testid="live-status-text">{live?.status_text || "Score not published yet"}</span>
        {live?.venue && <span className="text-[11px] text-zinc-400 truncate">{live.venue}</span>}
        <button type="button" onClick={refresh} disabled={busy} className="ml-auto text-[11px] font-bold text-zinc-300 hover:text-white flex items-center gap-1 disabled:opacity-50" data-testid="live-refresh">
          <ArrowsClockwise size={13} weight="bold" className={busy ? "animate-spin" : ""} /> {busy ? "Refreshing" : "Refresh"}
        </button>
      </div>

      {live?.available && (
        <div className="flex flex-wrap gap-2 mt-3">
          {(live.innings || []).map((row, i) => (
            <div key={`${row.innings}-${i}`} className="bg-zinc-800/80 rounded-md px-3 py-2 min-w-[132px]" data-testid={`live-innings-${i}`}>
              <div className="text-[10px] uppercase tracking-widest text-zinc-400 truncate">{row.innings || `Innings ${i + 1}`}</div>
              <div className="text-lg font-extrabold tabular">{row.runs}<span className="text-zinc-400">/{row.wickets}</span></div>
              {row.overs ? <div className="text-[11px] text-zinc-400 tabular">{row.overs} ov</div> : null}
            </div>
          ))}
          {(live.top_performers || []).slice(0, 3).map((p) => (
            <div key={p.name} className="bg-zinc-800/50 rounded-md px-3 py-2" data-testid={`live-top-${p.name}`}>
              <div className="text-[10px] uppercase tracking-widest text-emerald-400">{p.team} · {p.role}</div>
              <div className="text-sm font-bold truncate max-w-[130px]">{p.name}</div>
              <div className="text-[11px] text-orange-400 font-extrabold tabular">{p.points} pts</div>
            </div>
          ))}
        </div>
      )}

      {!live?.available && (
        <p className="text-[11px] text-zinc-400 mt-2" data-testid="live-empty-hint">
          The admin has not pushed a live update for this match yet — it appears here automatically once they do.
        </p>
      )}

      {live?.available && (
        <>
          <div className="flex gap-1.5 mt-4">
            {views.map(({ key, label, icon: Icon }) => (
              <button key={key} type="button" onClick={() => setView(key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-extrabold uppercase tracking-wider transition-colors ${view === key ? "bg-turf text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}
                data-testid={`live-view-${key}`}>
                <Icon size={13} weight="bold" /> {label}
              </button>
            ))}
          </div>

          {view === "ticker" && (
            <div className="mt-3" data-testid="live-ticker">
              {thisOver.length > 0 && (
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Over {lastOver}</span>
                  <div className="flex gap-1 flex-wrap">
                    {thisOver.map((e, i) => (
                      <span key={i} className={`w-6 h-6 rounded-full border text-[10px] font-extrabold flex items-center justify-center tabular ${ballSkin(e)}`}
                        data-testid={`over-dot-${i}`}>{e.wicket ? "W" : e.runs}</span>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-1.5 flex-wrap">
                {filters.map((f) => (
                  <button key={f.key} type="button" onClick={() => setFilter(f.key)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors ${filter === f.key ? "bg-white text-zinc-900 border-white" : "bg-transparent text-zinc-300 border-zinc-700 hover:border-zinc-500"}`}
                    data-testid={`ticker-filter-${f.key}`}>{f.label}</button>
                ))}
                <span className="ml-auto text-[10px] text-zinc-500 tabular self-center">{events.length} balls received</span>
              </div>
              {shown.length === 0 ? (
                <p className="text-[11px] text-zinc-400 mt-3" data-testid="ticker-empty">
                  No balls to show for this filter yet — the score service has not sent ball-by-ball data for this match.
                </p>
              ) : (
                <div className="mt-2 max-h-64 overflow-y-auto divide-y divide-zinc-800 rounded-md bg-zinc-900/60">
                  {shown.map((e, i) => (
                    <div key={`${e.over}-${e.ball}-${i}`} className={`flex items-center gap-2 px-3 py-2 text-xs ${e.mine ? "bg-emerald-900/30" : ""}`} data-testid={`event-${i}`}>
                      <span className={`w-7 h-7 shrink-0 rounded-full border text-[10px] font-extrabold flex items-center justify-center tabular ${ballSkin(e)}`}>
                        {e.wicket ? "W" : (e.runs ?? "·")}
                      </span>
                      <span className="text-[10px] text-zinc-500 tabular w-10 shrink-0">{e.over}.{e.ball}</span>
                      <span className={`flex-1 truncate ${e.wicket ? "text-red-300 font-bold" : "text-zinc-200"}`}>{e.text || "ball"}</span>
                      {e.mine && <span className="text-[9px] font-extrabold uppercase text-emerald-400 shrink-0" data-testid="event-mine-tag">your XI</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {view === "card" && (
            <div className="mt-3" data-testid="live-scorecard">
              {(live.tables || []).map((t, i) => (
                <div key={`${t.innings}-${i}`} className="mb-4" data-testid={`innings-table-${i}`}>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 mb-1.5">{t.innings}</div>
                  <div className="overflow-x-auto rounded-md bg-zinc-900/60">
                    <table className="w-full text-[11px]">
                      <thead className="text-zinc-400 uppercase tracking-wider">
                        <tr><th className="text-left px-3 py-1.5 font-bold">Batter</th><th className="text-right px-2">R</th><th className="text-right px-2">B</th><th className="text-right px-2">4</th><th className="text-right px-2">6</th><th className="text-right px-3">SR</th></tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800">
                        {(t.batting || []).map((b) => (
                          <tr key={b.player_id || b.name} className={b.player_id ? "" : "text-zinc-500"} data-testid={`bat-row-${b.player_id || b.name}`}>
                            <td className="text-left px-3 py-1.5 font-semibold text-zinc-100 truncate max-w-[150px]">
                              {b.name}{b.out ? "" : "*"}
                              {b.player_id && (live.my_player_ids || []).includes(b.player_id) && <span className="ml-1 text-[9px] font-extrabold text-emerald-400">YOUR XI</span>}
                            </td>
                            <td className="text-right tabular">{b.runs}</td>
                            <td className="text-right tabular text-zinc-400">{b.balls}</td>
                            <td className="text-right tabular text-zinc-400">{b.fours}</td>
                            <td className="text-right tabular text-zinc-400">{b.sixes}</td>
                            <td className="text-right px-3 tabular text-zinc-300">{b.strike_rate}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {(t.bowling || []).length > 0 && (
                    <div className="overflow-x-auto rounded-md bg-zinc-900/60 mt-2">
                      <table className="w-full text-[11px]">
                        <thead className="text-zinc-400 uppercase tracking-wider">
                          <tr><th className="text-left px-3 py-1.5 font-bold">Bowler</th><th className="text-right px-2">O</th><th className="text-right px-2">M</th><th className="text-right px-2">R</th><th className="text-right px-2">W</th><th className="text-right px-3">Econ</th></tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800">
                          {(t.bowling || []).map((b) => (
                            <tr key={b.player_id || b.name} className={b.player_id ? "" : "text-zinc-500"} data-testid={`bowl-row-${b.player_id || b.name}`}>
                              <td className="text-left px-3 py-1.5 font-semibold text-zinc-100 truncate max-w-[150px]">
                                {b.name}
                                {b.player_id && (live.my_player_ids || []).includes(b.player_id) && <span className="ml-1 text-[9px] font-extrabold text-emerald-400">YOUR XI</span>}
                              </td>
                              <td className="text-right tabular">{b.overs}</td>
                              <td className="text-right tabular text-zinc-400">{b.maidens}</td>
                              <td className="text-right tabular text-zinc-400">{b.runs}</td>
                              <td className="text-right tabular font-bold">{b.wickets}</td>
                              <td className="text-right px-3 tabular text-zinc-300">{b.economy}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
              <RunRateChart series={live.run_rate || []} />
              {!live.tables?.length && <p className="text-[11px] text-zinc-400">No player lines received yet.</p>}
            </div>
          )}

          {view === "mine" && (
            <div className="mt-3" data-testid="live-mine">
              {live.star && (
                <div className="flex items-center gap-3 bg-orange-500/15 border border-orange-500/40 rounded-md px-3 py-2 mb-3" data-testid="live-star">
                  <Star size={18} weight="fill" className="text-orange-400" />
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-orange-300">Top performer</div>
                    <div className="text-sm font-extrabold truncate">{live.star.name} · {live.star.points} pts</div>
                  </div>
                </div>
              )}
              {(live.my_positions || []).length === 0 ? (
                <p className="text-[11px] text-zinc-400">You have no approved entry in this match yet.</p>
              ) : (
                <div className="grid sm:grid-cols-2 gap-2">
                  {live.my_positions.map((p) => (
                    <div key={p.contest_id} className="bg-zinc-900/70 border border-zinc-800 rounded-md px-3 py-2.5" data-testid={`my-position-${p.contest_id}`}>
                      <div className="text-[10px] uppercase tracking-widest text-zinc-400 truncate">{p.contest_title || "contest"}</div>
                      <div className="flex items-baseline gap-2 mt-0.5">
                        <span className="text-xl font-extrabold tabular" data-testid={`my-rank-${p.contest_id}`}>#{p.rank || "—"}</span>
                        <span className="text-[11px] text-zinc-400">of {p.entries || "?"}</span>
                        {!!p.rank_delta && (
                          <span className={`flex items-center gap-0.5 text-[11px] font-extrabold tabular ${p.rank_delta > 0 ? "text-emerald-400" : "text-red-400"}`} data-testid={`rank-move-${p.contest_id}`}>
                            {p.rank_delta > 0 ? <CaretUp size={12} weight="fill" /> : <CaretDown size={12} weight="fill" />}
                            {Math.abs(p.rank_delta)} since last update
                          </span>
                        )}
                        <span className="ml-auto text-sm font-bold text-orange-400 tabular">{p.points ?? 0} pts</span>
                      </div>
                      {p.top_points != null && p.points != null && (
                        <div className="text-[10px] text-zinc-400 mt-1 tabular" data-testid={`gap-${p.contest_id}`}>
                          {p.points >= p.top_points ? "Leading the contest" : `${(p.top_points - p.points).toFixed(1)} pts off the leader`}
                        </div>
                      )}
                      <div className="text-[10px] text-zinc-500 mt-1 truncate">{p.team_name}</div>
                    </div>
                  ))}
                </div>
              )}
              {(live.my_players || []).length > 0 && (
                <div className="mt-3">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-1.5">Your players across saved XIs</div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                    {live.my_players.map((p) => (
                      <div key={p.player_id} className="flex items-center gap-2 text-[11px] border-b border-zinc-800 py-1" data-testid={`my-player-${p.player_id}`}>
                        <span className="flex-1 truncate text-zinc-200 font-semibold">{p.name}</span>
                        <span className="text-zinc-500">{p.role}</span>
                        <span className="tabular font-extrabold text-orange-400">{p.points}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {live?.available && live.updated_at && (
        <p className="text-[10px] text-zinc-500 mt-3 tabular" data-testid="live-updated">
          Updated {new Date(live.updated_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
          {live.partial ? " · mid-match totals, final after the scorecard" : ""}
          {live.error ? ` · ${live.error}` : ""}
        </p>
      )}
    </div>
  );
}

function tally(players, ids) {
  const picked = ids.map((id) => players.find((p) => p.id === id)).filter(Boolean);
  const roles = { WK: 0, BAT: 0, AR: 0, BOWL: 0 };
  const sides = {};
  let credits = 0, projection = 0;
  picked.forEach((p) => { roles[p.role] = (roles[p.role] || 0) + 1; sides[p.team] = (sides[p.team] || 0) + 1; credits += Number(p.credits || 0); projection += Number(p.projection || 0); });
  return { roles, sides, credits: Math.round(credits * 100) / 100, projection: Math.round(projection), picked };
}

function builderWarnings(t, ids, captain, vice, sides) {
  const out = [];
  ROLES.forEach((r) => {
    const [lo, hi] = LIMITS[r];
    const n = t.roles[r] || 0;
    if (n > hi) out.push(`Too many ${ROLE_LABEL[r].toLowerCase()}s — the cap is ${hi}`);
    else if (ids.length === TEAM_SIZE && n < lo) out.push(`Needs ${lo} ${ROLE_LABEL[r].toLowerCase()}${lo > 1 ? "s" : ""}, you have ${n}`);
  });
  const seats = TEAM_SIZE - ids.length;
  const owed = ROLES.reduce((a, r) => a + Math.max(0, LIMITS[r][0] - (t.roles[r] || 0)), 0);
  if (seats >= 0 && owed > seats) out.push(`${seats} seat${seats === 1 ? "" : "s"} left but ${owed} mandatory role${owed === 1 ? "" : "s"} still owed`);
  if (t.credits > CREDIT_BUDGET) out.push(`Over budget by ${(t.credits - CREDIT_BUDGET).toFixed(1)} credits`);
  const full = sides.find((s) => (t.sides[s] || 0) >= MAX_PER_SIDE);
  if (full && seats > 0) out.push(`Already using ${MAX_PER_SIDE} from ${full} — the rest must come from the other side`);
  if (ids.length === TEAM_SIZE && (!captain || !vice)) out.push("Pick a captain and a different vice-captain");
  return out;
}

function TeamBuilder({ match, players, byTeam, sides, myTeams, draft, setDraft, onSaved }) {
  const { ids, captain, vice, name, editingId } = draft;
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [view, setView] = useState("pitch");
  const [busy, setBusy] = useState(false);
  const [infoId, setInfoId] = useState(null);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const t = tally(players, ids);
  const warnings = builderWarnings(t, ids, captain, vice, sides);
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

  const autoPick = async () => {
    setBusy(true);
    try {
      const { data } = await api.get(`/fantasy/suggested-team?match_id=${match.id}`);
      set({ ids: data.player_ids, captain: data.captain_id, vice: data.vice_captain_id, name: data.name, editingId: null });
      toast.success(`Auto-picked on ${data.basis === "projection" ? "the admin's projections" : "credit weight"} — ${data.credits_used}/${CREDIT_BUDGET} credits`);
      (data.warnings || []).forEach((w) => toast(w));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not auto-build a team");
    } finally {
      setBusy(false);
    }
  };

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

  const outPicks = ids.filter((id) => isOutOfXi(players.find((p) => p.id === id)));

  return (
    <div className="space-y-4">
      <XiBoard matchId={match.id} />
      {outPicks.length > 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-2.5 text-[13px] font-bold text-red-800" data-testid="xi-pick-warning">
          <WarningCircle size={14} weight="fill" className="inline mr-1.5 -mt-0.5" />
          {outPicks.length} of your picks {outPicks.length === 1 ? "is" : "are"} not in the announced XI — they score nothing but the +4 playing-XI bonus.
        </div>
      )}
      <div className="grid lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2 bg-white border border-zinc-200 rounded-lg" data-testid="squad-picker">
        <div className="p-4 border-b border-zinc-100 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-full border border-ink-line bg-ink-soft p-0.5" data-testid="builder-view">
            {[["pitch", "Pitch"], ["list", "List"]].map(([key, label]) => (
              <button key={key} type="button" onClick={() => setView(key)}
                data-testid={`view-${key}`}
                className={`px-3 py-1 rounded-full text-[11px] font-extrabold uppercase tracking-wider transition-colors ${
                  view === key ? "bg-turf text-white" : "text-zinc-500 hover:text-zinc-900"
                }`}>
                {label}
              </button>
            ))}
          </div>
          <button type="button" onClick={autoPick} disabled={locked || busy}
            className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-3 py-1 hover:bg-violet-100 disabled:opacity-40"
            data-testid="auto-pick-btn">
            <Sparkle size={13} weight="fill" /> Auto-pick XI
          </button>
          {view === "list" && (
          <div className="flex gap-1 ml-auto">
            {["ALL", ...ROLES].map((r) => (
              <button key={r} type="button" onClick={() => setRoleFilter(r)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors ${roleFilter === r ? "bg-turf text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"}`}
                data-testid={`role-filter-${r}`}>{r}</button>
            ))}
          </div>
          )}
        </div>
        {view === "pitch" ? (
          <PitchField
            players={players}
            pickedIds={ids}
            captain={captain}
            vice={vice}
            onToggle={toggle}
            budget={CREDIT_BUDGET}
            perSide={t.sides}
            locked={locked}
            outIds={players.filter((p) => isOutOfXi(p)).map((p) => p.id)}
          />
        ) : (
        <div className="divide-y divide-zinc-100 max-h-[520px] overflow-y-auto">
          {sides.map((side) => (
            <div key={side}>
              <div className="px-4 py-2 bg-zinc-50 text-xs font-extrabold uppercase tracking-widest text-zinc-600 sticky top-0">
                {side} · {t.sides[side] || 0}/{MAX_PER_SIDE} picked
              </div>
              {(byTeam[side] || []).filter((p) => roleFilter === "ALL" || p.role === roleFilter).map((p) => (
                <PlayerRow key={p.id} player={p} picked={ids.includes(p.id)} disabled={locked}
                  onToggle={() => toggle(p)} onInfo={() => setInfoId(p.id)} />
              ))}
            </div>
          ))}
        </div>
        )}
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

          <div className="mt-4" data-testid="credits-meter">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">
              <span>Credits used</span>
              <span className="tabular" data-testid="credits-readout">{t.credits} / {CREDIT_BUDGET}</span>
            </div>
            <div className="h-2 rounded-full bg-zinc-100 overflow-hidden">
              <div className={`h-full rounded-full transition-all ${t.credits > CREDIT_BUDGET ? "bg-red-500" : t.credits > 95 ? "bg-amber-500" : "bg-neon"}`}
                style={{ width: `${Math.min(100, (t.credits / CREDIT_BUDGET) * 100)}%` }} data-testid="credits-bar" />
            </div>
            <div className="flex items-center justify-between text-[10px] text-zinc-500 mt-1 tabular">
              <span data-testid="credits-left">{Math.max(0, CREDIT_BUDGET - t.credits).toFixed(1)} left · {ids.length}/{TEAM_SIZE} picked</span>
              <span data-testid="projection-total" className="font-bold text-violet-700">projected {t.projection} pts</span>
            </div>
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
            className="mt-4 w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm text-zinc-800 focus:outline-none focus:ring-2 focus:ring-turf"
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
                    <button type="button" onClick={() => setInfoId(p.id)} className="p-1 rounded text-zinc-400 hover:text-violet-700" title="Form and value"
                      data-testid={`leaders-info-${p.id}`}><Eye size={14} weight="bold" /></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Button disabled={!ready || busy} onClick={save} className="turf-cta mt-5 w-full rounded-full border-0 active:scale-95" data-testid="save-team-btn">
            {locked ? <><Lock size={16} weight="bold" className="mr-1" /> Teams locked</> : busy ? "Saving…" : <><Check size={16} weight="bold" className="mr-1" /> {editingId ? "Update team" : "Save team"}</>}
          </Button>
          {!ready && !locked && ids.length > 0 && warnings.length === 0 && (
            <p className="text-[11px] text-zinc-500 mt-2" data-testid="team-hint">
              Pick {TEAM_SIZE} players with valid role counts{captain && vice ? "" : " · set captain and vice-captain"}
            </p>
          )}
          {warnings.length > 0 && (
            <ul className="mt-3 space-y-1" data-testid="builder-warnings">
              {warnings.map((w) => (
                <li key={w} className="flex items-start gap-1.5 text-[11px] font-semibold text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1" data-testid="builder-warning">
                  <WarningCircle size={13} className="mt-0.5 shrink-0" /> {w}
                </li>
              ))}
            </ul>
          )}
          {warnings.length === 0 && ids.length === TEAM_SIZE && (
            <p className="mt-3 flex items-center gap-1.5 text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2 py-1" data-testid="builder-ok">
              <CheckCircle size={14} /> Legal XI with {(CREDIT_BUDGET - t.credits).toFixed(1)} credits spare
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

        {infoId && <PlayerSheet playerId={infoId} onClose={() => setInfoId(null)} />}
        </div>
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

function PlayerRow({ player, picked, disabled, onToggle, onInfo }) {
  const live = player.points != null && player.points !== 0;
  return (
    <div className={`flex items-center gap-1 px-4 py-1 transition-colors ${picked ? "bg-turf/5" : "hover:bg-zinc-50"}`}>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className="flex-1 flex items-center gap-3 text-left disabled:opacity-50"
        data-testid={`player-row-${player.id}`}
      >
        <span className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${picked ? "bg-turf border-turf text-white" : "border-zinc-300 text-transparent"}`}>
          <Check size={12} weight="bold" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-zinc-900 truncate">
            {player.name}
            <XiChip status={playerStatus(player)} note={player.status_note} testid={`xi-chip-${player.id}`} className="ml-1.5 align-middle" />
          </span>
          <span className={`inline-block mt-0.5 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${ROLE_SKIN[player.role]}`}>{ROLE_LABEL[player.role]}</span>
        </span>
        {player.projection > 0 && <span className="text-[10px] font-bold text-violet-700 tabular shrink-0" data-testid={`player-proj-${player.id}`}>{player.projection} proj</span>}
        {live && <span className="text-[11px] font-extrabold text-orange-700 tabular" data-testid={`player-points-${player.id}`}>{player.points} pts</span>}
        <span className="text-xs font-extrabold text-zinc-600 tabular shrink-0" data-testid={`player-credits-${player.id}`}>{player.credits}</span>
      </button>
      <button type="button" onClick={onInfo}
        className="p-1.5 rounded-md text-zinc-400 hover:text-violet-700 hover:bg-violet-50 shrink-0" title="Form, value and role rank"
        data-testid={`player-info-${player.id}`}>
        <Eye size={15} weight="bold" />
      </button>
    </div>
  );
}

function PlayerSheet({ playerId, onClose }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setD(null); setError("");
    api.get(`/players/${playerId}/insight`)
      .then(({ data }) => { if (alive) setD(data); })
      .catch((e) => { if (alive) setError(e?.response?.data?.detail || "Could not load this player"); });
    return () => { alive = false; };
  }, [playerId]);

  const p = d?.player;
  const verdictSkin = {
    "good value": "bg-emerald-50 border-emerald-200 text-emerald-800",
    fair: "bg-zinc-50 border-zinc-200 text-zinc-700",
    expensive: "bg-amber-50 border-amber-200 text-amber-800",
    "no projection set": "bg-zinc-50 border-zinc-200 text-zinc-500",
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg" data-testid="player-sheet">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl font-extrabold tracking-tight">
            {p?.name || "Player"}
            {p && <span className="ml-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">{p.team} · {ROLE_LABEL[p.role]}</span>}
          </DialogTitle>
          <DialogDescription>{d?.match ? `${d.match.label}${d.match.venue ? ` · ${d.match.venue}` : ""}` : "Selection help"}</DialogDescription>
        </DialogHeader>

        {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2" data-testid="sheet-error">{error}</div>}
        {!d && !error && <div className="text-sm text-zinc-500 py-6 text-center">Loading player…</div>}

        {d && (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Credits" value={d.player.credits} ok testId="sheet-credits" />
              <Stat label="Projection" value={d.player.projection || "—"} ok={!!d.player.projection} testId="sheet-projection" />
              <Stat label="Pts / credit" value={d.value_per_credit || "—"} ok={d.value_per_credit > 0} testId="sheet-value" />
            </div>
            <div className={`mt-3 flex items-center gap-2 border rounded-md px-3 py-2 text-xs font-bold ${verdictSkin[d.value_verdict] || verdictSkin.fair}`} data-testid="sheet-verdict">
              {d.value_verdict === "good value" ? <CheckCircle size={14} /> : <WarningCircle size={14} />}
              {d.value_verdict === "no projection set"
                ? "The organiser has not projected this player — Auto-pick falls back to credits."
                : `${d.value_verdict} · squad median ${d.squad_median_value} pts per credit`}
            </div>
            {!!d.role_rank && (
              <p className="text-[11px] text-zinc-600 mt-2" data-testid="sheet-role-rank">
                Ranked <b className="tabular">{d.role_rank}</b> of {d.role_peers} {ROLE_LABEL[d.player.role].toLowerCase()}s on projected points in this match.
              </p>
            )}
            <div className="mt-4">
              <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">
                Recent form {d.innings ? `· ${d.innings} innings, avg ${d.avg_points}, best ${d.best_points}` : ""}
              </div>
              {(!d.form || d.form.length === 0) ? (
                <p className="text-[11px] text-zinc-500 border border-dashed border-zinc-200 rounded-md px-3 py-2" data-testid="sheet-no-form">
                  No completed scorecard for this player yet — projection and credits are all we have.
                </p>
              ) : (
                <div className="divide-y divide-zinc-100 border border-zinc-200 rounded-md overflow-hidden">
                  {d.form.map((f) => (
                    <div key={f.match_id} className="flex items-center gap-2 px-3 py-1.5 text-xs" data-testid={`sheet-form-${f.match_id}`}>
                      <span className="flex-1 truncate font-semibold text-zinc-800">{f.match}</span>
                      <span className="text-zinc-500 tabular">{f.runs}*</span>
                      <span className="text-zinc-500 tabular">{f.wickets} wkt</span>
                      <span className="font-extrabold text-orange-700 tabular">{f.points} pts</span>
                      {!f.final && <span className="text-[9px] font-extrabold uppercase text-amber-700">live</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <p className="text-[10px] text-zinc-400 mt-3">
              Projections are set by the organiser and also drive Auto-pick. Points come from the published scorecard.
            </p>
          </>
        )}
        <div className="flex justify-end mt-4">
          <Button onClick={onClose} className="rounded-full bg-turf hover:bg-turf-red-dark font-bold">Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MyTeams({ teams, players, match, onReload }) {
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cmp, setCmp] = useState(null);
  const [a, setA] = useState(teams[0] ? teams[0].id : "");
  const [b, setB] = useState(teams[1] ? teams[1].id : "");
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

  const share = async (tm) => {
    const rows = (tm.players || []).filter(Boolean).map((p) => {
      const tag = p.id === tm.captain_id ? " (C)" : p.id === tm.vice_captain_id ? " (VC)" : "";
      return `• ${p.name}${tag} — ${p.role}`;
    });
    const text = `${tm.name} · ${match.team_a_short} vs ${match.team_b_short}\n${rows.join("\n")}\n\nBuild yours on Sapna11 and play the same match.`;
    try {
      if (navigator.share) {
        await navigator.share({ title: tm.name, text });
        return;
      }
    } catch (e) { /* user dismissed the sheet */ }
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Team copied — paste it in your group");
    } catch (e) {
      toast("Could not copy on this device");
    }
  };
  return (
    <div className="grid md:grid-cols-2 gap-4">
      {teams.length > 1 && (
        <div className="md:col-span-2 bg-white border border-violet-200 rounded-lg p-4 flex flex-wrap items-center gap-2" data-testid="compare-panel">
          <ArrowsLeftRight size={16} weight="bold" className="text-violet-600" />
          <span className="text-sm font-bold text-zinc-900">Compare two of your XIs</span>
          <select value={a} onChange={(e) => setA(e.target.value)} className="rounded-md border border-zinc-200 px-2 py-1.5 text-xs font-bold" data-testid="compare-a">
            {teams.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
          </select>
          <span className="text-xs text-zinc-400 font-bold">vs</span>
          <select value={b} onChange={(e) => setB(e.target.value)} className="rounded-md border border-zinc-200 px-2 py-1.5 text-xs font-bold" data-testid="compare-b">
            {teams.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
          </select>
          <Button size="sm" disabled={a === b || !a || !b} onClick={() => setCmp({ a, b })}
            className="ml-auto rounded-full bg-violet-600 hover:bg-violet-700 text-white font-bold active:scale-95" data-testid="compare-btn">
            Compare
          </Button>
        </div>
      )}
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
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" onClick={() => share(tm)} className="p-1.5 rounded text-zinc-400 hover:text-emerald-700" title="Share this XI" data-testid={`share-team-${tm.id}`}>
                  <ShareNetwork size={16} weight="bold" />
                </button>
                <button type="button" disabled={busy || !!match.locked} onClick={() => remove(tm.id)} className="p-1.5 rounded text-zinc-400 hover:text-red-600 disabled:opacity-40" title="Delete team" data-testid={`delete-team-${tm.id}`}>
                  <Trash size={16} weight="bold" />
                </button>
              </div>
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
      {cmp && <CompareDialog pair={cmp} teams={teams} onClose={() => setCmp(null)} />}
    </div>
  );
}

function CompareDialog({ pair, teams, onClose }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api.get(`/fantasy/teams/${pair.a}/compare/${pair.b}`)
      .then(({ data }) => { if (alive) setD(data); })
      .catch((e) => { if (alive) setError(e?.response?.data?.detail || "Could not compare these teams"); });
    return () => { alive = false; };
  }, [pair.a, pair.b]);

  const nameOf = (id) => (teams.find((t) => t.id === id) || {}).name || "Team";
  const side = (t) => (
    <div className="flex-1 bg-zinc-50 border border-zinc-200 rounded-md px-3 py-2" data-testid={`cmp-side-${t.id}`}>
      <div className="text-sm font-extrabold text-zinc-900 truncate">{t.name}</div>
      <div className="text-[11px] text-zinc-500 tabular">{t.credits_used} credits · C {t.captain || "—"} · VC {t.vice_captain || "—"}</div>
      <div className="mt-1 text-lg font-heading font-extrabold tabular text-zinc-950" data-testid={`cmp-points-${t.id}`}>
        {t.points == null ? <span className="text-xs text-zinc-400 font-bold">points after the scorecard</span> : `${t.points} pts`}
      </div>
    </div>
  );

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="compare-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl font-extrabold tracking-tight flex items-center gap-2">
            <ArrowsLeftRight size={20} weight="bold" className="text-violet-600" /> {nameOf(pair.a)} vs {nameOf(pair.b)}
          </DialogTitle>
          <DialogDescription>
            {d ? `${d.match.label} · ${d.shared_count} picks in common, ${d.differ_count} differ` : "Where your two teams part ways"}
          </DialogDescription>
        </DialogHeader>

        {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2" data-testid="cmp-error">{error}</div>}
        {!d && !error && <div className="text-sm text-zinc-500 py-6 text-center">Comparing…</div>}

        {d && (
          <>
            <div className="flex flex-wrap gap-2">
              {side(d.team_a)}
              {side(d.team_b)}
            </div>
            {d.swing != null && (
              <p className={`mt-3 text-xs font-bold rounded-md px-3 py-2 border ${d.swing === 0 ? "bg-zinc-50 border-zinc-200 text-zinc-700" : d.swing > 0 ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-amber-50 border-amber-200 text-amber-900"}`} data-testid="cmp-swing">
                {d.swing === 0 ? "Dead heat — both XIs scored the same." : `${nameOf(d.swing > 0 ? pair.a : pair.b)} is ahead by ${Math.abs(d.swing)} pts`}
              </p>
            )}
            <div className="mt-4">
              <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Players only in one XI</div>
              {d.differences.length === 0 ? (
                <p className="text-[11px] text-zinc-500">Both teams are identical.</p>
              ) : (
                <div className="divide-y divide-zinc-100 border border-zinc-200 rounded-md overflow-hidden">
                  {d.differences.map((r) => (
                    <div key={r.player_id} className="flex items-center gap-2 px-3 py-2 text-xs" data-testid={`cmp-diff-${r.player_id}`}>
                      <span className={`w-6 h-6 rounded-full text-[10px] font-extrabold flex items-center justify-center ${r.in === "A" ? "bg-violet-100 text-violet-800" : "bg-sky-100 text-sky-800"}`}>{r.in}</span>
                      <span className="flex-1 truncate font-bold text-zinc-800">{r.name}</span>
                      <span className="text-[10px] text-zinc-500 uppercase">{r.role} · {r.team}</span>
                      {!!r.captain_of && <span className="text-[9px] font-extrabold text-amber-700">C{r.captain_of === "AB" ? " (both)" : ` in ${r.captain_of}`}</span>}
                      {!!r.vice_of && <span className="text-[9px] font-extrabold text-sky-700">VC in {r.vice_of}</span>}
                      <span className="tabular font-extrabold text-orange-700 w-10 text-right">{d.final ? r.points : "—"}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-zinc-500 mt-2">
                {d.final ? "Points are the base contribution of each player (captain and vice-captain multipliers are already counted in the totals above)." : "Totals and per-player points appear once the organiser posts the scorecard."}
              </p>
            </div>
          </>
        )}
        <div className="flex justify-end mt-4">
          <Button onClick={onClose} className="rounded-full bg-turf hover:bg-turf-red-dark font-bold">Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FantasyContests({ contests, myTeams, match, config, walletBalance, coinCfg = null, onJoinFantasy, onMoneyChanged, onReload }) {
  const [picked, setPicked] = useState({});
  const [boardFor, setBoardFor] = useState(null);
  const [multiTeam, setMultiTeam] = useState("");
  const [multiSel, setMultiSel] = useState([]);
  const [busyMulti, setBusyMulti] = useState(false);
  const [payWith, setPayWith] = useState("wallet");
  const openOnes = contests.filter((c) => c.status === "open" && !match.locked && Number(c.entry_fee) > 0);
  const multiTeamId = multiTeam || (myTeams[0] && myTeams[0].id) || "";
  const multiCost = openOnes.filter((c) => multiSel.includes(c.id)).reduce((a, c) => a + Number(c.entry_fee || 0), 0);

  // Coin rail mirrors the server's Plus discount so the button shows what will charge.
  const coinsOn = !!coinCfg?.enabled;
  const coinBal = Number(coinCfg?.balance || 0);
  const plusPct = coinsOn && coinCfg?.plus_active ? Number(coinCfg.plus_discount_pct || 0) : 0;
  const coinCost = plusPct > 0 ? Math.round(multiCost * (100 - plusPct)) / 100 : multiCost;
  const useCoins = payWith === "coins" && coinsOn;
  const activeCost = useCoins ? coinCost : multiCost;
  const activeBalance = useCoins ? coinBal : walletBalance;
  const shortBy = Math.max(0, Math.ceil((activeCost - activeBalance) * 100) / 100);

  const joinMany = async () => {
    if (!multiTeamId || !multiSel.length) return;
    setBusyMulti(true);
    try {
      const { data } = await api.post("/fantasy/enter-multi", { team_id: multiTeamId, contest_ids: multiSel, pay_with: useCoins ? "coins" : "wallet" });
      if (useCoins) toast.success(`Joined ${data.joined.length} contest${data.joined.length === 1 ? "" : "s"} with coins · ${Number(data.coins_balance || 0).toLocaleString("en-IN")} left`);
      else toast.success(`Joined ${data.joined.length} contest${data.joined.length === 1 ? "" : "s"} · wallet ${money(data.wallet_balance)} left`);
      setMultiSel([]);
      onReload();
      if (onMoneyChanged) onMoneyChanged();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not join those contests");
    } finally {
      setBusyMulti(false);
    }
  };

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

      {myTeams.length > 0 && openOnes.length > 1 && (
        <div className="bg-white border border-neon/30 rounded-turf shadow-card p-4" data-testid="multi-join-panel">
          <div className="flex flex-wrap items-center gap-2">
            <Wallet size={16} weight="fill" className="text-neon" />
            <span className="text-sm font-extrabold text-zinc-900">Play one XI in several contests</span>
            <span className="text-[11px] text-zinc-500">
              {useCoins ? `paid with Sapna Coins (${Number(coinBal).toLocaleString("en-IN")} available)` : `paid from your available balance (${money(walletBalance)})`}
            </span>
          </div>
          {coinsOn && (
            <div className="flex items-center gap-2 mt-2" data-testid="multi-pay-toggle">
              <button type="button" onClick={() => setPayWith("wallet")}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${payWith === "wallet" ? "bg-neon text-white border-neon" : "bg-white text-zinc-600 border-zinc-200 hover:border-emerald-400"}`}
                data-testid="pay-wallet-toggle">
                Wallet {money(walletBalance)}
              </button>
              <button type="button" onClick={() => setPayWith("coins")}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${payWith === "coins" ? "bg-amber-500 text-white border-amber-500" : "bg-white text-zinc-600 border-zinc-200 hover:border-amber-400"}`}
                data-testid="pay-coins-toggle">
                Coins {Number(coinBal).toLocaleString("en-IN")}{plusPct > 0 ? ` · −${plusPct}%` : ""}
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <select
              value={multiTeamId}
              onChange={(e) => setMultiTeam(e.target.value)}
              className="rounded-md border border-zinc-200 px-3 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-turf"
              data-testid="multi-team-select"
            >
              {myTeams.map((tm) => <option key={tm.id} value={tm.id}>{tm.name} · {tm.credits_used} cr</option>)}
            </select>
            {openOnes.map((c) => {
              const on = multiSel.includes(c.id);
              const already = (c.my_entries || []).some((e) => e.team_id === multiTeamId);
              return (
                <button key={c.id} type="button" disabled={already}
                  onClick={() => setMultiSel(on ? multiSel.filter((x) => x !== c.id) : [...multiSel, c.id])}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors disabled:opacity-40 ${on ? "bg-turf text-white border-turf" : "bg-white text-zinc-700 border-zinc-200 hover:border-emerald-400"}`}
                  data-testid={`multi-pick-${c.id}`}>
                  {already ? `${c.title} · in` : `${c.title} · ${money(c.entry_fee)}`}
                </button>
              );
            })}
            <Button size="sm" disabled={!multiTeamId || !multiSel.length || busyMulti || activeCost > activeBalance} onClick={joinMany}
              className="turf-join ml-auto rounded-full border-0 active:scale-95" data-testid="multi-join-btn">
              {busyMulti ? "Joining…" : useCoins ? `Join ${multiSel.length} · ${Number(activeCost).toLocaleString("en-IN")} coins` : `Join ${multiSel.length} · ${money(multiCost)}`}
            </Button>
          </div>
          {shortBy > 0 && (
            <p className="text-[11px] text-amber-700 mt-2" data-testid="multi-wallet-short">
              {useCoins
                ? `Needs ${Number(shortBy).toLocaleString("en-IN")} more coins — grab a pack in the store or pick fewer contests.`
                : `Needs ${money(shortBy)} — top up your wallet or pick fewer contests.`}
            </p>
          )}
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
          <div key={c.id} className="bg-white border border-zinc-200 rounded-turf shadow-card p-5 hover:border-neon/40 transition-colors" data-testid={`fantasy-contest-${c.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="font-heading font-extrabold text-zinc-950 truncate">{c.title}</h4>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">fantasy</span>
                </div>
                {c.description && <p className="text-sm text-zinc-500 mt-1 line-clamp-2">{c.description}</p>}
                <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-xs text-zinc-600 tabular">
                  <span>Entry <b className="turf-money text-zinc-950">{money(c.entry_fee)}</b></span>
                  <span>Prize pool <b className="turf-money text-trophy-dark">{money(c.prize_pool)}</b></span>
                  <span>{c.participants_count || 0}/{c.max_participants} joined</span>
                  <span>{max} team{max === 1 ? "" : "s"} per user</span>
                </div>
                {(c.prize_breakdown || []).length > 0 && (
                  <div className="flex flex-wrap gap-x-3 mt-1.5 text-[11px] text-zinc-500" data-testid={`f-prizes-${c.id}`}>
                    {c.prize_breakdown.map((it) => <span key={it.rank}>Rank {it.rank}: <b className="turf-money text-trophy-dark">{money(it.amount)}</b></span>)}
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
                        className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors disabled:opacity-45 ${chosen === tm.id && !used ? "bg-turf text-white border-turf" : "bg-white text-zinc-700 border-zinc-200 hover:border-neon/50"}`}
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
                    className="turf-join rounded-full border-0 active:scale-95"
                    data-testid={`join-fantasy-${c.id}`}
                  >
                    <Trophy size={16} weight="fill" className="mr-1" /> Join · {money(c.entry_fee)}
                  </Button>
                )}
              </div>
            </div>
            {walletBalance < Number(c.entry_fee || 0) && !closed && config.manual_upi_enabled && (
              <p className="text-[11px] text-amber-700 mt-2" data-testid={`wallet-short-${c.id}`}>
                Wallet has {money(walletBalance)} — add money from the Wallet tab.
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
  const [openRow, setOpenRow] = useState(null);
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
            <div className="flex items-center justify-between bg-turf/5 border border-turf/25 rounded-lg px-4 py-2.5 mb-3 text-sm" data-testid="my-standing">
              <span className="font-bold text-turf">Your position</span>
              {mine ? (
                <span className="text-emerald-900 tabular" data-testid="my-standing-rank">
                  Rank <b>#{mine.rank}</b> of {data?.contest?.live_entries || rows.length} · <b>{mine.points}</b> pts
                  {!settled && !!mine.rank_delta && (
                    <span className={`ml-1.5 inline-flex items-center gap-0.5 font-extrabold ${mine.rank_delta > 0 ? "text-emerald-700" : "text-red-600"}`} data-testid="my-standing-move">
                      {mine.rank_delta > 0 ? <CaretUp size={11} weight="fill" /> : <CaretDown size={11} weight="fill" />}{Math.abs(mine.rank_delta)}
                    </span>
                  )}
                  {mine.prize > 0 && <> · <b className="text-orange-700">{money(mine.prize)}</b></>}
                </span>
              ) : <span className="text-emerald-700">Not entered yet</span>}
            </div>
            <div className="divide-y divide-zinc-100 border border-zinc-200 rounded-lg overflow-hidden">
              {rows.map((r) => {
                const open = openRow === r.entry_id;
                const prizeRow = (data?.contest?.prize_breakdown || []).find((p) => Number(p.rank) === r.rank);
                return (
                  <div key={r.entry_id} className={r.is_me ? "bg-turf/5" : ""}>
                    <div className="flex items-center gap-3 px-4 py-2.5 text-sm" data-testid={`lb-row-${r.rank}`}>
                      <span className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-xs font-extrabold tabular ${r.rank === 1 ? "bg-amber-400 text-amber-950" : r.rank === 2 ? "bg-zinc-300 text-zinc-700" : r.rank === 3 ? "bg-orange-200 text-orange-800" : "bg-zinc-100 text-zinc-600"}`}>
                        {r.rank}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-bold text-zinc-900 truncate">{r.is_me ? `${r.team_name || "Your team"} (you)` : r.user_name}</span>
                        <span className="block text-[11px] text-zinc-500 truncate">
                          {r.team_name || ""}
                          {!!r.rank_delta && !settled && (
                            <span className={`ml-1.5 inline-flex items-center gap-0.5 font-extrabold tabular ${r.rank_delta > 0 ? "text-emerald-700" : "text-red-600"}`} data-testid={`lb-move-${r.rank}`}>
                              {r.rank_delta > 0 ? <CaretUp size={11} weight="fill" /> : <CaretDown size={11} weight="fill" />}
                              {Math.abs(r.rank_delta)}
                            </span>
                          )}
                        </span>
                      </span>
                      {r.prize > 0 && <span className="text-[11px] font-extrabold text-orange-700 tabular">{money(r.prize)}</span>}
                      <span className="font-heading font-extrabold text-zinc-950 tabular w-14 text-right" data-testid={`lb-points-${r.rank}`}>{r.points}</span>
                      {r.breakdown && r.breakdown.length > 0 && (
                        <button type="button" onClick={() => setOpenRow(open ? null : r.entry_id)}
                          className="text-[11px] font-bold text-emerald-700 hover:text-emerald-900 shrink-0" data-testid={`lb-toggle-${r.rank}`}>
                          {open ? "hide" : "points"}
                        </button>
                      )}
                    </div>
                    {open && (
                      <div className="px-4 pb-3">
                        {prizeRow && (
                          <p className="text-[11px] text-zinc-600 mb-1.5" data-testid={`lb-prize-rule-${r.rank}`}>
                            Rank {r.rank} pays {money(prizeRow.amount)} · you scored {r.points} pts
                          </p>
                        )}
                        <div className="grid sm:grid-cols-2 gap-x-4 border border-zinc-200 rounded-md overflow-hidden bg-white" data-testid={`lb-breakdown-${r.rank}`}>
                          {r.breakdown.map((b) => {
                            const parts = Object.entries(b.components || {}).filter(([, v]) => Number(v) !== 0)
                              .sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).slice(0, 4);
                            return (
                              <div key={b.player_id} className="px-3 py-1.5 text-xs border-b border-zinc-100" data-testid={`lb-bd-${b.player_id}`}>
                                <div className="flex items-center gap-2">
                                  <span className="flex-1 truncate text-zinc-800 font-semibold">{b.name || "Player"}</span>
                                  {b.is_captain && <span className="text-[10px] font-extrabold text-amber-700">C ×2</span>}
                                  {b.is_vice_captain && <span className="text-[10px] font-extrabold text-sky-700">VC ×1.5</span>}
                                  <span className="text-zinc-400 tabular w-8 text-right">{b.base}</span>
                                  <span className="font-extrabold text-zinc-900 tabular w-9 text-right">{b.points}</span>
                                </div>
                                {parts.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {parts.map(([k, v]) => (
                                      <span key={k} className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${Number(v) < 0 ? "bg-red-50 text-red-700 border-red-200" : "bg-zinc-50 text-zinc-600 border-zinc-200"}`} data-testid={`lb-part-${b.player_id}-${k}`}>
                                        {prettyComponent(k)} {Number(v) > 0 ? `+${v}` : v}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
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
        <ContestChat contest={contest} joined={rows.some((r) => r.is_me) || settled} />
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={load} className="rounded-full font-bold" data-testid="lb-refresh"><Clock size={14} className="mr-1" /> Refresh</Button>
          <Button onClick={onClose} className="rounded-full bg-turf hover:bg-turf-red-dark font-bold">Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ContestChat({ contest, joined }) {
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);

  const load = () => api.get(`/contests/${contest.id}/chat`).then((r) => setMessages(r.data.messages || [])).catch(() => {});
  useEffect(() => { if (visible) load(); /* eslint-disable-next-line */ }, [visible, contest.id]);

  if (!joined) return null;

  if (!visible) {
    return (
      <div className="mt-4 flex items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3" data-testid="chat-teaser">
        <ChatsCircle size={18} weight="fill" className="text-turf shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold text-zinc-800">Contest chat</div>
          <div className="text-[11px] text-zinc-500 truncate">Talk to the {messages.length || contest.live_entries || 0} others in this contest.</div>
        </div>
        <button type="button" onClick={() => setVisible(true)} data-testid="chat-open"
          className="shrink-0 rounded-full border border-turf/40 bg-turf/10 px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-widest text-turf hover:bg-turf/20">
          Open
        </button>
      </div>
    );
  }

  const send = async (text) => {
    setBusy(true);
    try {
      const { data } = await api.post(`/contests/${contest.id}/chat`, { text });
      setMessages((cur) => [...cur, data.message]);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not send that");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4">
      <ChatThread messages={messages} onSend={send} busy={busy} />
    </div>
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
          <Button onClick={onClose} className="rounded-full bg-turf hover:bg-turf-red-dark font-bold" data-testid="rules-close">Got it</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
