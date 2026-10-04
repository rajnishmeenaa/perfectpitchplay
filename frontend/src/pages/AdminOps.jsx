import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Switch } from "../components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { toast } from "sonner";
import { Scroll, FileCsv, DownloadSimple, Broadcast } from "@phosphor-icons/react";

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

  const load = async () => {
    try {
      const [v, a, c] = await Promise.all([
        api.get("/app/version"),
        api.get("/admin/audit?limit=250"),
        api.get("/contests"),
      ]);
      setRel(v.data);
      setAudit(a.data);
      setContests(c.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load app & audit data");
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

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
