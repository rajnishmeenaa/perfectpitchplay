import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Switch } from "../components/ui/switch";
import { Badge } from "../components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { toast } from "sonner";
import { Flag, Plus, Trash, Trophy, ChartBar, Check, X, Users, Medal, ShieldCheck, Lock, Lightning, Broadcast, Sparkle } from "@phosphor-icons/react";

const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const ROLES = ["WK", "BAT", "AR", "BOWL"];
const oversToBalls = (v) => { const s = String(v ?? "").trim(); if (!s) return 0; const [o, b = "0"] = s.split("."); return Math.max(0, Math.round(Number(o || 0) * 6 + Number(b || 0))); };
const ballsToOvers = (n) => `${Math.floor((n || 0) / 6)}.${(n || 0) % 6}`;
const toLocalInput = (iso) => { const d = new Date(iso); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

const emptyMatch = { team_a_name: "", team_a_short: "", team_b_name: "", team_b_short: "", start_time: "", venue: "", format: "T20" };

export default function AdminFantasy() {
  const [matches, setMatches] = useState([]);
  const [selected, setSelected] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    try {
      const { data } = await api.get("/admin/matches");
      setMatches(data);
      if (!selected && data.length) setSelected(data[0].id);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load matches");
    }
  };
  useEffect(() => { load(); }, []);

  const current = matches.find((m) => m.id === selected) || null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-heading text-3xl font-extrabold tracking-tighter text-zinc-950 flex items-center gap-2">
            <Flag size={26} weight="fill" className="text-emerald-600" /> Fantasy cricket
          </h2>
          <p className="text-sm text-zinc-500 mt-1">Announce a match, add both squads, open fantasy contests, then post the scorecard — points, ranks and prizes are calculated automatically.</p>
        </div>
        <Button onClick={() => { setEditing(null); setFormOpen(true); }} className="rounded-full bg-emerald-600 hover:bg-emerald-700 font-bold active:scale-95" data-testid="new-match-btn">
          <Plus size={18} weight="bold" className="mr-1" /> New match
        </Button>
      </div>

      <div className="grid lg:grid-cols-4 gap-5">
        <div className="lg:col-span-1 bg-white border border-zinc-200 rounded-lg overflow-hidden">
          <div className="p-4 border-b border-zinc-100 text-xs font-bold uppercase tracking-widest text-zinc-500">Matches ({matches.length})</div>
          <div className="divide-y divide-zinc-100 max-h-[560px] overflow-y-auto">
            {matches.length === 0 && <div className="p-5 text-sm text-zinc-500">No match yet. Create one to open fantasy play.</div>}
            {matches.map((m) => (
              <button key={m.id} type="button" onClick={() => setSelected(m.id)}
                className={`w-full text-left px-4 py-3 transition-colors ${selected === m.id ? "bg-emerald-50" : "hover:bg-zinc-50"}`}
                data-testid={`admin-match-row-${m.id}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-heading font-extrabold text-zinc-950">{m.team_a_short} vs {m.team_b_short}</span>
                  <span className={`text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${m.status === "upcoming" ? "bg-emerald-100 text-emerald-800" : m.status === "live" ? "bg-orange-100 text-orange-800" : "bg-zinc-200 text-zinc-700"}`}>{m.status}</span>
                </div>
                <div className="text-[11px] text-zinc-500 mt-0.5">{new Date(m.start_time).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                <div className="flex gap-3 mt-1 text-[10px] font-bold uppercase text-zinc-400">
                  <span>{m.players_count} players</span><span>{m.teams_count} teams</span><span>{m.contests_count} contests</span>
                </div>
                {m.locked && <div className="flex items-center gap-1 text-[10px] font-bold text-red-600 mt-1"><Lock size={10} weight="bold" /> locked</div>}
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-3">
          {current ? (
            <MatchAdmin match={current} onMatchChanged={load} />
          ) : (
            <div className="bg-white border border-zinc-200 rounded-lg p-10 text-center text-sm text-zinc-500">Select a match on the left, or create one.</div>
          )}
        </div>
      </div>

      <MatchFormDialog open={formOpen} onClose={() => setFormOpen(false)} onSaved={load} initial={editing} />
    </div>
  );
}

function MatchFormDialog({ open, onClose, onSaved, initial }) {
  const [form, setForm] = useState(emptyMatch);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setForm(initial ? { ...initial, start_time: toLocalInput(initial.start_time) } : { ...emptyMatch, start_time: toLocalInput(new Date(Date.now() + 86400000).toISOString()) });
  }, [open, initial]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async () => {
    if (!form.team_a_name || !form.team_b_name || !form.team_a_short || !form.team_b_short || !form.start_time) {
      toast.error("Fill both team names, short codes and the start time"); return;
    }
    const payload = { ...form, start_time: new Date(form.start_time).toISOString() };
    setBusy(true);
    try {
      if (initial?.id) await api.patch(`/admin/matches/${initial.id}`, payload);
      else await api.post("/admin/matches", payload);
      toast.success(initial ? "Match updated" : "Match created");
      onClose(); onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save match");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md" data-testid="match-form-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl font-extrabold tracking-tight">{initial ? "Edit match" : "New fantasy match"}</DialogTitle>
          <DialogDescription>Short codes are used everywhere (splits, teams, scorecard). Entries close automatically at the start time.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Team A</Label>
              <Input value={form.team_a_name} onChange={set("team_a_name")} placeholder="India" className="mt-1" data-testid="field-team-a-name" />
            </div>
            <div>
              <Label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Code A</Label>
              <Input value={form.team_a_short} onChange={set("team_a_short")} maxLength={6} placeholder="IND" className="mt-1 uppercase" data-testid="field-team-a-short" />
            </div>
            <div>
              <Label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Team B</Label>
              <Input value={form.team_b_name} onChange={set("team_b_name")} placeholder="Australia" className="mt-1" data-testid="field-team-b-name" />
            </div>
            <div>
              <Label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Code B</Label>
              <Input value={form.team_b_short} onChange={set("team_b_short")} maxLength={6} placeholder="AUS" className="mt-1 uppercase" data-testid="field-team-b-short" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Start time</Label>
              <Input type="datetime-local" value={form.start_time} onChange={set("start_time")} className="mt-1" data-testid="field-start-time" />
            </div>
            <div>
              <Label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Format</Label>
              <Input value={form.format} onChange={set("format")} placeholder="T20" className="mt-1" data-testid="field-format" />
            </div>
          </div>
          <div>
            <Label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Venue (optional)</Label>
            <Input value={form.venue} onChange={set("venue")} placeholder="Wankhede, Mumbai" className="mt-1" data-testid="field-venue" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="match-form-cancel">Cancel</Button>
          <Button disabled={busy} onClick={submit} className="bg-emerald-600 hover:bg-emerald-700 font-bold" data-testid="match-form-save">
            {busy ? "Saving…" : initial ? "Save changes" : "Create match"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MatchAdmin({ match, onMatchChanged }) {
  const [tab, setTab] = useState("squad");
  const [status, setStatus] = useState(match.status);
  const locked = !!match.locked;
  useEffect(() => { setStatus(match.status); }, [match.status]);

  const setMatchStatus = async (next) => {
    try {
      await api.patch(`/admin/matches/${match.id}`, { status: next });
      toast.success(`Match marked ${next}`);
      setStatus(next);
      onMatchChanged();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not update status");
    }
  };

  return (
    <div className="space-y-4" data-testid={`match-admin-${match.id}`}>
      <div className="bg-white border border-zinc-200 rounded-lg p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-heading text-2xl font-extrabold text-zinc-950">{match.team_a_name} <span className="text-zinc-400 text-base font-bold">vs</span> {match.team_b_name}</h3>
          <div className="text-sm text-zinc-500 mt-0.5">
            {new Date(match.start_time).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} · {match.format}
            {match.venue ? ` · ${match.venue}` : ""}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-bold uppercase tracking-wider" data-testid="admin-match-status">{status}</Badge>
          {status === "upcoming" && (
            <Button size="sm" variant="outline" onClick={() => setMatchStatus("live")} className="rounded-full font-bold border-orange-300 text-orange-700 hover:bg-orange-50" data-testid="mark-live-btn">
              <Lightning size={14} weight="fill" className="mr-1" /> Start match
            </Button>
          )}
          {status !== "completed" && (
            <Button size="sm" variant="outline" onClick={() => setMatchStatus("completed")} className="rounded-full font-bold" data-testid="mark-completed-btn">Mark completed</Button>
          )}
        </div>
      </div>

      {locked && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-sm text-amber-900 flex items-center gap-2" data-testid="admin-locked-note">
          <Lock size={15} weight="bold" /> Users can no longer build or change teams for this match.
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-zinc-100 border border-zinc-200 rounded-full p-1 h-auto">
          <TabsTrigger value="squad" className="rounded-full data-[state=active]:bg-emerald-600 data-[state=active]:text-white px-4 py-1.5 text-sm font-bold" data-testid="atab-squad">
            <Users size={15} weight="bold" className="mr-1.5" /> Squads
          </TabsTrigger>
          <TabsTrigger value="contests" className="rounded-full data-[state=active]:bg-emerald-600 data-[state=active]:text-white px-4 py-1.5 text-sm font-bold" data-testid="atab-contests">
            <Trophy size={15} weight="bold" className="mr-1.5" /> Contests
          </TabsTrigger>
          <TabsTrigger value="scorecard" className="rounded-full data-[state=active]:bg-emerald-600 data-[state=active]:text-white px-4 py-1.5 text-sm font-bold" data-testid="atab-scorecard">
            <ChartBar size={15} weight="bold" className="mr-1.5" /> Scorecard & results
          </TabsTrigger>
          <TabsTrigger value="live" className="rounded-full data-[state=active]:bg-emerald-600 data-[state=active]:text-white px-4 py-1.5 text-sm font-bold" data-testid="atab-live">
            <Broadcast size={15} weight="bold" className="mr-1.5" /> Live centre
          </TabsTrigger>
        </TabsList>
        <TabsContent value="squad" className="mt-4"><SquadPanel key={match.id} match={match} /></TabsContent>
        <TabsContent value="contests" className="mt-4"><FantasyContestPanel key={match.id} match={match} /></TabsContent>
        <TabsContent value="scorecard" className="mt-4"><ScorecardPanel key={match.id} match={match} onMatchChanged={onMatchChanged} /></TabsContent>
        <TabsContent value="live" className="mt-4"><LiveCenterPanel key={match.id} match={match} onMatchChanged={onMatchChanged} /></TabsContent>
      </Tabs>
    </div>
  );
}

function LiveCenterPanel({ match, onMatchChanged }) {
  const [ext, setExt] = useState(match.external_id || "");
  const [feed, setFeed] = useState(match.live_feed || "scorecard");
  const [auto, setAuto] = useState(!!match.auto_live);
  const [busy, setBusy] = useState(false);
  const [snap, setSnap] = useState(null);
  const [report, setReport] = useState(null);

  const load = async () => {
    try {
      const { data } = await api.get(`/admin/matches/${match.id}/live`);
      setSnap(data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not read the live snapshot");
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [match.id]);

  const saveSettings = async () => {
    setBusy(true);
    try {
      await api.patch(`/admin/matches/${match.id}`, { external_id: ext.trim(), live_feed: feed, auto_live: auto });
      toast.success("Live settings saved");
      onMatchChanged();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save live settings");
    } finally {
      setBusy(false);
    }
  };

  const push = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/admin/matches/${match.id}/live/sync`, { feed });
      setReport(data);
      toast.success(`Live update pushed · ${data.scores_written} player lines · ${data.boards.entries_ranked} entries re-ranked`);
      await load();
      onMatchChanged();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Live sync failed");
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    try {
      await api.delete(`/admin/matches/${match.id}/live`);
      setReport(null);
      toast("Live snapshot cleared");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not clear");
    }
  };

  const live = snap?.live || {};
  return (
    <div className="space-y-4">
      <div className="bg-white border border-zinc-200 rounded-lg p-5" data-testid="live-settings">
        <h4 className="font-heading font-extrabold text-zinc-950 flex items-center gap-2">
          <Broadcast size={16} weight="fill" className="text-red-600" /> Push live scores into the app
        </h4>
        <p className="text-sm text-zinc-500 mt-1">Give the match its id from the score service (the Live import tab lists current ids). Then push an update, or let the app pull one automatically while users watch.</p>
        <div className="flex flex-wrap items-end gap-3 mt-4">
          <div className="min-w-[190px]">
            <Label className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Score-service match id</Label>
            <Input value={ext} onChange={(e) => setExt(e.target.value)} placeholder="e.g. 984321" className="mt-1.5 tabular" data-testid="live-ext-id" />
          </div>
          <div>
            <Label className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Feed</Label>
            <select value={feed} onChange={(e) => setFeed(e.target.value)} className="mt-1.5 block rounded-md border border-zinc-200 px-3 py-2 text-sm font-bold" data-testid="live-feed">
              <option value="scorecard">scorecard</option>
              <option value="fantasy">fantasy</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm font-bold text-zinc-700 mb-1 cursor-pointer" data-testid="live-auto-label">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="rounded border-zinc-300 text-emerald-600" data-testid="live-auto-toggle" />
            Auto-refresh for users
          </label>
          <Button size="sm" disabled={busy} onClick={saveSettings} variant="outline" className="rounded-full font-bold" data-testid="live-save-btn">Save settings</Button>
          <Button size="sm" disabled={busy || !ext.trim()} onClick={push} className="rounded-full bg-red-600 hover:bg-red-700 text-white font-bold" data-testid="live-push-btn">
            {busy ? "Working…" : "Push live update now"}
          </Button>
        </div>
        {!snap?.config?.external_id && (
          <p className="text-[11px] text-amber-700 mt-3" data-testid="live-no-id-hint">No match id saved yet — the app shows nothing until you set one and push.</p>
        )}
      </div>

      {(live.innings || []).length > 0 && (
        <div className="bg-night text-white rounded-lg p-5 border border-night-line" data-testid="admin-live-preview">
          <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">What users see{live.auto_live ? " · auto-refresh on" : ""}</div>
          <div className="text-sm font-bold mt-1" data-testid="admin-live-status">{live.status_text || "no status line"}</div>
          <div className="flex flex-wrap gap-2 mt-3">
            {live.innings.map((r, i) => (
              <div key={`${r.innings}-${i}`} className="bg-night-card rounded-md px-3 py-2 border border-night-line">
                <div className="text-[10px] uppercase tracking-widest text-zinc-400">{r.innings || `Innings ${i + 1}`}</div>
                <div className="text-lg font-extrabold tabular">{r.runs}/{r.wickets}</div>
                {r.overs ? <div className="text-[11px] text-zinc-400 tabular">{r.overs} ov</div> : null}
              </div>
            ))}
          </div>
          {(live.events || []).length > 0 && (
            <div className="mt-3" data-testid="admin-live-events">
              <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-1">Ball feed · {live.events.length} received</div>
              <div className="space-y-1">
                {live.events.slice(-3).reverse().map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px] text-zinc-300">
                    <span className="tabular text-zinc-500 w-10">{e.over}.{e.ball}</span>
                    <span className="tabular w-6 font-extrabold">{e.wicket ? "W" : e.runs}</span>
                    <span className="truncate">{e.text}</span>
                    <span className="ml-auto text-[10px] text-zinc-500">{e.batter || "—"}{(e.batter_id ? "" : " · unmapped")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {(live.tables || []).length > 0 && (
            <div className="text-[11px] text-zinc-500 mt-2" data-testid="admin-live-tables">
              Innings tables users can read: {live.tables.map((t) => `${t.innings} (${(t.batting || []).length} batters, ${(t.bowling || []).length} bowlers)`).join(" · ")}
              {(live.run_rate || []).length > 1 ? ` · run-rate graph over ${(live.run_rate || []).length} overs` : ""}
            </div>
          )}
          <div className="text-[11px] text-zinc-500 mt-3 tabular">
            Snapshot {live.updated_at ? new Date(live.updated_at).toLocaleString("en-IN") : "—"}
            {live.venue ? ` · ${live.venue}` : ""}
          </div>
        </div>
      )}

      {report && (
        <div className="bg-white border border-zinc-200 rounded-lg p-5" data-testid="live-sync-report">
          <div className="flex items-center justify-between gap-2">
            <h5 className="font-bold text-zinc-900">Last sync result</h5>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="rounded-full" onClick={push} disabled={busy}>Sync again</Button>
              <Button size="sm" variant="ghost" className="rounded-full text-zinc-500" onClick={clear}>Clear snapshot</Button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-3 text-sm">
            <div className="bg-zinc-50 rounded-md p-3"><div className="text-[10px] uppercase tracking-widest text-zinc-500">Player lines written</div><div className="text-xl font-extrabold tabular">{report.scores_written}</div></div>
            <div className="bg-zinc-50 rounded-md p-3"><div className="text-[10px] uppercase tracking-widest text-zinc-500">Matched to squad</div><div className="text-xl font-extrabold tabular">{report.matched}</div></div>
            <div className="bg-zinc-50 rounded-md p-3"><div className="text-[10px] uppercase tracking-widest text-zinc-500">Entries re-ranked</div><div className="text-xl font-extrabold tabular">{report.boards?.entries_ranked ?? 0}</div></div>
          </div>
          {report.unmatched?.length > 0 && (
            <p className="text-[11px] text-amber-700 mt-2" data-testid="live-unmatched">
              Not matched to your squad: {report.unmatched.map((u) => u.source_name).join(", ")}
            </p>
          )}
          {report.squad_without_stats?.length > 0 && (
            <p className="text-[11px] text-zinc-500 mt-1">No stats yet for: {report.squad_without_stats.map((s) => s.player).join(", ")}</p>
          )}
        </div>
      )}

      <p className="text-[11px] text-zinc-500" data-testid="live-money-note">
        Live updates only move points and ranks. Prizes are still paid when you settle the contest after the match.
      </p>
    </div>
  );
}

function SquadPanel({ match }) {
  const [players, setPlayers] = useState([]);
  const [row, setRow] = useState({ name: "", team: match.team_a_short, role: "BAT", credits: 9, projection: 0 });
  const [bulk, setBulk] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get(`/matches/${match.id}`);
      setPlayers(data.players);
    } catch (e) {
      toast.error("Could not load squads");
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [match.id]);

  const bySide = useMemo(() => {
    const g = {};
    players.forEach((p) => { (g[p.team] = g[p.team] || []).push(p); });
    return g;
  }, [players]);

  const add = async () => {
    if (!row.name.trim()) { toast.error("Player name required"); return; }
    setBusy(true);
    try {
      await api.post(`/admin/matches/${match.id}/players`, {
        name: row.name.trim(), team: row.team, role: row.role, credits: Number(row.credits),
        projection: Number(row.projection || 0),
      });
      setRow({ ...row, name: "" });
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not add player");
    } finally {
      setBusy(false);
    }
  };

  const addBulk = async () => {
    const lines = bulk.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) { toast.error("Paste at least one line"); return; }
    const parsed = lines.map((l) => {
      const [name, team, role, credits, projection] = l.split(",").map((x) => (x || "").trim());
      return {
        name, team: (team || match.team_a_short).toUpperCase(), role: (role || "BAT").toUpperCase(),
        credits: Number(credits || 9), projection: Number(projection || 0),
      };
    });
    const bad = parsed.find((p) => !p.name || !ROLES.includes(p.role));
    if (bad) { toast.error("Each line must be: Name, CODE, WK|BAT|AR|BOWL, credits[, projection]"); return; }
    setBusy(true);
    try {
      const { data } = await api.post(`/admin/matches/${match.id}/players/bulk`, { players: parsed });
      toast.success(`${data.added} players added`);
      setBulk("");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Bulk add failed");
    } finally {
      setBusy(false);
    }
  };

  const patch = async (id, fields) => {
    try {
      await api.patch(`/admin/players/${id}`, fields);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Update failed");
    }
  };

  const del = async (p) => {
    try {
      await api.delete(`/admin/players/${p.id}`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Delete failed");
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-zinc-200 rounded-lg p-4" data-testid="player-add-form">
        <div className="grid sm:grid-cols-6 gap-2">
          <Input placeholder="Player name" value={row.name} onChange={(e) => setRow({ ...row, name: e.target.value })} className="sm:col-span-2" data-testid="player-name-input" />
          <select value={row.team} onChange={(e) => setRow({ ...row, team: e.target.value })} className="rounded-md border border-zinc-200 bg-white px-2 text-sm" data-testid="player-team-select">
            <option value={match.team_a_short}>{match.team_a_short}</option>
            <option value={match.team_b_short}>{match.team_b_short}</option>
          </select>
          <select value={row.role} onChange={(e) => setRow({ ...row, role: e.target.value })} className="rounded-md border border-zinc-200 bg-white px-2 text-sm" data-testid="player-role-select">
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <Input type="number" step="0.5" min="0.5" max="20" value={row.credits} onChange={(e) => setRow({ ...row, credits: e.target.value })} data-testid="player-credits-input" />
          <Input type="number" step="1" min="0" max="500" value={row.projection} onChange={(e) => setRow({ ...row, projection: e.target.value })} placeholder="proj" data-testid="player-projection-input" />
        </div>
        <div className="flex flex-wrap gap-2 items-center mt-3">
          <Button size="sm" disabled={busy} onClick={add} className="rounded-full bg-emerald-600 hover:bg-emerald-700 font-bold" data-testid="add-player-btn">
            <Plus size={15} weight="bold" className="mr-1" /> Add player
          </Button>
          <span className="text-[11px] text-zinc-500 flex items-center gap-1" data-testid="projection-hint">
            <Sparkle size={12} weight="fill" className="text-violet-500" /> Projection = the fantasy points you expect. Users' “Auto-pick XI” ranks by it; leave 0 to use credits.
          </span>
        </div>
        <details className="mt-3" data-testid="bulk-add">
          <summary className="text-xs font-bold uppercase tracking-widest text-zinc-500 cursor-pointer">Paste full squads (one per line)</summary>
          <Textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={6}
            placeholder={`${match.team_a_short}-Rohit, ${match.team_a_short}, BAT, 10, 45\n${match.team_a_short}-Bumrah, ${match.team_a_short}, BOWL, 9, 60\n${match.team_b_short}-Warner, ${match.team_b_short}, BAT, 9.5`}
            className="mt-2 font-mono text-xs" data-testid="bulk-input" />
          <Button size="sm" variant="outline" disabled={busy} onClick={addBulk} className="mt-2 rounded-full font-bold" data-testid="bulk-add-btn">Add all lines</Button>
        </details>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {[match.team_a_short, match.team_b_short].map((side) => (
          <div key={side} className="bg-white border border-zinc-200 rounded-lg overflow-hidden" data-testid={`squad-side-${side}`}>
            <div className="px-4 py-2.5 bg-zinc-50 border-b border-zinc-100 flex items-center justify-between">
              <span className="font-heading font-extrabold text-zinc-900">{side}</span>
              <span className="text-[11px] font-bold text-zinc-500 tabular">{(bySide[side] || []).length} players · {ROLES.map((r) => `${(bySide[side] || []).filter((p) => p.role === r).length}${r}`).join(" ")}</span>
            </div>
            <div className="divide-y divide-zinc-100 max-h-[420px] overflow-y-auto">
              {(bySide[side] || []).length === 0 && <div className="px-4 py-6 text-sm text-zinc-400">No players yet.</div>}
              {(bySide[side] || []).map((p) => (
                <div key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm" data-testid={`squad-player-${p.id}`}>
                  <span className="flex-1 truncate font-semibold text-zinc-800">{p.name}</span>
                  <select value={p.role} onChange={(e) => patch(p.id, { role: e.target.value })} className="rounded border border-zinc-200 bg-transparent text-[11px] font-bold px-1 py-0.5 text-zinc-800" data-testid={`role-of-${p.id}`}>
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <input type="number" step="0.5" min="0.5" max="20" defaultValue={p.credits}
                    onBlur={(e) => Number(e.target.value) !== p.credits && patch(p.id, { credits: Number(e.target.value) })}
                    className="w-14 rounded border border-zinc-200 bg-transparent text-[11px] font-bold px-1 py-0.5 tabular text-zinc-800" data-testid={`credits-of-${p.id}`} />
                  <input type="number" step="1" min="0" max="500" defaultValue={p.projection || 0} title="Projected fantasy points"
                    onBlur={(e) => Number(e.target.value) !== (p.projection || 0) && patch(p.id, { projection: Number(e.target.value) })}
                    className="w-14 rounded border border-violet-200 bg-violet-50 text-[11px] font-bold px-1 py-0.5 tabular text-violet-800" data-testid={`projection-of-${p.id}`} />
                  <button type="button" onClick={() => patch(p.id, { playing: !p.playing })} title="Playing in XI?"
                    className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold uppercase ${p.playing ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"}`} data-testid={`playing-of-${p.id}`}>
                    {p.playing ? "XI" : "out"}
                  </button>
                  <button type="button" onClick={() => del(p)} className="p-1 text-zinc-400 hover:text-red-600" title="Remove player" data-testid={`del-player-${p.id}`}><Trash size={14} weight="bold" /></button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {players.length < 22 && (
        <p className="text-xs text-zinc-500" data-testid="squad-hint">
          Users need {22 - players.length} more player{22 - players.length === 1 ? "" : "s"} before team selection opens (11 per side recommended).
        </p>
      )}
    </div>
  );
}

function FantasyContestPanel({ match }) {
  const [contests, setContests] = useState([]);
  const [form, setForm] = useState({ title: "", description: "", entry_fee: 10, max_participants: 50, max_teams_per_user: 1, prizes: [{ rank: 1, amount: 100 }] });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get("/contests");
      setContests(data.filter((c) => c.kind === "fantasy" && c.match_id === match.id));
    } catch (e) {
      toast.error("Could not load contests");
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [match.id]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setPrize = (i, k) => (e) => {
    const prizes = form.prizes.map((p, j) => (j === i ? { ...p, [k]: e.target.value } : p));
    setForm({ ...form, prizes });
  };

  const create = async () => {
    if (!form.title.trim()) { toast.error("Contest title required"); return; }
    const prizes = form.prizes.map((p) => ({ rank: Number(p.rank), amount: Number(p.amount) })).filter((p) => p.rank > 0 && p.amount > 0);
    if (!prizes.length) { toast.error("Add at least one prize rank"); return; }
    setBusy(true);
    try {
      await api.post("/contests", {
        title: form.title.trim(), description: form.description.trim(), external_link: "",
        entry_fee: Number(form.entry_fee), max_participants: Number(form.max_participants),
        kind: "fantasy", match_id: match.id, max_teams_per_user: Number(form.max_teams_per_user),
        prize_breakdown: prizes,
      });
      toast.success("Fantasy contest is live");
      setForm({ ...form, title: "", description: "" });
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not create contest");
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (c, status) => {
    try {
      await api.patch(`/contests/${c.id}`, { status });
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Update failed");
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-zinc-200 rounded-lg p-4 space-y-3" data-testid="fantasy-contest-form">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Contest title</Label>
            <Input value={form.title} onChange={set("title")} placeholder={`Fantasy Mega · ${match.team_a_short} vs ${match.team_b_short}`} className="mt-1" data-testid="fc-title" />
          </div>
          <div>
            <Label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Description</Label>
            <Input value={form.description} onChange={set("description")} placeholder="11 players · 100 credits" className="mt-1" data-testid="fc-description" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Entry fee ₹</Label>
              <Input type="number" min="1" value={form.entry_fee} onChange={set("entry_fee")} className="mt-1 tabular" data-testid="fc-fee" />
            </div>
            <div>
              <Label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Max entries</Label>
              <Input type="number" min="1" value={form.max_participants} onChange={set("max_participants")} className="mt-1 tabular" data-testid="fc-max" />
            </div>
          </div>
          <div>
            <Label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Teams per user</Label>
            <Input type="number" min="1" max="20" value={form.max_teams_per_user} onChange={set("max_teams_per_user")} className="mt-1 tabular" data-testid="fc-teams-per-user" />
            <p className="text-[11px] text-zinc-500 mt-1">1 = single entry, more allows multiple XIs per user (each entry pays the fee).</p>
          </div>
        </div>
        <div>
          <Label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Prize by rank</Label>
          <div className="space-y-2 mt-1">
            {form.prizes.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input type="number" min="1" value={p.rank} onChange={setPrize(i, "rank")} className="w-20 tabular" data-testid={`prize-rank-${i}`} />
                <span className="text-xs text-zinc-500 font-bold">rank</span>
                <Input type="number" min="1" value={p.amount} onChange={setPrize(i, "amount")} className="w-28 tabular" data-testid={`prize-amount-${i}`} />
                <span className="text-xs text-zinc-500 font-bold">₹</span>
                <button type="button" onClick={() => setForm({ ...form, prizes: form.prizes.filter((_, j) => j !== i) })} className="p-1 text-zinc-400 hover:text-red-600" data-testid={`prize-remove-${i}`}><X size={14} weight="bold" /></button>
              </div>
            ))}
          </div>
          <Button size="sm" variant="outline" className="mt-2 rounded-full font-bold" onClick={() => setForm({ ...form, prizes: [...form.prizes, { rank: form.prizes.length + 1, amount: 50 }] })} data-testid="prize-add-btn">
            <Plus size={14} weight="bold" className="mr-1" /> Add rank
          </Button>
        </div>
        <Button disabled={busy} onClick={create} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700 font-bold" data-testid="create-fc-btn">
          <Trophy size={16} weight="fill" className="mr-1" /> {busy ? "Creating…" : "Publish fantasy contest"}
        </Button>
      </div>

      <div className="space-y-3">
        {contests.length === 0 && <div className="bg-white border border-zinc-200 rounded-lg p-6 text-center text-sm text-zinc-500">No fantasy contest for this match yet.</div>}
        {contests.map((c) => (
          <div key={c.id} className="bg-white border border-zinc-200 rounded-lg p-4" data-testid={`fc-row-${c.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-heading font-extrabold text-zinc-950 truncate">{c.title}</span>
                  <Badge variant="outline" className="text-[10px] font-bold uppercase">{c.status}</Badge>
                  {c.settled_at && <Badge className="text-[10px] font-bold uppercase bg-orange-100 text-orange-800 border-0">settled</Badge>}
                </div>
                <div className="text-xs text-zinc-500 mt-1 tabular">
                  {money(c.entry_fee)} entry · {money(c.prize_pool)} pool · {c.participants_count || 0}/{c.max_participants} entries · {c.max_teams_per_user || 1} team/user
                  {c.my_entry_status ? ` · you: ${c.my_entry_status}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {c.status === "open" && <Button size="sm" variant="outline" onClick={() => setStatus(c, "closed")} className="rounded-full font-bold" data-testid={`close-fc-${c.id}`}>Close entries</Button>}
                {c.status !== "completed" && <SettleButton contest={c} match={match} onDone={load} />}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SettleButton({ contest, match, onDone }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const previewStandings = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/admin/fantasy/contests/${contest.id}/settle`, { dry_run: true });
      setPreview(data);
      setOpen(true);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Preview failed — is the scorecard posted?");
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/admin/fantasy/contests/${contest.id}/settle`, {});
      toast.success(`Settled · ${data.winners?.length || 0} prizes credited`);
      setOpen(false); onDone();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Settlement failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" disabled={busy} onClick={previewStandings} className="rounded-full bg-orange-600 hover:bg-orange-700 text-white font-bold" data-testid={`settle-btn-${contest.id}`}>
        <Medal size={14} weight="fill" className="mr-1" /> Preview result
      </Button>
      <Dialog open={open} onOpenChange={(v) => !v && setOpen(false)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="settle-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading text-2xl font-extrabold tracking-tight">{contest.title}</DialogTitle>
            <DialogDescription>
              {match.team_a_short} vs {match.team_b_short} · {preview?.leaderboard?.length || 0} entries.
              Prizes go to the listed ranks and are credited to each user's wallet. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <div className="border border-zinc-200 rounded-lg overflow-hidden">
              {Number(preview.leaderboard?.[0]?.tax_percent || 0) > 0 && (
                <div className="px-4 py-2 bg-gold/10 border-b border-gold/20 text-[11px] font-bold uppercase tracking-widest text-gold" data-testid="settle-tax-note">
                  {preview.leaderboard[0].tax_percent}% tax withheld on every prize
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-14">Rank</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Team</TableHead>
                    <TableHead className="text-right">Points</TableHead>
                    <TableHead className="text-right">Prize</TableHead>
                    {Number(preview.leaderboard?.[0]?.tax_percent || 0) > 0 && <TableHead className="text-right">Tax</TableHead>}
                    <TableHead className="text-right">Pays</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.leaderboard.map((r) => (
                    <TableRow key={r.entry_id} data-testid={`settle-row-${r.rank}`}>
                      <TableCell className="font-extrabold tabular">{r.rank}</TableCell>
                      <TableCell className="truncate max-w-[140px]">{r.user_name}</TableCell>
                      <TableCell className="truncate max-w-[140px] text-zinc-500">{r.team_name}</TableCell>
                      <TableCell className="text-right font-extrabold tabular">{r.points}</TableCell>
                      <TableCell className="text-right font-bold text-gold tabular">{r.prize ? money(r.prize) : "—"}</TableCell>
                      {Number(r.tax_percent || 0) > 0 && (
                        <TableCell className="text-right text-xs font-bold text-red-400 tabular" data-testid={`settle-tax-${r.rank}`}>
                          {r.tax_amount ? `−${money(r.tax_amount)}` : "—"}
                        </TableCell>
                      )}
                      <TableCell className="text-right font-extrabold tabular" data-testid={`settle-net-${r.rank}`}>
                        {r.prize ? money(r.net_prize ?? r.prize) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} data-testid="settle-cancel">Cancel</Button>
            <Button disabled={busy} onClick={commit} className="bg-emerald-600 hover:bg-emerald-700 font-bold" data-testid="settle-confirm">
              <Check size={16} weight="bold" className="mr-1" /> {busy ? "Working…" : "Credit prizes & finish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const COLS = [
  ["runs", "R", 52], ["balls", "B", 46], ["fours", "4s", 42], ["sixes", "6s", 42], ["out", "OUT", 48],
  ["overs", "OV", 54], ["runs_conceded", "G", 48], ["wickets", "W", 42], ["maidens", "MD", 46], ["bowled_or_lbw", "B/L", 46],
  ["catches", "C", 42], ["stumpings", "ST", 46], ["run_out_direct", "ROD", 48], ["run_out_thrower", "ROT", 48],
];

function ScorecardPanel({ match, onMatchChanged }) {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [totals, setTotals] = useState(null);

  const load = async () => {
    try {
      const { data } = await api.get(`/admin/matches/${match.id}/scorecard`);
      setRows(data.rows.map((r) => ({
        player_id: r.id, name: r.name, team: r.team, role: r.role, playing: r.playing,
        entered: r.entered, points: r.points, stats: r.score,
        runs: r.score?.runs ?? 0, balls: r.score?.balls ?? 0, fours: r.score?.fours ?? 0, sixes: r.score?.sixes ?? 0,
        out: !!r.score?.out, overs: ballsToOvers(r.score?.balls_bowled ?? 0), runs_conceded: r.score?.runs_conceded ?? 0,
        wickets: r.score?.wickets ?? 0, maidens: r.score?.maidens ?? 0, bowled_or_lbw: r.score?.bowled_or_lbw ?? 0,
        catches: r.score?.catches ?? 0, stumpings: r.score?.stumpings ?? 0,
        run_out_direct: r.score?.run_out_direct ?? 0, run_out_thrower: r.score?.run_out_thrower ?? 0,
        played: r.score ? r.score.played !== false : true,
      })));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load scorecard");
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [match.id]);

  const upd = (id, k, v) => setRows((cur) => cur.map((r) => (r.player_id === id ? { ...r, [k]: v } : r)));

  const submit = async (markCompleted) => {
    if (!rows.length) { toast.error("Add players to the squads first"); return; }
    setBusy(true);
    try {
      const scores = rows.map((r) => ({
        player_id: r.player_id, played: r.played,
        runs: Number(r.runs) || 0, balls: Number(r.balls) || 0, fours: Number(r.fours) || 0, sixes: Number(r.sixes) || 0,
        out: !!r.out, balls_bowled: oversToBalls(r.overs), runs_conceded: Number(r.runs_conceded) || 0,
        wickets: Number(r.wickets) || 0, maidens: Number(r.maidens) || 0, bowled_or_lbw: Number(r.bowled_or_lbw) || 0,
        catches: Number(r.catches) || 0, stumpings: Number(r.stumpings) || 0,
        run_out_direct: Number(r.run_out_direct) || 0, run_out_thrower: Number(r.run_out_thrower) || 0,
      }));
      const { data } = await api.post(`/admin/matches/${match.id}/scorecard`, { scores, mark_completed: markCompleted });
      setTotals(data.scores);
      toast.success(`Scorecard saved · ${data.match.status === "completed" ? "match marked completed" : "still live"}`);
      onMatchChanged();
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save scorecard");
    } finally {
      setBusy(false);
    }
  };

  const pointsOf = (id) => (totals || []).find((s) => s.player_id === id)?.points ?? rows.find((r) => r.player_id === id)?.points;

  if (!rows.length) {
    return <div className="bg-white border border-zinc-200 rounded-lg p-8 text-center text-sm text-zinc-500">Add players in the Squads tab before entering a scorecard.</div>;
  }

  return (
    <div className="space-y-4">
      <LiveScoreImport match={match} onFill={(lines) => setRows((cur) => applyImportedLines(cur, lines))} />
      <div className="bg-white border border-zinc-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-zinc-600">
          Enter each player's match figures. <b>OUT</b> marks a dismissal (duck penalty applies), <b>OVO</b> accepts overs as <span className="font-mono">3.2</span> = 3 overs 2 balls.
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => submit(false)} className="rounded-full font-bold" data-testid="save-scorecard-btn">
            {busy ? "Saving…" : "Save scorecard"}
          </Button>
          <Button size="sm" disabled={busy} onClick={() => submit(true)} className="rounded-full bg-orange-600 hover:bg-orange-700 text-white font-bold" data-testid="save-complete-btn">
            <Check size={14} weight="bold" className="mr-1" /> Save & finish match
          </Button>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg overflow-x-auto" data-testid="scorecard-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[150px]">Player</TableHead>
              {COLS.map(([k, label]) => <TableHead key={k} className="text-center whitespace-nowrap">{label}</TableHead>)}
              <TableHead className="text-right">Pts</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.player_id} data-testid={`score-row-${r.player_id}`} className={!r.played ? "opacity-50" : ""}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => upd(r.player_id, "played", !r.played)} title="Played?"
                      className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${r.played ? "bg-emerald-600 text-white" : "bg-zinc-200 text-zinc-400"}`} data-testid={`played-${r.player_id}`}>
                      <Check size={12} weight="bold" />
                    </button>
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-zinc-900 truncate">{r.name}</div>
                      <div className="text-[10px] font-bold uppercase text-zinc-400">{r.team} · {r.role}</div>
                    </div>
                  </div>
                </TableCell>
                {COLS.map(([k, label, w]) => (
                  <TableCell key={k} className="p-1">
                    {k === "out" ? (
                      <button type="button" onClick={() => upd(r.player_id, "out", !r.out)} title="Dismissed"
                        className={`w-full h-7 rounded text-[10px] font-extrabold ${r.out ? "bg-red-100 text-red-700" : "bg-zinc-50 text-zinc-300"}`} data-testid={`out-${r.player_id}`}>
                        {r.out ? "✓" : "—"}
                      </button>
                    ) : (
                      <input type="number" min="0" value={r[k]} onChange={(e) => upd(r.player_id, k, e.target.value)} step={k === "overs" ? "0.1" : "1"}
                        style={{ width: w }} className="h-7 rounded border border-zinc-200 bg-transparent px-1 text-xs text-center tabular text-zinc-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        data-testid={`cell-${k}-${r.player_id}`} />
                    )}
                  </TableCell>
                ))}
                <TableCell className="text-right font-heading font-extrabold text-zinc-950 tabular" data-testid={`pts-${r.player_id}`}>{pointsOf(r.player_id) ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-[11px] text-zinc-500 flex items-center gap-1.5" data-testid="scorecard-footnote">
        <ShieldCheck size={13} weight="bold" className="text-emerald-600" /> Points follow the Dream11 T20 scheme (run +1, four +1, six +2, 50 +8, wicket +25, bowled/LBW +8, maiden +12, catch +8, stumping +12, direct run out +12, playing XI +4, strike-rate and economy bands). Captain 2x and vice-captain 1.5x are applied per team at settlement.
      </p>
    </div>
  );
}

/** Merge imported provider lines into the scorecard form rows (the admin still reviews and saves). */
export function applyImportedLines(rows, lines) {
  const byId = {};
  (lines || []).forEach((l) => { byId[l.player_id] = l; });
  return rows.map((r) => {
    const l = byId[r.player_id];
    if (!l) return r;
    return {
      ...r,
      played: l.played !== false,
      runs: l.runs, balls: l.balls, fours: l.fours, sixes: l.sixes, out: !!l.out,
      overs: ballsToOvers(l.balls_bowled), runs_conceded: l.runs_conceded, wickets: l.wickets,
      maidens: l.maidens, bowled_or_lbw: l.bowled_or_lbw, catches: l.catches, stumpings: l.stumpings,
      run_out_direct: l.run_out_direct, run_out_thrower: l.run_out_thrower,
    };
  });
}

function LiveScoreImport({ match, onFill }) {
  const [cfg, setCfg] = useState(null);
  const [key, setKey] = useState("");
  const [extId, setExtId] = useState("");
  const [feed, setFeed] = useState("scorecard");
  const [live, setLive] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const loadCfg = async () => {
    try { setCfg((await api.get("/admin/scores/config")).data); } catch (e) { setCfg({ key_present: false, env_key_set: false }); }
  };
  useEffect(() => { loadCfg(); }, []);

  const saveKey = async () => {
    if (key.trim().length < 6) { toast.error("Paste a valid API key"); return; }
    setBusy(true);
    try {
      await api.put("/admin/scores/config", { cricapi_key: key.trim() });
      setKey("");
      toast.success("API key saved");
      loadCfg();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save key");
    } finally { setBusy(false); }
  };

  const fetchLive = async () => {
    setBusy(true);
    try {
      setLive((await api.get("/admin/scores/live")).data.matches);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not list live matches");
    } finally { setBusy(false); }
  };

  const runImport = async () => {
    if (!extId.trim()) { toast.error("Enter the match id from the score service"); return; }
    setBusy(true);
    try {
      const { data } = await api.post(`/admin/matches/${match.id}/import-scorecard`, { external_id: extId.trim(), feed });
      setPreview(data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Import failed");
      setPreview(null);
    } finally { setBusy(false); }
  };

  const apply = () => {
    if (!preview) return;
    onFill(preview.lines);
    toast.success(`Filled ${preview.lines.length} players — review the numbers, then save`);
  };

  return (
    <div className="bg-white border border-zinc-200 rounded-lg" data-testid="live-score-import">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left" data-testid="live-score-toggle">
        <span className="flex items-center gap-2">
          <Lightning size={16} weight="fill" className="text-orange-600" />
          <span className="font-heading font-extrabold text-zinc-950 text-sm">Import scorecard from live scores</span>
          <span className={`text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${cfg && cfg.key_present ? "bg-emerald-100 text-emerald-800" : "bg-zinc-200 text-zinc-600"}`} data-testid="live-score-state">
            {cfg ? (cfg.key_present ? "connected" : "no api key") : "loading"}
          </span>
        </span>
        <span className="text-xs font-bold text-zinc-500">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-zinc-100 pt-3 space-y-3">
          {!cfg ? <div className="text-sm text-zinc-500">Loading…</div> : !cfg.key_present ? (
            <div className="bg-amber-50 border border-amber-200 rounded-md p-3 space-y-2" data-testid="live-score-setup">
              <div className="text-sm text-amber-900">Add a free <b>CricAPI / CricketData.org</b> key to pull player stats automatically. Manual entry always works without it.</div>
              <div className="flex flex-wrap gap-2">
                <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="paste api key" type="password" className="max-w-xs tabular" data-testid="scores-key-input" />
                <Button size="sm" disabled={busy} onClick={saveKey} className="rounded-full bg-emerald-600 hover:bg-emerald-700 font-bold" data-testid="scores-key-save">{busy ? "Saving…" : "Save key"}</Button>
              </div>
              <div className="text-[11px] text-amber-800">Prefer a server variable? Set CRICAPI_KEY on the backend and it is used automatically.</div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex-1 min-w-[180px]">
                  <Label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Match id on the score service</Label>
                  <Input value={extId} onChange={(e) => setExtId(e.target.value)} placeholder="e.g. 984321" className="mt-1 tabular" data-testid="scores-ext-id" />
                </div>
                <div>
                  <Label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Feed</Label>
                  <select value={feed} onChange={(e) => setFeed(e.target.value)} className="mt-1 block rounded-md border border-zinc-200 bg-white px-2 py-2 text-sm" data-testid="scores-feed">
                    <option value="scorecard">Full scorecard</option>
                    <option value="fantasy">Fantasy feed</option>
                  </select>
                </div>
                <Button size="sm" disabled={busy} onClick={runImport} className="rounded-full bg-emerald-600 hover:bg-emerald-700 font-bold" data-testid="scores-import-btn">
                  <ChartBar size={15} weight="bold" className="mr-1" /> {busy ? "Working…" : "Import & preview"}
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={fetchLive} className="rounded-full font-bold" data-testid="scores-live-btn">
                  <Trophy size={15} className="mr-1" /> Live matches
                </Button>
              </div>

              {live && (
                <div className="border border-zinc-200 rounded-md max-h-40 overflow-y-auto divide-y divide-zinc-100" data-testid="scores-live-list">
                  {live.length === 0 && <div className="p-3 text-sm text-zinc-500">No live matches right now.</div>}
                  {live.map((m) => (
                    <button key={m.external_id} type="button" onClick={() => setExtId(String(m.external_id))}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-50 flex items-center gap-2" data-testid={`live-item-${m.external_id}`}>
                      <span className="font-bold text-zinc-800 truncate flex-1">{m.name}</span>
                      <span className="text-zinc-500 truncate max-w-[160px]">{m.status}</span>
                      <span className="font-mono text-[10px] text-zinc-400">{m.external_id}</span>
                    </button>
                  ))}
                </div>
              )}

              {preview && (
                <div className="border border-emerald-200 bg-emerald-50/60 rounded-md p-3 space-y-2" data-testid="scores-preview">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm text-emerald-900">
                      <b>{preview.match_title || "Match"}</b> · {preview.status || "no status"} · {preview.players_found} performances found,
                      {" "}<b>{preview.lines.length}</b> matched to your squads.
                    </div>
                    <Button size="sm" onClick={apply} className="rounded-full bg-orange-600 hover:bg-orange-700 text-white font-bold" data-testid="scores-fill-btn">
                      <Check size={15} weight="bold" className="mr-1" /> Fill the form
                    </Button>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-x-4 text-xs">
                    <div>
                      <div className="font-bold uppercase tracking-widest text-[10px] text-emerald-800 mb-1">Matched</div>
                      <div className="max-h-32 overflow-y-auto space-y-0.5">
                        {preview.lines.map((l) => (
                          <div key={l.player_id} className="flex justify-between gap-2" data-testid={`imp-${l.player_id}`}>
                            <span className="truncate text-zinc-800">{l.squad_name} <span className="text-zinc-400">({l.source_name})</span></span>
                            <span className="text-zinc-600 tabular shrink-0">{l.runs}{l.balls ? ` (${l.balls})` : ""}{l.wickets ? ` · ${l.wickets}/${l.runs_conceded} (${ballsToOvers(l.balls_bowled)})` : ""}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-1">
                      {preview.unmatched.length > 0 && (
                        <div>
                          <div className="font-bold uppercase tracking-widest text-[10px] text-amber-800 mb-1">Not matched — check squad spelling</div>
                          {preview.unmatched.map((u) => (
                            <div key={u.source_name} className="flex justify-between gap-2 text-amber-900" data-testid={`unmatched-${u.source_name}`}>
                              <span className="truncate">{u.source_name}</span>
                              <span className="text-[10px]">{u.best_guess ? `closest: ${u.best_guess} (${u.confidence})` : "no similar name"}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {preview.squad_without_stats.length > 0 && (
                        <div>
                          <div className="font-bold uppercase tracking-widest text-[10px] text-zinc-500 mb-1">Squad players with no stats ({preview.squad_without_stats.length})</div>
                          <div className="text-zinc-600">{preview.squad_without_stats.map((s) => s.player).join(", ")}</div>
                        </div>
                      )}
                    </div>
                  </div>
                  <p className="text-[11px] text-emerald-800">Nothing is saved yet — this only pre-fills the form below so you can correct anything and then save.</p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
