import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { toast } from "sonner";
import { Check, WarningCircle, X, CaretDown, Info } from "@phosphor-icons/react";

const XI_LABEL = { confirmed: "In XI", projected: "TBC", rested: "Rested", injured: "Injured", dropped: "Out" };
const XI_SKIN = {
  confirmed: "bg-emerald-100 text-emerald-800 border-emerald-200",
  projected: "bg-zinc-100 text-zinc-600 border-zinc-200",
  rested: "bg-red-100 text-red-700 border-red-200",
  injured: "bg-red-100 text-red-700 border-red-200",
  dropped: "bg-red-100 text-red-700 border-red-200",
};

/** Small playing-status badge used in squads, the builder and the XI board. */
export function XiChip({ status = "projected", note = "", testid, className = "" }) {
  return (
    <span
      data-testid={testid}
      title={note || XI_LABEL[status] || ""}
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${XI_SKIN[status] || XI_SKIN.projected} ${className}`}
    >
      {XI_LABEL[status] || status}
    </span>
  );
}

/** Announced playing XIs for a match, with the players left out and why. */
export function XiBoard({ matchId, className = "" }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    setData(null);
    if (matchId) api.get(`/matches/${matchId}/xi`).then((r) => alive && setData(r.data)).catch(() => {});
    return () => { alive = false; };
  }, [matchId]);
  if (!data || !data.announced) return null;
  const codes = Object.keys(data.teams || {});
  return (
    <div className={`bg-white border border-zinc-200 rounded-lg overflow-hidden ${className}`} data-testid="xi-board">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-zinc-50"
        data-testid="xi-board-toggle"
      >
        <span className="font-heading font-bold text-zinc-950 flex items-center gap-2">
          <Check size={16} weight="bold" className="text-emerald-600" /> Playing XI announced
        </span>
        <span className="flex items-center gap-2 text-[11px] text-zinc-500">
          {new Date(data.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
          <CaretDown size={14} weight="bold" className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 grid sm:grid-cols-2 gap-4">
          {codes.map((code) => {
            const side = data.teams[code] || {};
            return (
              <div key={code} className="min-w-0">
                <div className="text-[11px] font-extrabold uppercase tracking-widest text-zinc-500">{code}</div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {(side.confirmed || []).map((p) => (
                    <span key={p.id} className="text-[11px] font-semibold text-zinc-800 bg-zinc-100 border border-zinc-200 rounded px-1.5 py-0.5" data-testid={`xi-in-${p.id}`}>
                      {p.name} <span className="text-zinc-500">{p.role}</span>
                    </span>
                  ))}
                </div>
                {(side.out || []).length > 0 && (
                  <div className="mt-2 text-[11px] space-y-0.5">
                    {(side.out || []).map((p) => (
                      <div key={p.id} className="flex items-center gap-1.5 text-red-700" data-testid={`xi-out-${p.id}`}>
                        <X size={11} weight="bold" /> <span className="font-semibold">{p.name}</span>
                        {p.note && <span className="text-zinc-500">· {p.note}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Banner + one-tap repair for saved XIs that contain players the announced XI
 * left out. Candidates come back already filtered by credits, role bands and
 * the seven-per-side cap, so tapping one cannot build an illegal team.
 */
export function XiAlerts({ onFixed }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get("/me/xi-alerts").then((r) => setData(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const swap = async (alert, fix, candidate) => {
    setBusy(true);
    try {
      const { data: res } = await api.post(`/fantasy/teams/${alert.team_id}/swap`, {
        out_player_id: fix.out.id, in_player_id: candidate.id,
      });
      toast.success(`${candidate.name} is in for ${fix.out.name}`);
      if (res.leadership_note) toast.info(res.leadership_note);
      await load();
      onFixed?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not swap that player");
    } finally { setBusy(false); }
  };

  const fixAll = async () => {
    setBusy(true);
    try {
      const { data: res } = await api.post("/me/xi-alerts/fix-all");
      if (res.fixed) toast.success(`${res.fixed} pick${res.fixed === 1 ? "" : "s"} swapped`);
      (res.skipped || []).forEach((s) => toast.error(`${s.player}: ${s.reason}`));
      await load();
      onFixed?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not fix the teams");
    } finally { setBusy(false); }
  };

  if (!data || !data.count) return null;
  const picks = data.alerts.reduce((n, a) => n + a.fixes.length, 0);

  return (
    <div className="mb-5 rounded-lg border border-red-300 bg-red-50 p-4" data-testid="xi-alerts">
      <div className="flex flex-wrap items-center gap-2">
        <WarningCircle size={18} weight="fill" className="text-red-600" />
        <div className="font-heading font-extrabold text-red-900">
          {picks} of your picks {picks === 1 ? "is" : "are"} out of the announced XI
        </div>
        <Button size="sm" onClick={fixAll} disabled={busy} className="ml-auto rounded-full bg-red-600 hover:bg-red-700 text-white font-bold" data-testid="xi-fix-all">
          Fix everything
        </Button>
      </div>

      <div className="mt-3 space-y-3">
        {data.alerts.map((a) => (
          <div key={a.team_id} className="rounded-md border border-red-200 bg-white p-3" data-testid={`xi-alert-${a.team_id}`}>
            <div className="text-[11px] font-extrabold uppercase tracking-widest text-zinc-500">
              {a.team_name} · {a.match_label}
              {a.contests?.length ? ` · ${a.contests.length} contest${a.contests.length === 1 ? "" : "s"}` : ""}
            </div>
            {a.fixes.map((f) => (
              <div key={f.out.id} className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-red-700 line-through decoration-red-300">{f.out.name}</span>
                <span className="text-[11px] text-zinc-500 uppercase font-bold tracking-wider">{f.out.status}{f.out.note ? ` · ${f.out.note}` : ""}</span>
                <ArrowGlyph />
                {f.candidates.length ? (
                  f.candidates.slice(0, 3).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      disabled={busy}
                      onClick={() => swap(a, f, c)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[12px] font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
                      data-testid={`xi-swap-${a.team_id}-${c.id}`}
                    >
                      <Check size={12} weight="bold" /> {c.name} <span className="text-emerald-600 tabular">{c.credits} cr</span>
                    </button>
                  ))
                ) : (
                  <span className="text-[12px] text-zinc-500 flex items-center gap-1" data-testid={`xi-blocked-${f.out.id}`}>
                    <Info size={12} weight="bold" /> {f.blocked_reason || "No legal replacement left"}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ArrowGlyph() {
  return <span className="text-zinc-400 font-extrabold">→</span>;
}

/**
 * Admin: name the eleven for each side and publish. Publishing flips every
 * squad member's status, so a second publish of the same XI changes nothing and
 * notifies nobody — it is safe to correct a typo.
 */
export function XiPublisher({ match, players, onPublished }) {
  const sides = [match.team_a_short, match.team_b_short];
  const [picks, setPicks] = useState({ [match.team_a_short]: [], [match.team_b_short]: [] });
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [announced, setAnnounced] = useState(null);

  useEffect(() => {
    if (!match.id) return;
    api.get(`/matches/${match.id}/xi`).then((r) => {
      if (!r.data.announced) return;
      const next = {};
      sides.forEach((s) => { next[s] = (r.data.teams[s]?.confirmed || []).map((p) => p.id); });
      setPicks(next);
      setAnnounced(r.data.at);
    }).catch(() => {});
    // eslint-disable-next-line
  }, [match.id]);

  const toggle = (side, id) => {
    const cur = picks[side] || [];
    if (cur.includes(id)) { setPicks({ ...picks, [side]: cur.filter((x) => x !== id) }); return; }
    if (cur.length >= 11) { toast.error(`${side} already has 11 players`); return; }
    setPicks({ ...picks, [side]: [...cur, id] });
  };

  const publish = async () => {
    setBusy(true);
    try {
      const { data } = await api.put(`/admin/matches/${match.id}/xi`, { xis: picks, notify, source: "manual" });
      toast.success(`XI published · ${data.changed} player status${data.changed === 1 ? "" : "es"} changed`);
      if (data.notified) toast.info(`${data.notified} player${data.notified === 1 ? "" : "s"} notified`);
      setAnnounced(new Date().toISOString());
      onPublished?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not publish the XI");
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-5" data-testid="xi-publisher">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-heading font-bold text-zinc-950">Playing XI</div>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            {announced
              ? `Announced ${new Date(announced).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} — publish again to correct it.`
              : "Name the eleven for each side. Players not listed are marked out and their entrants are alerted."}
          </p>
        </div>
        <label className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-zinc-500 shrink-0" data-testid="xi-notify-label">
          <Switch checked={notify} onCheckedChange={setNotify} /> Notify
        </label>
      </div>

      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        {sides.map((side) => {
          const squad = players.filter((p) => (p.team || "").toUpperCase() === (side || "").toUpperCase());
          const cur = picks[side] || [];
          return (
            <div key={side} className="min-w-0">
              <div className="flex items-center justify-between text-[11px] font-extrabold uppercase tracking-widest text-zinc-500">
                <span>{side}</span>
                <span className={`tabular ${cur.length === 11 ? "text-emerald-700" : "text-zinc-400"}`} data-testid={`xi-count-${side}`}>{cur.length}/11</span>
              </div>
              <div className="mt-1.5 max-h-56 overflow-y-auto rounded border border-zinc-200 divide-y divide-zinc-100">
                {squad.map((p) => {
                  const on = cur.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggle(side, p.id)}
                      className={`w-full px-2.5 py-1.5 flex items-center gap-2 text-left text-[12px] ${on ? "bg-emerald-50" : "hover:bg-zinc-50"}`}
                      data-testid={`xi-pick-${p.id}`}
                    >
                      <span className={`w-4 h-4 rounded border grid place-items-center shrink-0 ${on ? "bg-turf border-turf text-white" : "border-zinc-300 text-transparent"}`}>
                        <Check size={10} weight="bold" />
                      </span>
                      <span className="truncate font-semibold text-zinc-900">{p.name}</span>
                      <span className="ml-auto text-[10px] font-bold uppercase text-zinc-500">{p.role}</span>
                    </button>
                  );
                })}
                {!squad.length && <div className="p-3 text-[11px] text-zinc-500">No squad for {side} yet.</div>}
              </div>
            </div>
          );
        })}
      </div>

      <Button
        onClick={publish}
        disabled={busy || sides.some((s) => (picks[s] || []).length !== 11)}
        className="mt-4 w-full rounded-md bg-turf hover:bg-turf-red-dark font-bold"
        data-testid="xi-publish-btn"
      >
        {busy ? "Publishing…" : announced ? "Re-publish the XI" : "Publish the playing XI"}
      </Button>
    </div>
  );
}
