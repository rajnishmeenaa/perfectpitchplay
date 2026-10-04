import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { toast } from "sonner";
import { FirstAid, IdentificationCard, ChatCenteredDots, ShieldCheck, Lock, WarningCircle, CheckCircle, PaperPlaneRight, Scroll } from "@phosphor-icons/react";

const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const yn = (v) => (v ? "yes" : "no");

export default function AdminSafety() {
  const [data, setData] = useState(null);
  const [tickets, setTickets] = useState([]);

  const load = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([api.get("/admin/safety"), api.get("/admin/tickets")]);
      setData(s.data);
      setTickets(t.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load play-safety data");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!data) {
    return <div className="bg-white border border-zinc-200 rounded-lg p-10 text-center text-sm text-zinc-500" data-testid="admin-safety-loading">Loading play-safety console…</div>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-heading text-3xl font-extrabold tracking-tighter text-zinc-950 flex items-center gap-2">
          <FirstAid size={26} weight="fill" className="text-emerald-700" /> Play safety & support
        </h2>
        <p className="text-sm text-zinc-500 mt-1">
          Deposit limits, self-exclusion, the daily play cap, KYC queue and the help desk — the controls a real-money fantasy app is expected to offer,
          plus the answers users see in the app.
        </p>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <Tile label="Users excluded" value={data.counts.excluded} sub={`${data.counts.users} users total`} tone={data.counts.excluded ? "red" : "zinc"} testId="safety-count-excluded" />
        <Tile label="KYC awaiting review" value={data.counts.kyc_pending} sub="Payouts held only if the gate is on" tone={data.counts.kyc_pending ? "amber" : "zinc"} testId="safety-count-kyc" />
        <Tile label="Open tickets" value={tickets.filter((t) => t.status === "open").length} sub={`${tickets.length} raised in total`} tone="zinc" testId="safety-count-tickets" />
      </div>

      <Tabs defaultValue="controls" className="w-full">
        <TabsList className="bg-white border border-zinc-200 rounded-full p-1 h-auto">
          <TabsTrigger value="controls" className="rounded-full data-[state=active]:bg-emerald-600 data-[state=active]:text-white px-4 py-1.5 text-sm font-bold" data-testid="admin-safety-tab-controls">
            <ShieldCheck size={15} weight="bold" className="mr-1.5" /> Global controls
          </TabsTrigger>
          <TabsTrigger value="restricted" className="rounded-full data-[state=active]:bg-emerald-600 data-[state=active]:text-white px-4 py-1.5 text-sm font-bold" data-testid="admin-safety-tab-restricted">
            <Lock size={15} weight="bold" className="mr-1.5" /> Limits & breaks ({data.restricted.length})
          </TabsTrigger>
          <TabsTrigger value="kyc" className="rounded-full data-[state=active]:bg-emerald-600 data-[state=active]:text-white px-4 py-1.5 text-sm font-bold" data-testid="admin-safety-tab-kyc">
            <IdentificationCard size={15} weight="bold" className="mr-1.5" /> KYC ({data.kyc_pending.length})
          </TabsTrigger>
          <TabsTrigger value="tickets" className="rounded-full data-[state=active]:bg-emerald-600 data-[state=active]:text-white px-4 py-1.5 text-sm font-bold" data-testid="admin-safety-tab-tickets">
            <ChatCenteredDots size={15} weight="bold" className="mr-1.5" /> Help desk ({tickets.length})
          </TabsTrigger>
          <TabsTrigger value="faq" className="rounded-full data-[state=active]:bg-emerald-600 data-[state=active]:text-white px-4 py-1.5 text-sm font-bold" data-testid="admin-safety-tab-faq">
            <Scroll size={15} weight="bold" className="mr-1.5" /> FAQ answers
          </TabsTrigger>
        </TabsList>

        <TabsContent value="controls" className="mt-4">
          <SafetyControls settings={data.settings} onSaved={load} />
        </TabsContent>
        <TabsContent value="restricted" className="mt-4">
          <Restrictions rows={data.restricted} onChanged={load} />
        </TabsContent>
        <TabsContent value="kyc" className="mt-4">
          <KycQueue rows={data.kyc_pending} onChanged={load} />
        </TabsContent>
        <TabsContent value="tickets" className="mt-4">
          <TicketDesk tickets={tickets} onChanged={load} />
        </TabsContent>
        <TabsContent value="faq" className="mt-4">
          <FaqEditor onChanged={load} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Tile({ label, value, sub, tone = "zinc", testId }) {
  const skin = { zinc: "bg-white border-zinc-200", amber: "bg-amber-50 border-amber-200", red: "bg-red-50 border-red-200", emerald: "bg-emerald-50 border-emerald-200" };
  return (
    <div className={`rounded-lg border px-4 py-3 ${skin[tone] || skin.zinc}`} data-testid={testId}>
      <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{label}</div>
      <div className="font-heading text-2xl font-extrabold text-zinc-950 tabular">{value}</div>
      <div className="text-[11px] text-zinc-500">{sub}</div>
    </div>
  );
}

const NUM_FIELDS = [
  ["default_deposit_limit_daily", "Forced daily deposit limit (₹, 0 = none)"],
  ["max_deposit_limit_daily", "Highest limit a user may set (₹, 0 = any)"],
  ["max_daily_spend", "Daily play cap across entry fees (₹, 0 = off)"],
  ["reality_check_default_minutes", "Default reality-check timer (minutes, 0 = off)"],
  ["self_exclusion_min_days", "Shortest self-exclusion (days)"],
  ["self_exclusion_max_days", "Longest self-exclusion (days)"],
];
const BOOL_FIELDS = [
  ["allow_user_deposit_limit", "Let users set their own deposit limit"],
  ["allow_self_exclusion", "Let users self-exclude from the app"],
  ["allow_self_lift_exclusion", "Let users lift an exclusion themselves (turning this off defeats the purpose)"],
  ["kyc_required_for_payouts", "Hold payouts until PAN is verified"],
];

function SafetyControls({ settings, onSaved }) {
  const [form, setForm] = useState(settings);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      const body = {};
      NUM_FIELDS.forEach(([k]) => { body[k] = Number(form[k] || 0); });
      BOOL_FIELDS.forEach(([k]) => { body[k] = !!form[k]; });
      body.reality_check_message = form.reality_check_message;
      body.support_email = form.support_email;
      body.helpline = form.helpline;
      await api.put("/admin/safety", body);
      toast.success("Play-safety controls saved");
      onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save the controls");
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-5 space-y-5" data-testid="safety-controls">
      <div className="grid sm:grid-cols-3 gap-3">
        {NUM_FIELDS.map(([k, label]) => (
          <div key={k}>
            <Label className="text-[11px] font-bold uppercase tracking-wider text-zinc-600">{label}</Label>
            <Input value={form[k] ?? 0} onChange={(e) => set(k, e.target.value.replace(/[^0-9.]/g, ""))} inputMode="numeric"
              className="mt-1.5 tabular" data-testid={`safety-num-${k}`} />
          </div>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-2">
        {BOOL_FIELDS.map(([k, label]) => (
          <label key={k} className="flex items-start gap-2 text-sm font-semibold text-zinc-800 border border-zinc-200 rounded-md px-3 py-2 cursor-pointer" data-testid={`safety-bool-${k}`}>
            <input type="checkbox" checked={!!form[k]} onChange={(e) => set(k, e.target.checked)} className="mt-1 rounded border-zinc-300 text-emerald-600" />
            <span>{label}</span>
          </label>
        ))}
      </div>

      <div>
        <Label className="text-[11px] font-bold uppercase tracking-wider text-zinc-600">Reality-check message</Label>
        <textarea value={form.reality_check_message || ""} onChange={(e) => set("reality_check_message", e.target.value)} rows={2} maxLength={400}
          className="mt-1.5 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm" data-testid="safety-reality-text" />
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <Label className="text-[11px] font-bold uppercase tracking-wider text-zinc-600">Support email</Label>
          <Input value={form.support_email || ""} onChange={(e) => set("support_email", e.target.value)} className="mt-1.5" data-testid="safety-email" />
        </div>
        <div>
          <Label className="text-[11px] font-bold uppercase tracking-wider text-zinc-600">Helpline</Label>
          <Input value={form.helpline || ""} onChange={(e) => set("helpline", e.target.value)} className="mt-1.5" data-testid="safety-helpline" />
        </div>
      </div>

      <div className="text-[11px] text-zinc-500 flex flex-wrap gap-x-4 gap-y-1" data-testid="safety-state-line">
        <span>Deposit limit gate: <b>{yn(form.allow_user_deposit_limit)}</b></span>
        <span>Play cap: <b>{money(form.max_daily_spend || 0)}</b></span>
        <span>Payout KYC gate: <b>{yn(form.kyc_required_for_payouts)}</b></span>
      </div>

      <Button onClick={save} disabled={busy} className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold" data-testid="safety-save-btn">
        {busy ? "Saving…" : "Save controls"}
      </Button>
    </div>
  );
}

function Restrictions({ rows, onChanged }) {
  const [note, setNote] = useState("");
  const act = async (id, body) => {
    try {
      await api.post(`/admin/users/${id}/safety`, { ...body, note });
      toast.success("User restriction updated");
      setNote("");
      onChanged();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not update that user");
    }
  };
  if (!rows.length) {
    return <div className="bg-white border border-zinc-200 rounded-lg p-8 text-center text-sm text-zinc-500" data-testid="no-restrictions">
      Nobody has set a limit or taken a break. Users appear here the moment they do.
    </div>;
  }
  return (
    <div className="space-y-3">
      <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Note shown to the user (optional)"
        className="max-w-md" data-testid="restriction-note" />
      {rows.map((u) => (
        <div key={u.id} className="bg-white border border-zinc-200 rounded-lg p-4 flex flex-wrap items-center gap-3" data-testid={`restriction-${u.id}`}>
          <div className="min-w-0 flex-1">
            <div className="font-bold text-zinc-900 truncate">{u.name} <span className="text-xs text-zinc-500 tabular">· {u.mobile}</span></div>
            <div className="text-[11px] text-zinc-500 tabular">
              wallet {money(u.wallet_balance)} · deposited today {money(u.deposited_today)} · played today {money(u.spent_today)}
              {u.deposit_limit_daily ? ` · own limit ${money(u.deposit_limit_daily)}` : ""}
            </div>
            {u.excluded && (
              <div className="text-[11px] font-bold text-red-700 mt-1" data-testid={`excluded-${u.id}`}>
                Excluded until {String(u.self_exclusion.until).slice(0, 10)} {u.self_exclusion.reason ? `· ${u.self_exclusion.reason}` : ""}
              </div>
            )}
          </div>
          {u.excluded && (
            <Button size="sm" variant="outline" onClick={() => act(u.id, { lift_exclusion: true })} className="rounded-full font-bold" data-testid={`lift-${u.id}`}>
              <CheckCircle size={14} className="mr-1" /> Lift break
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => act(u.id, { exclude_days: 30 })} className="rounded-full font-bold text-red-700 border-red-200 hover:bg-red-50" data-testid={`exclude30-${u.id}`}>
            <WarningCircle size={14} className="mr-1" /> Exclude 30 days
          </Button>
        </div>
      ))}
    </div>
  );
}

function KycQueue({ rows, onChanged }) {
  const [note, setNote] = useState("");
  const decide = async (id, decision) => {
    try {
      await api.post(`/admin/users/${id}/kyc`, { decision, note });
      toast.success(decision === "verified" ? "PAN verified" : "PAN rejected");
      setNote("");
      onChanged();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not record that decision");
    }
  };
  if (!rows.length) {
    return <div className="bg-white border border-zinc-200 rounded-lg p-8 text-center text-sm text-zinc-500" data-testid="kyc-empty">
      No PAN is waiting for review. Users submit it from Play safely in the app.
    </div>;
  }
  return (
    <div className="space-y-3">
      <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Reason shown to the user if you reject"
        className="max-w-md" data-testid="kyc-note" />
      {rows.map((u) => (
        <div key={u.id} className="bg-white border border-zinc-200 rounded-lg p-4 flex flex-wrap items-center gap-3" data-testid={`kyc-${u.id}`}>
          <div className="min-w-0 flex-1">
            <div className="font-bold text-zinc-900 truncate">{u.name} <span className="text-xs text-zinc-500 tabular">· {u.mobile}</span></div>
            <div className="text-[12px] text-zinc-700 tabular" data-testid={`kyc-pan-${u.id}`}>{u.kyc.name} · {u.kyc.pan}</div>
            <div className="text-[11px] text-zinc-500">submitted {u.kyc.submitted_at ? new Date(u.kyc.submitted_at).toLocaleString("en-IN") : "—"}</div>
          </div>
          <Button size="sm" onClick={() => decide(u.id, "verified")} className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold" data-testid={`kyc-verify-${u.id}`}>
            Verify
          </Button>
          <Button size="sm" variant="outline" onClick={() => decide(u.id, "rejected")} className="rounded-full font-bold text-red-700 border-red-200 hover:bg-red-50" data-testid={`kyc-reject-${u.id}`}>
            Reject
          </Button>
        </div>
      ))}
    </div>
  );
}

function TicketDesk({ tickets, onChanged }) {
  const [openId, setOpenId] = useState(null);
  const [reply, setReply] = useState("");
  const [filter, setFilter] = useState("all");
  const shown = tickets.filter((t) => filter === "all" || t.status === filter);

  const send = async (id, status) => {
    if (reply.trim().length < 2) { toast.error("Write a short reply first"); return; }
    try {
      await api.post(`/admin/tickets/${id}/reply`, { message: reply, status });
      toast.success(status === "resolved" ? "Ticket resolved and user notified" : "Reply sent");
      setReply("");
      setOpenId(null);
      onChanged();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not send the reply");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {["all", "open", "answered", "resolved", "closed"].map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${filter === f ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-zinc-600 border-zinc-200 hover:border-emerald-400"}`}
            data-testid={`ticket-filter-${f}`}>{f}</button>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-lg p-8 text-center text-sm text-zinc-500" data-testid="tickets-empty">No tickets here.</div>
      ) : shown.map((t) => (
        <div key={t.id} className="bg-white border border-zinc-200 rounded-lg p-4" data-testid={`admin-ticket-${t.id}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-zinc-900 flex-1 min-w-0 truncate">{t.subject}</span>
            <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded bg-zinc-100 text-zinc-600">{t.category}</span>
            <span className={`text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded ${t.status === "open" ? "bg-amber-100 text-amber-800" : t.status === "resolved" || t.status === "closed" ? "bg-emerald-100 text-emerald-800" : "bg-sky-100 text-sky-800"}`}
              data-testid={`admin-ticket-status-${t.id}`}>{t.status}</span>
          </div>
          <div className="text-[11px] text-zinc-500 mt-0.5">{t.user_name} · {t.user_mobile} · {new Date(t.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</div>
          <p className="text-[12px] text-zinc-700 mt-2">{t.message}</p>
          {(t.replies || []).map((r, i) => (
            <div key={i} className="mt-2 bg-zinc-50 border border-zinc-200 rounded px-3 py-2 text-[12px] text-zinc-700" data-testid={`admin-reply-${t.id}-${i}`}>
              <b>{r.by}</b> · {r.message}
            </div>
          ))}
          {openId === t.id ? (
            <div className="mt-3 space-y-2">
              <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} maxLength={2000} placeholder="Answer the user…"
                className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm" data-testid={`reply-box-${t.id}`} />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => send(t.id, "answered")} className="rounded-full font-bold" data-testid={`reply-send-${t.id}`}>
                  <PaperPlaneRight size={14} className="mr-1" /> Reply
                </Button>
                <Button size="sm" variant="outline" onClick={() => send(t.id, "resolved")} className="rounded-full font-bold" data-testid={`reply-resolve-${t.id}`}>
                  Reply & resolve
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setOpenId(null); setReply(""); }} className="rounded-full" data-testid={`reply-cancel-${t.id}`}>Cancel</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setOpenId(t.id)} className="mt-3 rounded-full font-bold" data-testid={`reply-open-${t.id}`}>
              Reply
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

function FaqEditor({ onChanged }) {
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api.get("/legal/faq").then(({ data }) => setItems(data.items)).catch(() => toast.error("Could not load the FAQ"));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!items) return <div className="bg-white border border-zinc-200 rounded-lg p-8 text-center text-sm text-zinc-500">Loading answers…</div>;

  const patch = (i, key, value) => setItems((list) => list.map((it, j) => (i === j ? { ...it, [key]: value } : it)));
  const save = async () => {
    setBusy(true);
    try {
      await api.put("/admin/faq", { items: items.filter((i) => i.q.trim() && i.a.trim()) });
      toast.success("FAQ published");
      onChanged();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save the FAQ");
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-5 space-y-3" data-testid="faq-editor">
      <p className="text-[11px] text-zinc-500">These are the answers users see under Play safely. Blank rows are dropped when you save.</p>
      {items.map((it, i) => (
        <div key={i} className="border border-zinc-200 rounded-md p-3" data-testid={`faq-row-${i}`}>
          <Input value={it.q} onChange={(e) => patch(i, "q", e.target.value)} placeholder="Question" className="text-sm font-bold" data-testid={`faq-q-${i}`} />
          <textarea value={it.a} onChange={(e) => patch(i, "a", e.target.value)} rows={2} maxLength={1200} placeholder="Answer"
            className="mt-2 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm" data-testid={`faq-a-${i}`} />
          <button type="button" onClick={() => setItems((list) => list.filter((_, j) => j !== i))}
            className="mt-1.5 text-[11px] font-bold text-red-600 hover:underline" data-testid={`faq-del-${i}`}>remove</button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setItems((l) => [...l, { q: "", a: "" }])} className="rounded-full font-bold" data-testid="faq-add">
          Add a question
        </Button>
        <Button onClick={save} disabled={busy} className="ml-auto rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold" data-testid="faq-save">
          {busy ? "Saving…" : "Publish FAQ"}
        </Button>
      </div>
    </div>
  );
}
