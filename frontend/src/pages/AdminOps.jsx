import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Switch } from "../components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { toast } from "sonner";
import { Scroll, FileCsv, DownloadSimple, Broadcast, Coins, Timer, Gauge } from "@phosphor-icons/react";

/**
 * Admin console for the things that keep the shop running: what build the
 * hand-distributed APK should be on, spreadsheet exports, and the action log.
 */
export default function AdminOps() {
  const [rel, setRel] = useState(null);
  const [audit, setAudit] = useState([]);
  const [contests, setContests] = useState([]);
  const [contestId, setContestId] = useState("");
  const [busy, setBusy] = useState(false);
  const [settle, setSettle] = useState(null);
  const [users, setUsers] = useState([]);
  const [bonus, setBonus] = useState({ user_id: "", amount: "", note: "" });

  const load = async () => {
    try {
      const [v, a, c, s, u] = await Promise.all([
        api.get("/app/version"),
        api.get("/admin/audit?limit=250"),
        api.get("/contests"),
        api.get("/admin/settlement"),
        api.get("/admin/users"),
      ]);
      setRel(v.data);
      setAudit(a.data);
      setContests(c.data);
      setSettle(s.data);
      setUsers((u.data || []).filter((x) => x.role !== "admin"));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load app & audit data");
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const saveSettlement = async () => {
    setBusy(true);
    try {
      const { data } = await api.put("/admin/settlement", {
        tax_percent: Number(settle.tax_percent || 0),
        tax_section: settle.tax_section || "",
        bonus_join_enabled: !!settle.bonus_join_enabled,
        auto_close: !!settle.auto_close,
        auto_settle: !!settle.auto_settle,
        settle_grace_minutes: Number(settle.settle_grace_minutes || 0),
      });
      setSettle(data);
      toast.success("Settlement rules saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save settlement rules");
    } finally {
      setBusy(false);
    }
  };

  const runSweep = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/admin/ops/run");
      toast.success(`Sweep done — ${data.closed} contest(s) closed, ${data.settled} settled`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Sweep failed");
    } finally {
      setBusy(false);
    }
  };

  const grantBonus = async (e) => {
    e.preventDefault();
    if (!bonus.user_id || !(Number(bonus.amount) > 0)) {
      toast.error("Pick a user and enter an amount above zero");
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post(`/admin/users/${bonus.user_id}/bonus`, {
        amount: Number(bonus.amount), note: bonus.note || undefined,
      });
      toast.success(`Bonus granted — new balance ₹${data.bonus_balance}`);
      setBonus({ ...bonus, amount: "", note: "" });
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not grant bonus");
    } finally {
      setBusy(false);
    }
  };

  const saveRelease = async () => {
    setBusy(true);
    try {
      const { data } = await api.put("/admin/app/version", {
        version_code: Number(rel.version_code),
        version_name: rel.version_name || "",
        apk_url: rel.apk_url || "",
        notes: rel.notes || "",
        force_update: !!rel.force_update,
      });
      setRel(data);
      toast.success("Release info saved — installed apps will prompt their users");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save release info");
    } finally {
      setBusy(false);
    }
  };

  const download = async (path, name) => {
    setBusy(true);
    try {
      const res = await api.get(path, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      toast.success(`${name} downloaded`);
    } catch (e) {
      toast.error("Export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-zinc-200 rounded-lg p-6" data-testid="ops-release">
        <h2 className="font-heading text-xl font-extrabold text-zinc-950 flex items-center gap-2">
          <Broadcast size={18} weight="fill" className="text-emerald-600" /> App release
        </h2>
        <p className="text-sm text-zinc-500 mt-1">
          The APK you distribute compares its own build number with this. Update it after shipping a new file and users get an in-app prompt.
        </p>
        {rel && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
            <div>
              <Label className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Build number</Label>
              <Input type="number" min="1" value={rel.version_code} onChange={(e) => setRel({ ...rel, version_code: e.target.value })} className="mt-1.5 tabular" data-testid="ops-version-code" />
            </div>
            <div>
              <Label className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Version name</Label>
              <Input value={rel.version_name} onChange={(e) => setRel({ ...rel, version_name: e.target.value })} placeholder="1.2.0" className="mt-1.5" data-testid="ops-version-name" />
            </div>
            <div className="lg:col-span-2">
              <Label className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Download link users tap</Label>
              <Input value={rel.apk_url} onChange={(e) => setRel({ ...rel, apk_url: e.target.value })} placeholder="https://…/PitchPlay.apk" className="mt-1.5" data-testid="ops-apk-url" />
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <Label className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">What is new</Label>
              <Textarea rows={2} value={rel.notes} onChange={(e) => setRel({ ...rel, notes: e.target.value })} placeholder="Live match centre, one XI into many contests…" className="mt-1.5" data-testid="ops-notes" />
            </div>
            <label className="flex items-center gap-2 text-sm font-bold text-zinc-700" data-testid="ops-force-label">
              <Switch checked={!!rel.force_update} onCheckedChange={(v) => setRel({ ...rel, force_update: v })} />
              Treat older builds as unusable
            </label>
            <div className="flex items-end">
              <Button disabled={busy} onClick={saveRelease} className="rounded-md bg-emerald-600 hover:bg-emerald-700 font-bold" data-testid="ops-save-release">Save release info</Button>
            </div>
          </div>
        )}
        {rel?.updated_at && <p className="text-[11px] text-zinc-400 mt-3">Last changed {new Date(rel.updated_at).toLocaleString("en-IN")}</p>}
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg p-6" data-testid="ops-settlement">
        <h2 className="font-heading text-xl font-extrabold text-zinc-950 flex items-center gap-2">
          <Gauge size={18} weight="fill" className="text-gold" /> Settlement & automation
        </h2>
        <p className="text-sm text-zinc-500 mt-1">
          Tax withheld on every prize when you settle (0 keeps it off until your CA confirms the rate), plus the background jobs that close entries and settle contests.
        </p>
        {settle && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
            <div>
              <Label className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Tax on prizes (%)</Label>
              <Input type="number" min="0" max="30" step="0.01" value={settle.tax_percent}
                onChange={(e) => setSettle({ ...settle, tax_percent: e.target.value })}
                className="mt-1.5 tabular" data-testid="settle-tax" />
            </div>
            <div>
              <Label className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Section note</Label>
              <Input value={settle.tax_section || ""} onChange={(e) => setSettle({ ...settle, tax_section: e.target.value })}
                placeholder="e.g. 194BA" className="mt-1.5" data-testid="settle-section" />
            </div>
            <div>
              <Label className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Auto-settle grace (min)</Label>
              <Input type="number" min="0" max="10080" value={settle.settle_grace_minutes}
                onChange={(e) => setSettle({ ...settle, settle_grace_minutes: e.target.value })}
                className="mt-1.5 tabular" data-testid="settle-grace" />
            </div>
            <div className="flex items-end">
              <Button variant="outline" disabled={busy} onClick={runSweep} className="rounded-md font-bold w-full" data-testid="ops-run-sweep">
                <Timer size={15} weight="bold" className="mr-1.5" /> Run sweep now
              </Button>
            </div>
            <label className="flex items-center justify-between gap-3 text-sm font-bold text-zinc-700 lg:col-span-2" data-testid="settle-label-autoclose">
              Close entries when the match starts
              <Switch checked={!!settle.auto_close} onCheckedChange={(v) => setSettle({ ...settle, auto_close: v })} />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm font-bold text-zinc-700 lg:col-span-2" data-testid="settle-label-autosettle">
              Settle finished contests automatically
              <Switch checked={!!settle.auto_settle} onCheckedChange={(v) => setSettle({ ...settle, auto_settle: v })} />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm font-bold text-zinc-700 lg:col-span-4" data-testid="settle-label-bonus">
              Let members spend bonus cash on entry fees
              <Switch checked={!!settle.bonus_join_enabled} onCheckedChange={(v) => setSettle({ ...settle, bonus_join_enabled: v })} />
            </label>
            <div className="lg:col-span-4 flex items-center gap-3">
              <Button disabled={busy} onClick={saveSettlement} className="rounded-md bg-emerald-600 hover:bg-emerald-700 font-bold" data-testid="ops-save-settlement">
                Save rules
              </Button>
              <p className="text-[11px] text-zinc-400">
                Auto-settle pays winners without you pressing the button — leave it off until you trust the scorecard flow.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg p-6" data-testid="ops-bonus">
        <h2 className="font-heading text-xl font-extrabold text-zinc-950 flex items-center gap-2">
          <Coins size={18} weight="fill" className="text-gold" /> Bonus cash
        </h2>
        <p className="text-sm text-zinc-500 mt-1">
          Promotional money a member can use on entry fees but can never withdraw. Useful for refunds, win-backs and referral rewards.
        </p>
        <form onSubmit={grantBonus} className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
          <div className="lg:col-span-2">
            <Label className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Member</Label>
            <select value={bonus.user_id} onChange={(e) => setBonus({ ...bonus, user_id: e.target.value })}
              className="mt-1.5 block w-full max-w-sm rounded-md border border-zinc-200 px-3 py-2 text-sm font-bold" data-testid="bonus-user">
              <option value="">Choose a member…</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.mobile} · bonus ₹{Number(u.bonus_balance || 0)}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Amount (₹)</Label>
            <Input type="number" min="1" value={bonus.amount} onChange={(e) => setBonus({ ...bonus, amount: e.target.value })}
              className="mt-1.5 tabular" data-testid="bonus-amount" />
          </div>
          <div>
            <Label className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Note</Label>
            <Input value={bonus.note} onChange={(e) => setBonus({ ...bonus, note: e.target.value })} placeholder="Referral reward"
              className="mt-1.5" data-testid="bonus-note" />
          </div>
          <div className="lg:col-span-4">
            <Button type="submit" disabled={busy} className="rounded-md bg-gold text-night hover:bg-gold-light font-extrabold" data-testid="bonus-grant-btn">
              Grant bonus
            </Button>
          </div>
        </form>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg p-6" data-testid="ops-exports">
        <h2 className="font-heading text-xl font-extrabold text-zinc-950 flex items-center gap-2">
          <FileCsv size={18} weight="bold" className="text-emerald-600" /> Exports
        </h2>
        <p className="text-sm text-zinc-500 mt-1">Spreadsheet-ready dumps straight from live data — entries, payouts and refunds.</p>
        <div className="flex flex-wrap items-end gap-3 mt-4">
          <div>
            <Label className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Filter entries by contest</Label>
            <select value={contestId} onChange={(e) => setContestId(e.target.value)} className="mt-1.5 block rounded-md border border-zinc-200 px-3 py-2 text-sm font-bold max-w-xs" data-testid="ops-contest-filter">
              <option value="">All contests</option>
              {contests.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>
          <Button variant="outline" disabled={busy} onClick={() => download(`/admin/export/entries.csv${contestId ? `?contest_id=${contestId}` : ""}`, "pitchplay-entries.csv")} className="rounded-md font-bold" data-testid="export-entries-btn">
            <DownloadSimple size={15} weight="bold" className="mr-1.5" /> Entries CSV
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => download("/admin/export/payouts.csv", "pitchplay-payouts.csv")} className="rounded-md font-bold" data-testid="export-payouts-btn">
            <DownloadSimple size={15} weight="bold" className="mr-1.5" /> Payouts CSV
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => download(`/admin/export/entries.csv?status=refunded${contestId ? `&contest_id=${contestId}` : ""}`, "pitchplay-refunds.csv")} className="rounded-md font-bold" data-testid="export-refunds-btn">
            <DownloadSimple size={15} weight="bold" className="mr-1.5" /> Refunds CSV
          </Button>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden" data-testid="ops-audit">
        <div className="p-6 pb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-heading text-xl font-extrabold text-zinc-950 flex items-center gap-2">
              <Scroll size={18} weight="bold" className="text-emerald-600" /> Admin action log
            </h2>
            <p className="text-sm text-zinc-500 mt-1">Every change made from an admin account, newest first. Request bodies are never stored.</p>
          </div>
          <Button variant="outline" size="sm" onClick={load} className="rounded-full font-bold" data-testid="ops-audit-refresh">Reload</Button>
        </div>
        {audit.length === 0 ? (
          <div className="px-6 pb-8 text-sm text-zinc-500">Nothing recorded yet.</div>
        ) : (
          <div className="max-h-[460px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Admin</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Detail</TableHead>
                  <TableHead className="text-right">HTTP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {audit.map((a) => (
                  <TableRow key={a.id} className="even:bg-zinc-50/40" data-testid={`audit-row-${a.id}`}>
                    <TableCell className="text-xs tabular whitespace-nowrap">{new Date(a.at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}</TableCell>
                    <TableCell className="text-sm font-semibold">{a.admin_name}</TableCell>
                    <TableCell className="text-xs">
                      <span className="font-extrabold uppercase mr-1.5">{a.method}</span>
                      <span className="text-zinc-600 break-all">{String(a.path || "").replace("/api/", "")}</span>
                    </TableCell>
                    <TableCell className="text-xs text-zinc-500 max-w-[260px] truncate">{a.query || "—"}</TableCell>
                    <TableCell className="text-xs tabular text-right">{a.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
