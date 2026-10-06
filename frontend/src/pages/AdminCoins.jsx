import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { toast } from "sonner";
import { Coins, Plus, Trash, Crown, MagnifyingGlass, Minus } from "@phosphor-icons/react";

const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const coinsFmt = (n) => Number(n || 0).toLocaleString("en-IN");

const emptyPack = { id: "", kind: "coins", title: "", coins: 0, price_inr: 0, tag: "", active: true };

export default function AdminCoins() {
  const [settings, setSettings] = useState(null);
  const [stats, setStats] = useState(null);
  const [charges, setCharges] = useState([]);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [grantOpen, setGrantOpen] = useState(false);

  const load = async () => {
    try {
      const [c, ch] = await Promise.all([api.get("/admin/coins"), api.get("/admin/coins/charges")]);
      setSettings(c.data.settings);
      setStats(c.data.stats);
      setForm({ ...c.data.settings, packs: (c.data.settings.packs || []).map((p) => ({ ...p })) });
      setCharges(ch.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load coin settings");
    }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        enabled: form.enabled,
        signup_bonus: Number(form.signup_bonus || 0),
        daily_bonus: Number(form.daily_bonus || 0),
        plus_discount_pct: Number(form.plus_discount_pct || 0),
        plus_price_coins: Number(form.plus_price_coins || 0),
        plus_days: Number(form.plus_days || 0),
        billing_mode: form.billing_mode || "sandbox",
        packs: (form.packs || []).map((p) => ({ ...p, coins: Number(p.coins || 0), price_inr: Number(p.price_inr || 0) })),
      };
      const r = await api.put("/admin/coins", body);
      setSettings(r.data.settings);
      setForm({ ...r.data.settings, packs: (r.data.settings.packs || []).map((p) => ({ ...p })) });
      toast.success("Coin settings saved");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const setPack = (i, key, val) => setForm({ ...form, packs: form.packs.map((p, j) => (j === i ? { ...p, [key]: val } : p)) });

  const statCards = [
    { label: "Coins in circulation", value: stats ? coinsFmt(stats.circulating) : "—", testid: "coins-stat-circulating" },
    { label: "Coin holders", value: stats ? coinsFmt(stats.holders) : "—", testid: "coins-stat-holders" },
    { label: "Coins sold (paid)", value: stats ? coinsFmt(stats.coins_sold) : "—", testid: "coins-stat-sold" },
    { label: "Spent on entries", value: stats ? coinsFmt(stats.entry_fees_coins) : "—", testid: "coins-stat-entryfees" },
    { label: "Store charges", value: stats ? coinsFmt(stats.charges) : "—", testid: "coins-stat-charges" },
  ];

  if (!form) {
    return <div className="text-zinc-500 py-10 text-center">Loading coin economy…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading text-3xl font-extrabold tracking-tighter text-zinc-950 flex items-center gap-2">
            <Coins size={26} weight="fill" className="text-amber-500" /> Coins &amp; store
          </h1>
          <p className="text-zinc-500 mt-1">Pitch Coins economy: bonuses, the store catalog, PitchPlus and sandbox vs Google Play billing.</p>
        </div>
        <Button onClick={() => setGrantOpen(true)} variant="outline" className="border-amber-300 text-amber-800 hover:bg-amber-50 font-bold rounded-full" data-testid="open-grant-btn">
          <Coins size={16} weight="fill" className="mr-1" /> Grant coins
        </Button>
      </div>

      <div className="grid sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {statCards.map(({ label, value, testid }) => (
          <div key={label} className="bg-white border border-zinc-200 rounded-lg p-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{label}</div>
            <div className="font-heading text-2xl font-extrabold text-zinc-950 tabular mt-1" data-testid={testid}>{value}</div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5" data-testid="coins-settings-form">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="font-heading font-extrabold text-zinc-950">Coin economy</div>
            <div className="text-xs text-zinc-500">Signup and daily bonuses, entry-fee discount for PitchPlus members.</div>
          </div>
          <label className="flex items-center gap-3 cursor-pointer" data-testid="coins-enabled-toggle">
            <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
            <span className="text-sm font-bold text-zinc-700">{form.enabled ? "Coins enabled" : "Coins disabled"}</span>
          </label>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <Field label="Signup bonus"><Input type="number" min="0" value={form.signup_bonus} onChange={(e) => setForm({ ...form, signup_bonus: e.target.value })} data-testid="coins-signup-bonus" /></Field>
          <Field label="Daily bonus"><Input type="number" min="0" value={form.daily_bonus} onChange={(e) => setForm({ ...form, daily_bonus: e.target.value })} data-testid="coins-daily-bonus" /></Field>
          <Field label="Plus entry discount %"><Input type="number" min="0" max="90" value={form.plus_discount_pct} onChange={(e) => setForm({ ...form, plus_discount_pct: e.target.value })} data-testid="coins-plus-discount" /></Field>
          <Field label="Plus price (coins)"><Input type="number" min="0" value={form.plus_price_coins} onChange={(e) => setForm({ ...form, plus_price_coins: e.target.value })} data-testid="coins-plus-price" /></Field>
          <Field label="Plus duration (days)"><Input type="number" min="1" value={form.plus_days} onChange={(e) => setForm({ ...form, plus_days: e.target.value })} data-testid="coins-plus-days" /></Field>
        </div>

        <div>
          <Label className="text-xs font-bold uppercase tracking-widest text-zinc-500">Billing mode</Label>
          <div className="flex gap-2 mt-2" data-testid="coins-billing-mode">
            {[["sandbox", "Sandbox (instant, for testing)"], ["play", "Google Play (real purchases)"]].map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setForm({ ...form, billing_mode: mode })}
                className={`px-4 py-2 rounded-md text-sm font-bold border transition-colors ${form.billing_mode === mode ? "bg-zinc-950 text-white border-zinc-950" : "bg-white text-zinc-600 border-zinc-300 hover:border-zinc-500"}`}
                data-testid={`coins-billing-${mode}`}
              >
                {label}
              </button>
            ))}
          </div>
          {form.billing_mode === "play" && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-2" data-testid="coins-play-warning">
              Play mode blocks store checkouts until Google Play Billing is wired in — users see a “check back soon” notice.
            </p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between">
            <Label className="text-xs font-bold uppercase tracking-widest text-zinc-500">Store packs</Label>
            <Button size="sm" variant="outline" onClick={() => setForm({ ...form, packs: [...form.packs, { ...emptyPack }] })} data-testid="add-pack-btn">
              <Plus size={14} className="mr-1" /> Add pack
            </Button>
          </div>
          <div className="space-y-2 mt-2">
            {form.packs.map((p, i) => (
              <div key={i} className="grid grid-cols-2 md:grid-cols-7 gap-2 items-end bg-zinc-50 border border-zinc-200 rounded-lg p-3" data-testid={`pack-row-${i}`}>
                <Field label="Pack ID"><Input value={p.id} onChange={(e) => setPack(i, "id", e.target.value)} placeholder="coins_100" data-testid={`pack-id-${i}`} /></Field>
                <Field label="Kind">
                  <select value={p.kind} onChange={(e) => setPack(i, "kind", e.target.value)} className="w-full h-10 rounded-md border border-zinc-300 bg-white px-2 text-sm" data-testid={`pack-kind-${i}`}>
                    <option value="coins">coins</option>
                    <option value="plus">plus</option>
                  </select>
                </Field>
                <Field label="Title"><Input value={p.title} onChange={(e) => setPack(i, "title", e.target.value)} data-testid={`pack-title-${i}`} /></Field>
                <Field label="Coins"><Input type="number" min="0" value={p.coins} onChange={(e) => setPack(i, "coins", e.target.value)} data-testid={`pack-coins-${i}`} /></Field>
                <Field label="Price ₹"><Input type="number" min="0" value={p.price_inr} onChange={(e) => setPack(i, "price_inr", e.target.value)} data-testid={`pack-price-${i}`} /></Field>
                <Field label="Tag"><Input value={p.tag || ""} onChange={(e) => setPack(i, "tag", e.target.value)} placeholder="Popular" data-testid={`pack-tag-${i}`} /></Field>
                <div className="flex items-center gap-2 pb-0.5">
                  <label className="flex items-center gap-2 text-xs font-bold text-zinc-600">
                    <Switch checked={p.active !== false} onCheckedChange={(v) => setPack(i, "active", v)} /> Live
                  </label>
                  <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => setForm({ ...form, packs: form.packs.filter((_, j) => j !== i) })} data-testid={`remove-pack-${i}`}>
                    <Trash size={14} />
                  </Button>
                </div>
              </div>
            ))}
            {form.packs.length === 0 && <div className="text-sm text-zinc-500 border border-dashed border-zinc-300 rounded-lg p-4 text-center">No packs — the store will look empty. Add at least one.</div>}
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={save} disabled={saving} className="bg-turf hover:bg-turf-red-dark font-bold" data-testid="coins-save-btn">
            {saving ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden" data-testid="coin-charges-table">
        <div className="px-4 py-3 border-b border-zinc-100 text-xs font-bold uppercase tracking-widest text-zinc-500">Store charges ({charges.length})</div>
        <Table>
          <TableHeader>
            <TableRow className="bg-zinc-50">
              <TableHead className="font-bold text-zinc-700">Order</TableHead>
              <TableHead className="font-bold text-zinc-700">User</TableHead>
              <TableHead className="font-bold text-zinc-700">Pack</TableHead>
              <TableHead className="font-bold text-zinc-700">Coins / Price</TableHead>
              <TableHead className="font-bold text-zinc-700">Mode</TableHead>
              <TableHead className="font-bold text-zinc-700">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {charges.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-10 text-zinc-500">No store charges yet</TableCell></TableRow>
            ) : charges.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="tabular text-xs text-zinc-500">{c.order_id || c.id}</TableCell>
                <TableCell>
                  <div className="font-bold text-zinc-950">{c.user_name || "—"}</div>
                  <div className="text-xs text-zinc-500 tabular">{c.user_mobile || ""}</div>
                </TableCell>
                <TableCell>
                  <div className="font-semibold text-zinc-800 flex items-center gap-1">
                    {c.kind === "plus" ? <Crown size={13} weight="fill" className="text-amber-500" /> : <Coins size={13} weight="fill" className="text-amber-500" />}
                    {c.pack_title || c.pack_id}
                  </div>
                </TableCell>
                <TableCell className="tabular">
                  {c.kind === "plus" ? `Plus ${c.plus_days || ""}d` : coinsFmt(c.coins)}
                  <div className="text-xs text-zinc-500">{money(c.price_inr)}</div>
                </TableCell>
                <TableCell><span className="text-xs font-bold uppercase text-zinc-600">{c.billing_mode}</span></TableCell>
                <TableCell><span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800">{c.status}</span></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <GrantDialog open={grantOpen} onClose={() => setGrantOpen(false)} onDone={load} />
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <Label className="text-xs font-bold uppercase tracking-widest text-zinc-500">{label}</Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function GrantDialog({ open, onClose, onDone }) {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState([]);
  const [picked, setPicked] = useState(null);
  const [amt, setAmt] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    api.get("/admin/users").then((r) => setUsers((r.data || []).filter((u) => u.role !== "admin"))).catch(() => {});
    return undefined;
  }, [open]);

  const needle = q.trim().toLowerCase();
  const shown = needle
    ? users.filter((u) => (u.name || "").toLowerCase().includes(needle) || (u.mobile || "").includes(needle)).slice(0, 6)
    : users.slice(0, 6);

  const grant = async (sign) => {
    const n = Number(amt);
    if (!picked) { toast.error("Pick a user first"); return; }
    if (!n || n <= 0) { toast.error("Enter coin amount"); return; }
    setBusy(true);
    try {
      const r = await api.post("/admin/coins/grant", { user_id: picked.id, delta: sign * n, note });
      toast.success(`${sign > 0 ? "Credited" : "Debited"} — new balance ${coinsFmt(r.data.coins)} coins`);
      setPicked(null); setAmt(""); setNote(""); setQ("");
      onDone();
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm" data-testid="grant-coins-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading font-extrabold">Grant coins</DialogTitle>
          <DialogDescription>Add or remove Pitch Coins for a player. Every grant is written to their coin history.</DialogDescription>
        </DialogHeader>
        {picked ? (
          <div className="flex items-center justify-between gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" data-testid="grant-picked">
            <div className="min-w-0">
              <div className="font-bold text-zinc-950 truncate">{picked.name}</div>
              <div className="text-xs text-zinc-500 tabular">{picked.mobile} · {coinsFmt(picked.coins)} coins</div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>Change</Button>
          </div>
        ) : (
          <div>
            <div className="relative">
              <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or mobile" className="pl-9" data-testid="grant-user-search" />
            </div>
            <div className="mt-2 divide-y divide-zinc-100 border border-zinc-200 rounded-lg max-h-52 overflow-y-auto">
              {shown.map((u) => (
                <button key={u.id} type="button" onClick={() => setPicked(u)} className="w-full text-left px-3 py-2 hover:bg-amber-50" data-testid={`grant-user-${u.id}`}>
                  <div className="text-sm font-bold text-zinc-950">{u.name}</div>
                  <div className="text-xs text-zinc-500 tabular">{u.mobile} · {coinsFmt(u.coins)} coins</div>
                </button>
              ))}
              {shown.length === 0 && <div className="px-3 py-3 text-sm text-zinc-500">No users found</div>}
            </div>
          </div>
        )}
        <Field label="Coins">
          <Input type="number" min="0" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="e.g. 250" data-testid="grant-amount" />
        </Field>
        <Field label="Note (optional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} data-testid="grant-note" />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={busy || !picked} onClick={() => grant(-1)} data-testid="grant-debit">
            <Minus size={14} className="mr-1" /> Debit
          </Button>
          <Button disabled={busy || !picked} onClick={() => grant(1)} className="bg-turf hover:bg-turf-red-dark font-bold" data-testid="grant-credit">
            <Coins size={14} weight="fill" className="mr-1" /> Credit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
