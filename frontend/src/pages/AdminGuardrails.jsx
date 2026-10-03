import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Switch } from "../components/ui/switch";
import { toast } from "sonner";
import { ShieldCheck, Scales, Lock, Trophy, Check, Coins } from "@phosphor-icons/react";

const NUM_FIELDS = [
  { key: "min_withdrawal", label: "Minimum withdrawal (₹)", hint: "Requests below this are rejected. Set 1 to allow any amount." },
  { key: "max_withdrawal_per_day", label: "Withdrawal cap per day (₹)", hint: "0 = no cap. Limits how much one user can pull out in a day." },
  { key: "max_entries_per_user_per_day", label: "Entry cap per user per day", hint: "0 = no cap. Stops one account flooding your contests." },
  { key: "max_entries_per_user_per_contest", label: "Entry cap per user per contest", hint: "0 = no cap (fantasy contests use their own teams-per-user setting)." },
];

const TOGGLES = [
  { key: "require_terms_acceptance", label: "Block joins & withdrawals until terms accepted", hint: "Off = users still see the one-time notice, but the server will not reject them. Turn on for strict enforcement." },
  { key: "require_age_gate", label: "Require the 18+ confirmation", hint: "Same notice, tracked separately per account." },
  { key: "refund_on_abandon", label: "Auto-refund entry fees when a match is abandoned", hint: "Credits every paid entry back to the user's wallet with a notification." },
];

export default function AdminGuardrails() {
  const [g, setG] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/admin/guardrails").then((r) => setG(r.data)).catch(() => toast.error("Could not load guardrails"));
  }, []);

  if (!g) return <div className="text-sm text-zinc-500">Loading…</div>;

  const setNum = (k) => (e) => setG({ ...g, [k]: e.target.value });
  const setFlag = (k) => (v) => setG({ ...g, [k]: v });
  const setText = (k) => (e) => setG({ ...g, [k]: e.target.value });

  const save = async () => {
    setBusy(true);
    try {
      const payload = {
        min_withdrawal: Number(g.min_withdrawal || 0),
        max_withdrawal_per_day: Number(g.max_withdrawal_per_day || 0),
        max_entries_per_user_per_day: Number(g.max_entries_per_user_per_day || 0),
        max_entries_per_user_per_contest: Number(g.max_entries_per_user_per_contest || 0),
        require_terms_acceptance: !!g.require_terms_acceptance,
        require_age_gate: !!g.require_age_gate,
        refund_on_abandon: !!g.refund_on_abandon,
        terms_version: String(g.terms_version || "1.0").trim(),
        terms_title: String(g.terms_title || "").trim(),
        terms_body: String(g.terms_body || "").trim(),
      };
      const { data } = await api.put("/admin/guardrails", payload);
      setG(data);
      toast.success("Guardrails saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="font-heading text-3xl font-extrabold tracking-tighter text-zinc-950 flex items-center gap-2">
          <Scales size={26} weight="fill" className="text-emerald-600" /> Guardrails & legal
        </h1>
        <p className="text-zinc-500 mt-1">Money-safety limits, refund behaviour and the terms notice every user sees once.</p>
      </div>

      <section className="bg-white border border-zinc-200 rounded-lg p-5" data-testid="guardrail-limits">
        <h2 className="font-heading font-extrabold text-zinc-950 flex items-center gap-2"><Coins size={18} weight="fill" className="text-orange-600" /> Payout & entry limits</h2>
        <div className="grid sm:grid-cols-2 gap-4 mt-4">
          {NUM_FIELDS.map((f) => (
            <div key={f.key}>
              <Label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{f.label}</Label>
              <Input value={g[f.key]} onChange={setNum(f.key)} inputMode="decimal" className="mt-1 tabular" data-testid={`guard-${f.key}`} />
              <p className="text-[11px] text-zinc-500 mt-1">{f.hint}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white border border-zinc-200 rounded-lg p-5 space-y-3" data-testid="guardrail-toggles">
        <h2 className="font-heading font-extrabold text-zinc-950 flex items-center gap-2"><Lock size={18} weight="fill" className="text-emerald-600" /> Enforcement</h2>
        {TOGGLES.map((t) => (
          <div key={t.key} className="flex items-start justify-between gap-4 border-b border-zinc-100 pb-3 last:border-0 last:pb-0">
            <div className="min-w-0">
              <div className="text-sm font-bold text-zinc-900">{t.label}</div>
              <p className="text-[11px] text-zinc-500 mt-0.5">{t.hint}</p>
            </div>
            <Switch checked={!!g[t.key]} onCheckedChange={setFlag(t.key)} data-testid={`guard-toggle-${t.key}`} />
          </div>
        ))}
      </section>

      <section className="bg-white border border-zinc-200 rounded-lg p-5 space-y-3" data-testid="guardrail-terms">
        <h2 className="font-heading font-extrabold text-zinc-950 flex items-center gap-2"><ShieldCheck size={18} weight="fill" className="text-emerald-600" /> Terms notice shown to users</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Version</Label>
            <Input value={g.terms_version} onChange={setText("terms_version")} className="mt-1 tabular" data-testid="guard-terms-version" />
            <p className="text-[11px] text-zinc-500 mt-1">Bump this when you change the wording — users re-accept on the next version.</p>
          </div>
          <div>
            <Label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Title</Label>
            <Input value={g.terms_title} onChange={setText("terms_title")} className="mt-1" data-testid="guard-terms-title" />
          </div>
        </div>
        <div>
          <Label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Body</Label>
          <Textarea rows={8} value={g.terms_body} onChange={setText("terms_body")} className="mt-1 text-sm leading-relaxed" data-testid="guard-terms-body" />
        </div>
        <p className="text-[11px] text-zinc-500 flex items-start gap-1.5">
          <Trophy size={13} weight="fill" className="text-orange-600 mt-0.5 shrink-0" />
          This is generic wording, not legal advice. Real-money fantasy rules differ by state and change over time — have a lawyer confirm the text and your eligibility gate before you scale up.
        </p>
      </section>

      <div className="flex justify-end">
        <Button disabled={busy} onClick={save} className="rounded-full bg-emerald-600 hover:bg-emerald-700 font-bold" data-testid="guard-save-btn">
          <Check size={16} weight="bold" className="mr-1" /> {busy ? "Saving…" : "Save guardrails"}
        </Button>
      </div>
    </div>
  );
}
