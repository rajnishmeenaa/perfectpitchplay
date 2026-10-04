import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { Badge } from "../components/ui/badge";
import { toast } from "sonner";
import { Baseball as CricketBall, SignOut, Wallet, Trophy, Ticket, Clock, ArrowSquareOut, UploadSimple, CurrencyInr, Copy, DeviceMobile, WhatsappLogo, ShieldCheck, Lightning, Confetti, X, Bell, PlusCircle, Flag, ChartBar, Receipt, DownloadSimple, Info, IdentificationCard, Timer, ChatCenteredDots, PaperPlaneRight, WarningCircle, CaretDown, FirstAid, CheckCircle, Coins } from "@phosphor-icons/react";
import { QRCodeSVG } from "qrcode.react";
import { ScreenshotViewer } from "./AdminApp";
import { payForContest, topUpWallet } from "../lib/razorpay";
import { alertNewInboxItems } from "../lib/notifications";
import { checkForUpdate } from "../lib/appUpdate";
import FantasyApp from "./FantasyApp";
import { OnboardingTour, CountUp, hasSeenOnboarding, markOnboardingSeen } from "../components/onboarding";
import { useNavigate } from "react-router-dom";

const StatusBadge = ({ status }) => {
  const map = {
    pending: "bg-yellow-100 text-yellow-800",
    approved: "bg-emerald-100 text-emerald-800",
    rejected: "bg-red-100 text-red-800",
    processing: "bg-blue-100 text-blue-800",
    won: "bg-orange-100 text-orange-800",
    paid: "bg-emerald-100 text-emerald-800",
    open: "bg-emerald-100 text-emerald-800",
    closed: "bg-zinc-200 text-zinc-700",
    completed: "bg-zinc-200 text-zinc-700",
    refunded: "bg-sky-100 text-sky-800",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${map[status] || "bg-zinc-100 text-zinc-700"}`} data-testid={`status-${status}`}>
      {status}
    </span>
  );
};

const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

function MobileGate({ name, onSaved, setMobile, onLogout }) {
  const [mobile, setMobileVal] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    const val = mobile.trim();
    if (!/^[0-9]{6,15}$/.test(val)) {
      toast.error("Enter a valid mobile number (digits only)");
      return;
    }
    setBusy(true);
    try {
      await setMobile(val);
      toast.success("Mobile saved! You're all set.");
      onSaved && onSaved();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't save mobile");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-100 flex items-center justify-center px-6" data-testid="mobile-gate">
      <div className="w-full max-w-md bg-white border border-zinc-200 rounded-2xl p-8">
        <div className="flex items-center gap-2 font-heading font-extrabold text-lg text-zinc-950">
          <CricketBall weight="fill" className="text-emerald-600" size={26} />
          PitchPlay
        </div>
        <h1 className="mt-6 font-heading text-2xl font-extrabold tracking-tight text-zinc-950">
          One last step, {name?.split(" ")[0]}
        </h1>
        <p className="text-sm text-zinc-500 mt-2 leading-relaxed">
          Add your mobile number so the admin can reach you and your contest winnings land in the right UPI.
        </p>
        <form className="mt-6 space-y-4" onSubmit={save}>
          <div>
            <Label htmlFor="gate-mobile" className="text-xs font-bold uppercase tracking-widest text-zinc-500">Mobile number</Label>
            <Input
              id="gate-mobile"
              inputMode="numeric"
              pattern="[0-9]{6,15}"
              value={mobile}
              onChange={(e) => setMobileVal(e.target.value)}
              placeholder="9876543210"
              className="mt-2 border-zinc-200 focus-visible:ring-emerald-500 tabular"
              data-testid="gate-mobile-input"
              required
            />
          </div>
          <Button
            type="submit"
            disabled={busy}
            className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 font-bold text-base rounded-md active:scale-[0.98] transition-transform"
            data-testid="gate-mobile-submit"
          >
            {busy ? "Saving..." : "Enter contest lobby"}
          </Button>
        </form>
        <button
          onClick={onLogout}
          className="mt-4 w-full text-center text-xs font-semibold text-zinc-400 hover:text-red-600 transition-colors"
          data-testid="gate-logout-btn"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

export default function UserApp() {
  const { user, logout, setUser, setMobile } = useAuth();
  const navigate = useNavigate();
  const [contests, setContests] = useState([]);
  const [entries, setEntries] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [history, setHistory] = useState([]);
  const [winners, setWinners] = useState([]);
  const [config, setConfig] = useState({ admin_upi_id: "" });
  const [joinContest, setJoinContest] = useState(null);
  const [joinTeam, setJoinTeam] = useState(null);
  const [tab, setTab] = useState("contests");
  const [focusMatch, setFocusMatch] = useState(null);
  const [wdOpen, setWdOpen] = useState(false);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [justJoined, setJustJoined] = useState(null);
  const [notifyToken, setNotifyToken] = useState(0);
  const [legal, setLegal] = useState(null);
  const [termsOpen, setTermsOpen] = useState(false);
  const [stats, setStats] = useState(null);
  const [update, setUpdate] = useState(null);
  const [safety, setSafety] = useState(null);
  const [tour, setTour] = useState(false);

  const loadAll = async () => {
    try {
      const [c, e, w, cfg, me, h, win, lg, st, sf] = await Promise.all([
        api.get("/contests"),
        api.get("/entries/mine"),
        api.get("/withdrawals/mine"),
        api.get("/wallet/config"),
        api.get("/auth/me"),
        api.get("/wallet/history"),
        api.get("/winners"),
        api.get("/legal/config"),
        api.get("/me/season-stats"),
        api.get("/me/safety"),
      ]);
      setContests(c.data);
      setEntries(e.data);
      setWithdrawals(w.data);
      setConfig(cfg.data);
      setUser(me.data);
      setHistory(h.data);
      setWinners(win.data);
      setLegal(lg.data);
      setStats(st.data);
      setSafety(sf.data);
      setNotifyToken((t) => t + 1);
    } catch (err) {
      toast.error("Failed to load data");
    }
  };

  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, []);

  // Installed APK vs. what the server publishes — silent on the web.
  useEffect(() => {
    let alive = true;
    checkForUpdate().then((r) => { if (alive && r.available) setUpdate(r); });
    return () => { alive = false; };
  }, []);

  // First-run tour: waits for the legal gate so the two dialogs never stack.
  useEffect(() => {
    if (user?.mobile && legal?.accepted && !hasSeenOnboarding()) setTour(true);
  }, [user, legal]);

  const doLogout = () => { logout(); navigate("/"); };

  if (user && !user.mobile) {
    return <MobileGate name={user.name} onSaved={loadAll} setMobile={setMobile} onLogout={doLogout} />;
  }

  const mustAccept = !!legal && !legal.accepted;

  return (
    <div className="min-h-screen bg-zinc-100" data-testid="user-app">
      <nav className="sticky top-0 z-20 bg-white/95 backdrop-blur-md border-b border-zinc-200">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 font-heading font-extrabold text-lg text-zinc-950">
            <CricketBall weight="fill" className="text-emerald-600" size={26} />
            PitchPlay
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-full" data-testid="wallet-pill">
              <Wallet size={18} weight="duotone" className="text-emerald-700" />
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">Wallet</span>
              <CountUp value={user?.wallet_balance} fromZero className="font-heading font-extrabold text-emerald-900" />
            </div>
            <NotificationBell refreshToken={notifyToken} />
            <div className="text-right hidden sm:block">
              <div className="text-sm font-bold text-zinc-950">{user?.name}</div>
              <div className="text-xs text-zinc-500 tabular">{user?.mobile}</div>
            </div>
            <Button variant="ghost" size="sm" onClick={doLogout} className="text-zinc-600 hover:text-red-600" data-testid="logout-btn">
              <SignOut size={18} /> <span className="ml-1 hidden sm:inline">Logout</span>
            </Button>
          </div>
        </div>
      </nav>

      <OnboardingTour open={tour} onClose={() => { markOnboardingSeen(); setTour(false); }} />

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="font-heading text-3xl sm:text-4xl font-extrabold tracking-tighter text-zinc-950">
            Hey {user?.name?.split(" ")[0]}, ready to play?
          </h1>
          <p className="text-zinc-500 mt-1">Browse the live contests, pay securely online and get instant access to the pitch.</p>
        </div>

        {update && update.latest?.apk_url && (
          <div className="mb-6 bg-emerald-950 text-white rounded-lg p-4 flex flex-wrap items-center gap-3" data-testid="update-banner">
            <DownloadSimple size={20} weight="fill" className="text-emerald-400" />
            <div className="min-w-0">
              <div className="font-bold text-sm">Version {update.latest.version_name} is available</div>
              <div className="text-[11px] text-emerald-200/80">
                You are on {update.current.version || update.current.build}{update.latest.notes ? ` · ${update.latest.notes}` : ""}
              </div>
            </div>
            <a href={update.latest.apk_url} target="_blank" rel="noopener noreferrer"
              className="ml-auto bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-extrabold text-xs px-4 py-2.5 rounded-full active:scale-95"
              data-testid="update-download-btn">
              Update now
            </a>
          </div>
        )}

        {safety && <RealityCheck minutes={safety.reality_check_minutes} message={safety.reality_check_message} onTakeBreak={() => setTab("safety")} />}

        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="bg-white border border-zinc-200 rounded-full p-1 h-auto" data-testid="tabs-list">
            <TabsTrigger value="contests" className="rounded-full data-[state=active]:bg-emerald-600 data-[state=active]:text-white px-5 py-2 font-bold" data-testid="tab-contests">
              <Ticket size={16} className="mr-1.5" /> Contests
            </TabsTrigger>
            <TabsTrigger value="fantasy" className="rounded-full data-[state=active]:bg-emerald-600 data-[state=active]:text-white px-5 py-2 font-bold" data-testid="tab-fantasy">
              <Flag size={16} className="mr-1.5" /> Fantasy
            </TabsTrigger>
            <TabsTrigger value="entries" className="rounded-full data-[state=active]:bg-emerald-600 data-[state=active]:text-white px-5 py-2 font-bold" data-testid="tab-entries">
              <Trophy size={16} className="mr-1.5" /> My Entries
            </TabsTrigger>
            <TabsTrigger value="stats" className="rounded-full data-[state=active]:bg-emerald-600 data-[state=active]:text-white px-5 py-2 font-bold" data-testid="tab-stats">
              <ChartBar size={16} className="mr-1.5" /> My Stats
            </TabsTrigger>
            <TabsTrigger value="wallet" className="rounded-full data-[state=active]:bg-emerald-600 data-[state=active]:text-white px-5 py-2 font-bold" data-testid="tab-wallet">
              <Wallet size={16} className="mr-1.5" /> Wallet
            </TabsTrigger>
            <TabsTrigger value="safety" className="rounded-full data-[state=active]:bg-emerald-600 data-[state=active]:text-white px-5 py-2 font-bold" data-testid="tab-safety">
              <ShieldCheck size={16} className="mr-1.5" /> Play safely
            </TabsTrigger>
          </TabsList>

          <TabsContent value="contests" className="mt-6">
            {justJoined && <SuccessBanner entry={justJoined} onClose={() => setJustJoined(null)} />}
            <WinnersBoard winners={winners} />
            {contests.length === 0 ? (
              <EmptyState title="No contests yet" body="The admin hasn't dropped any contest. Check back soon." />
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
                {contests.map((c) => (
                  <ContestCard
                    key={c.id}
                    contest={c}
                    onJoin={() => { setJoinTeam(null); setJoinContest(c); }}
                    onFantasy={() => { setTab("fantasy"); setFocusMatch(c.match_id || null); }}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="fantasy" className="mt-6">
            <FantasyApp
              config={config}
              walletBalance={user?.wallet_balance || 0}
              bonusBalance={user?.bonus_balance || 0}
              focusMatchId={focusMatch}
              entries={entries}
              onJoinFantasy={(contest, team) => { setJoinTeam(team || null); setJoinContest(contest); }}
              onMoneyChanged={loadAll}
            />
          </TabsContent>

          <TabsContent value="entries" className="mt-6">
            {entries.length === 0 ? (
              <EmptyState title="No entries yet" body="Join a contest to see it here." />
            ) : (
              <div className="space-y-3">
                {entries.map((e) => (
                  <div key={e.id} className="bg-white border border-zinc-200 rounded-lg p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3" data-testid={`entry-row-${e.id}`}>
                    <div>
                      <div className="flex items-center gap-3">
                        <div className="font-heading font-bold text-zinc-950">{e.contest_title}</div>
                        <StatusBadge status={e.status} />
                      </div>
                      <div className="text-sm text-zinc-500 mt-1 tabular">Entry: {money(e.entry_fee)} · {e.payment_method === "razorpay" ? <span className="text-emerald-700 font-semibold" data-testid={`paid-online-${e.id}`}>Paid online · {e.razorpay_payment_id}</span> : e.payment_method === "wallet" ? <span className="text-emerald-700 font-semibold" data-testid={`paid-wallet-${e.id}`}>Paid from wallet</span> : `UTR: ${e.utr || "—"}`}</div>
                      {e.team_name && (
                        <div className="text-xs text-zinc-500 mt-1" data-testid={`entry-team-${e.id}`}>
                          <Flag size={12} weight="fill" className="inline mr-1 text-emerald-600" />Team {e.team_name}
                          {e.fantasy_points != null && <> · <b className="text-zinc-800 tabular">{e.fantasy_points} pts</b></>}
                          {e.fantasy_rank && <> · Rank <b className="text-zinc-800 tabular">#{e.fantasy_rank}</b></>}
                        </div>
                      )}
                      {e.status === "won" && (
                        <div className="text-sm font-bold text-orange-700 mt-1 tabular">🏆 Prize: {money(e.winner_prize)}</div>
                      )}
                      {e.status === "refunded" && (
                        <div className="text-xs font-semibold text-sky-700 bg-sky-50 border border-sky-200 rounded px-2 py-1 mt-1.5 inline-block" data-testid={`refund-note-${e.id}`}>
                          {money(e.entry_fee)} returned to your wallet · {e.refund_reason || e.decision_note || "contest cancelled"}
                        </div>
                      )}
                    </div>
                    {(e.status === "approved" || e.status === "won") && e.external_link && (
                      <a
                        href={e.external_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 bg-orange-600 hover:bg-orange-700 text-white font-bold px-4 py-2 rounded-md active:scale-95 transition-transform"
                        data-testid={`play-link-${e.id}`}
                      >
                        <ArrowSquareOut size={16} weight="bold" /> Open contest
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="stats" className="mt-6">
            <SeasonStats stats={stats} />
          </TabsContent>

          <TabsContent value="wallet" className="mt-6">
            <div className="grid md:grid-cols-3 gap-5">
              <div className="md:col-span-1 bg-gradient-to-br from-emerald-600 to-emerald-800 text-white rounded-lg p-6 border border-emerald-700">
                <div className="text-xs font-bold uppercase tracking-widest opacity-80">Wallet balance</div>
                <div className="font-heading text-5xl font-extrabold tabular tracking-tighter mt-2" data-testid="wallet-balance">
                  {money(user?.wallet_balance)}
                </div>
                {Number(user?.bonus_balance || 0) > 0 && (
                  <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-gold/15 border border-gold/30 px-3 py-1.5" data-testid="bonus-chip">
                    <Coins size={14} weight="fill" className="text-gold" />
                    <span className="text-xs font-extrabold text-gold tabular">{money(user.bonus_balance)} bonus</span>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gold/70">entry fees only</span>
                  </div>
                )}
                {config.razorpay_enabled && (
                  <Button
                    onClick={() => setTopUpOpen(true)}
                    className="mt-6 w-full bg-emerald-400 text-emerald-950 hover:bg-emerald-300 font-bold rounded-md active:scale-95"
                    data-testid="add-money-btn"
                  >
                    <PlusCircle size={18} weight="bold" className="mr-1" /> Add money
                  </Button>
                )}
                <Button
                  disabled={(user?.wallet_balance || 0) <= 0}
                  onClick={() => setWdOpen(true)}
                  className={`${config.razorpay_enabled ? "mt-3" : "mt-6"} w-full bg-white text-emerald-800 hover:bg-emerald-50 font-bold rounded-md active:scale-95`}
                  data-testid="request-withdrawal-btn"
                >
                  <CurrencyInr size={18} weight="bold" className="mr-1" /> Request withdrawal
                </Button>
              </div>
              <div className="md:col-span-2 space-y-5">
                <WalletHistory items={history} />
                <div className="bg-white border border-zinc-200 rounded-lg">
                <div className="p-5 border-b border-zinc-100">
                  <div className="font-heading font-bold text-zinc-950">Withdrawal history</div>
                </div>
                {withdrawals.length === 0 ? (
                  <div className="p-10 text-center text-zinc-500 text-sm">No withdrawals yet</div>
                ) : (
                  <div className="divide-y divide-zinc-100">
                    {withdrawals.map((w) => (
                      <div key={w.id} className="p-5 flex items-center justify-between" data-testid={`withdrawal-row-${w.id}`}>
                        <div>
                          <div className="font-heading font-bold text-zinc-950 tabular">{money(w.amount)}</div>
                          <div className="text-xs text-zinc-500 mt-0.5">to {w.upi_id} · {new Date(w.created_at).toLocaleString()}</div>
                          <div className="text-[11px] text-zinc-500 mt-0.5 flex flex-wrap gap-x-2" data-testid={`payout-trail-${w.id}`}>
                            {w.status === "paid" && (
                              <span className="text-emerald-700 font-semibold">
                                Sent {w.decided_at ? new Date(w.decided_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : ""}
                                {w.payout_utr ? <> · UTR <b className="tabular select-all">{w.payout_utr}</b></> : null}
                              </span>
                            )}
                            {w.status === "processing" && <span className="text-blue-700 font-semibold">Bank is processing the transfer{w.payout_requested_at ? ` · requested ${new Date(w.payout_requested_at).toLocaleDateString("en-IN")}` : ""}</span>}
                            {w.status === "pending" && <span>Waiting for the admin to approve</span>}
                            {w.payout_status && w.payout_status !== "paid" && w.status !== "paid" && <span className="uppercase tracking-wide">· {w.payout_status}</span>}
                          </div>
                          {(w.status === "rejected" || w.status === "paid") && w.decision_note && (
                            <div className={`text-xs mt-0.5 ${w.status === "rejected" ? "text-red-600" : "text-zinc-500"}`} data-testid={`wd-note-${w.id}`}>{w.decision_note}</div>
                          )}
                        </div>
                        <StatusBadge status={w.status} />
                      </div>
                    ))}
                  </div>
                )}
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="safety" className="mt-6">
            {safety ? (
              <PlaySafely safety={safety} reload={loadAll} onOpenWallet={() => setTab("wallet")} />
            ) : (
              <div className="bg-white border border-zinc-200 rounded-lg p-8 text-center text-sm text-zinc-500" data-testid="safety-loading">
                Loading your play-safety settings…
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>

      <JoinDialog contest={joinContest} team={joinTeam} onClose={() => { setJoinContest(null); setJoinTeam(null); }} config={config} onDone={loadAll} onPaid={setJustJoined} walletBalance={user?.wallet_balance || 0} bonusBalance={user?.bonus_balance || 0} onTopUp={() => setTopUpOpen(true)} />
      <WithdrawDialog open={wdOpen} onClose={() => setWdOpen(false)} balance={user?.wallet_balance || 0} onDone={loadAll} config={config} />
      <TopUpDialog open={topUpOpen} onClose={() => setTopUpOpen(false)} onDone={loadAll} />
      {legal && (mustAccept || termsOpen) && (
        <TermsGate legal={legal} locked={mustAccept} onAccepted={loadAll} onClose={() => setTermsOpen(false)} />
      )}
      <footer className="max-w-7xl mx-auto px-6 pb-10 -mt-2">
        <button type="button" onClick={() => setTermsOpen(true)}
          className="text-xs text-zinc-500 hover:text-emerald-700 underline underline-offset-4" data-testid="open-terms-btn">
          Terms, skill-game notice & eligibility {legal?.accepted ? `(accepted v${legal.accepted_version || "1.0"})` : "— please read and accept"}
        </button>
      </footer>
    </div>
  );
}

function TermsGate({ legal, locked, onAccepted, onClose }) {
  const [age, setAge] = useState(!!legal.age_confirmed);
  const [busy, setBusy] = useState(false);

  const accept = async () => {
    if (!age) { toast.error("Please confirm you are 18 or older"); return; }
    setBusy(true);
    try {
      await api.post("/legal/accept", { terms_version: legal.terms_version, age_confirmed: true });
      toast.success("Thanks — you're all set");
      onAccepted();
      if (!locked) onClose?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not record your acceptance");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !locked) onClose?.(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="terms-gate">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl font-extrabold tracking-tight">{legal.terms_title}</DialogTitle>
          <DialogDescription>Version {legal.terms_version} · one-time confirmation before you play or withdraw.</DialogDescription>
        </DialogHeader>
        <div className="text-sm text-zinc-700 leading-relaxed whitespace-pre-line bg-zinc-50 border border-zinc-200 rounded-lg p-4" data-testid="terms-body">
          {legal.terms_body}
        </div>
        <div className="flex items-start gap-2 mt-1">
          <input id="age-confirm" type="checkbox" checked={age} onChange={(e) => setAge(e.target.checked)}
            className="mt-1 h-4 w-4 accent-emerald-600" data-testid="terms-age-checkbox" />
          <label htmlFor="age-confirm" className="text-sm text-zinc-800 font-semibold">
            I am 18 or older, and real-money skill games are legal where I live.
          </label>
        </div>
        <DialogFooter className="items-center gap-2 sm:gap-2">
          {!locked && (
            <Button variant="outline" onClick={onClose} data-testid="terms-close">Close</Button>
          )}
          <Button disabled={busy || !age} onClick={accept} className="bg-emerald-600 hover:bg-emerald-700 font-bold" data-testid="terms-accept-btn">
            <ShieldCheck size={16} weight="bold" className="mr-1" /> {busy ? "Saving…" : "I accept, continue"}
          </Button>
        </DialogFooter>
        {locked && <p className="text-[11px] text-zinc-500 w-full text-right">You must accept before joining a contest or requesting a withdrawal.</p>}
      </DialogContent>
    </Dialog>
  );
}

function useCountdown(iso) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!iso) return null;
  const diff = new Date(iso).getTime() - now;
  if (isNaN(diff)) return null;
  if (diff <= 0) return { over: true, text: "Match started" };
  const d = Math.floor(diff / 86400000), h = Math.floor((diff % 86400000) / 3600000), m = Math.floor((diff % 3600000) / 60000), s = Math.floor((diff % 60000) / 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return { over: false, urgent: diff < 3600000, text: d > 0 ? `${d}d ${pad(h)}h ${pad(m)}m` : `${pad(h)}:${pad(m)}:${pad(s)}` };
}

function ContestCard({ contest, onJoin, onFantasy }) {
  const cd = useCountdown(contest.match_time);
  const closed = contest.status !== "open" || (cd && cd.over);
  const isFantasy = contest.kind === "fantasy";
  const share = () => {
    const text = `🏏 Join "${contest.title}" on PitchPlay!\nEntry ₹${contest.entry_fee} · Prize pool ₹${contest.prize_pool}\n${window.location.origin}/?contest=${contest.id}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  };
  return (
    <div className="group bg-white border border-zinc-200 rounded-lg p-6 hover:border-emerald-400 hover:-translate-y-1 transition-all duration-200" data-testid={`contest-card-${contest.id}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <StatusBadge status={contest.status} />
            {isFantasy && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-xs font-bold uppercase tracking-wider" data-testid={`fantasy-chip-${contest.id}`}>
                <Flag size={11} weight="fill" /> Fantasy · {contest.match_label}
              </span>
            )}
          </div>
          <h3 className="font-heading text-xl font-bold text-zinc-950 mt-3 group-hover:text-emerald-700 transition-colors">
            {contest.title}
          </h3>
          {contest.description && <p className="text-sm text-zinc-500 mt-1 line-clamp-2">{contest.description}</p>}
        </div>
        <button type="button" onClick={share} className="p-2 rounded-full text-emerald-700 hover:bg-emerald-50" title="Share on WhatsApp" data-testid={`share-btn-${contest.id}`}>
          <WhatsappLogo size={22} weight="fill" />
        </button>
      </div>
      {cd && (
        <div className={`mt-4 flex items-center gap-2 rounded-md px-3 py-2 text-sm font-bold tabular ${cd.over ? "bg-zinc-100 text-zinc-600" : cd.urgent ? "bg-red-50 text-red-700 border border-red-200" : "bg-orange-50 text-orange-800 border border-orange-100"}`} data-testid={`countdown-${contest.id}`}>
          <Clock size={16} weight="bold" /> {cd.over ? cd.text : `Entries close in ${cd.text}`}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 mt-5">
        <div className="bg-zinc-50 border border-zinc-100 rounded p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Entry fee</div>
          <div className="font-heading text-xl font-extrabold text-zinc-950 tabular mt-1">{money(contest.entry_fee)}</div>
        </div>
        <div className="bg-gold-soft border border-gold/25 rounded p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-gold">Prize pool</div>
          <CountUp value={contest.prize_pool} fromZero duration={1100} className="block font-heading text-xl font-extrabold text-gold mt-1" />
        </div>
      </div>
      {contest.prize_breakdown?.length > 0 && (
        <div className="mt-3 rounded-md border border-gold/20 bg-gold/10 px-3 py-2" data-testid={`prize-breakdown-${contest.id}`}>
          <div className="text-[10px] font-bold uppercase tracking-widest text-gold mb-1.5">Prize breakdown</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {contest.prize_breakdown.map((item) => (
              <span key={item.rank} className="text-zinc-600">Rank <b className="text-zinc-900">{item.rank}</b>: <b className="text-gold">{money(item.amount)}</b></span>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center justify-between mt-5 pt-4 border-t border-zinc-100">
        <div className="text-xs text-zinc-500 tabular">
          {contest.participants_count}/{contest.max_participants} joined
        </div>
        {isFantasy ? (
          <Button
            disabled={closed}
            onClick={onFantasy}
            className="rounded-full bg-emerald-600 hover:bg-emerald-700 font-bold active:scale-95"
            data-testid={`fantasy-build-btn-${contest.id}`}
          >
            <Flag size={16} weight="fill" className="mr-1" /> {closed ? "Contest closed" : "Build XI & join"}
          </Button>
        ) : contest.external_link ? (
          <a href={contest.external_link} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-orange-600 hover:bg-orange-700 text-white font-bold px-4 py-2 active:scale-95 transition-transform"
            data-testid={`card-play-link-${contest.id}`}>
            <ArrowSquareOut size={16} weight="bold" /> Open contest
          </a>
        ) : contest.my_entry_status === "pending" ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-100 text-yellow-800 text-xs font-bold px-3 py-2" data-testid={`card-pending-${contest.id}`}>
            <Clock size={14} weight="bold" /> Waiting for approval
          </span>
        ) : (
        <Button
          disabled={closed}
          onClick={onJoin}
          className="rounded-full bg-emerald-600 hover:bg-emerald-700 font-bold active:scale-95"
          data-testid={`join-btn-${contest.id}`}
        >
          Join contest
        </Button>
        )}
      </div>
    </div>
  );
}

function JoinDialog({ contest, team, onClose, config, onDone, onPaid, walletBalance = 0, bonusBalance = 0, onTopUp }) {
  const [utr, setUtr] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);
  const [walletPaying, setWalletPaying] = useState(false);
  const [showManual, setShowManual] = useState(false);

  const rzpOn = !!config.razorpay_enabled;
  const manualOn = config.manual_upi_enabled !== false;

  useEffect(() => { setUtr(""); setFile(null); setShowManual(!rzpOn); }, [contest, rzpOn]);

  if (!contest) return null;
  if (contest.kind === "fantasy" && !team) {
    return (
      <Dialog open onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-sm" data-testid="fantasy-team-needed">
          <DialogHeader>
            <DialogTitle className="font-heading text-2xl font-extrabold tracking-tight">Pick your XI first</DialogTitle>
            <DialogDescription>Fantasy contests need a saved team of 11 players. Build one in the Fantasy tab, then come back to join.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={onClose} data-testid="team-needed-close">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const fee = Number(contest.entry_fee || 0);
  const spendable = Number(walletBalance || 0) + Number(bonusBalance || 0);
  const canWallet = spendable >= fee && fee > 0;

  const upiLink = `upi://pay?pa=${encodeURIComponent(config.admin_upi_id || "")}&pn=${encodeURIComponent(config.payee_name || "Admin")}&am=${contest.entry_fee}&cu=INR&tn=${encodeURIComponent(contest.title)}`;
  const copyUpi = () => { navigator.clipboard?.writeText(config.admin_upi_id || ""); toast.success("UPI ID copied"); };

  const payFromWallet = async () => {
    setWalletPaying(true);
    try {
      const { data } = await api.post("/entries/wallet", { contest_id: contest.id, team_id: team?.id || null });
      toast.success("Paid from wallet! You're in.");
      onClose();
      onPaid?.(data);
      onDone();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Wallet payment failed");
    } finally {
      setWalletPaying(false);
    }
  };

  const payOnline = async () => {
    setPaying(true);
    try {
      const entry = await payForContest(contest, team?.id);
      toast.success("Payment successful! You're in.");
      onClose();
      onPaid?.(entry);
      onDone();
    } catch (e) {
      const msg = e?.response?.data?.detail || e?.message || "Payment failed";
      if (msg !== "Payment cancelled") toast.error(msg); else toast("Payment cancelled");
    } finally {
      setPaying(false);
    }
  };

  const submit = async () => {
    if (!file) { toast.error("Upload payment screenshot"); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("contest_id", contest.id);
      fd.append("utr", utr);
      if (team) fd.append("team_id", team.id);
      fd.append("screenshot", file);
      await api.post("/entries", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Entry submitted. Waiting for admin approval.");
      onClose();
      onDone();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to submit entry");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!contest} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto" data-testid="join-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl font-extrabold tracking-tight">Join {contest.title}</DialogTitle>
          <DialogDescription>
            Entry fee <span className="font-bold text-emerald-700 tabular">{money(contest.entry_fee)}</span>.
            {rzpOn ? " Pay online for instant approval." : " Pay to the admin UPI below, then upload the payment screenshot."}
          </DialogDescription>
        </DialogHeader>

        {team && (
          <div className="flex items-center justify-between gap-3 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3" data-testid="joining-with-team">
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-800">Playing with team</div>
              <div className="font-heading font-extrabold text-emerald-900 truncate" data-testid="joining-team-name">{team.name}</div>
            </div>
            <div className="text-xs text-emerald-800 tabular shrink-0">{team.credits_used} credits</div>
          </div>
        )}

        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-center justify-between gap-3" data-testid="wallet-pay-box">
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-widest text-emerald-800">Available to pay</div>
            <div className="font-heading text-xl font-extrabold text-emerald-900 tabular" data-testid="wallet-pay-balance">{money(spendable)}</div>
            {Number(bonusBalance || 0) > 0 && (
              <div className="text-[11px] font-bold text-gold mt-0.5" data-testid="wallet-pay-bonus">
                includes {money(bonusBalance)} bonus · applied first
              </div>
            )}
            {!canWallet && (
              <div className="text-xs text-amber-700 mt-0.5" data-testid="wallet-insufficient">
                Insufficient for this entry ({money(fee)})
              </div>
            )}
          </div>
          {canWallet ? (
            <Button disabled={walletPaying} onClick={payFromWallet} className="shrink-0 bg-emerald-600 hover:bg-emerald-700 font-bold rounded-full active:scale-95" data-testid="pay-from-wallet-btn">
              <Lightning size={16} weight="fill" className="mr-1" /> {walletPaying ? "Paying..." : `Pay ${money(fee)}`}
            </Button>
          ) : (
            config.razorpay_enabled && (
              <Button variant="outline" onClick={() => { onClose(); onTopUp?.(); }} className="shrink-0 border-emerald-300 text-emerald-800 hover:bg-emerald-100 font-bold rounded-full" data-testid="wallet-topup-cta">
                <PlusCircle size={16} weight="bold" className="mr-1" /> Add money
              </Button>
            )
          )}
        </div>

        {rzpOn && (
          <div className="bg-zinc-950 text-white rounded-lg p-5 border border-zinc-800" data-testid="razorpay-pay-box">
            <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase tracking-widest">
              <ShieldCheck size={16} weight="fill" /> Instant entry · Secured by Razorpay
            </div>
            <p className="text-sm text-zinc-300 mt-2">UPI, cards, net banking & wallets. Your play link unlocks the moment payment succeeds — no waiting for approval.</p>
            <Button disabled={paying} onClick={payOnline} className="mt-4 w-full h-12 rounded-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-extrabold text-base active:scale-95" data-testid="razorpay-pay-btn">
              <Lightning size={18} weight="fill" className="mr-1" /> {paying ? "Opening secure checkout..." : `Pay ${money(contest.entry_fee)} & join now`}
            </Button>
            {manualOn && (
              <button type="button" onClick={() => setShowManual((v) => !v)} className="mt-3 w-full text-xs text-zinc-400 hover:text-white underline underline-offset-4" data-testid="toggle-manual-upi">
                {showManual ? "Hide manual UPI option" : "Prefer manual UPI transfer + screenshot? Click here"}
              </button>
            )}
          </div>
        )}

        {!rzpOn && !manualOn && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3" data-testid="payments-disabled-msg">Payments are temporarily unavailable. Please contact the admin.</p>
        )}

        {manualOn && showManual && (
          <div className="space-y-4" data-testid="manual-upi-section">
            {rzpOn && <div className="text-xs font-bold uppercase tracking-widest text-zinc-500">Manual UPI (admin approval needed)</div>}
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex gap-4 items-center">
              <div className="bg-white p-2 rounded-md border border-emerald-200 shrink-0 w-[126px]">
                {config.qr_path ? <ScreenshotViewer path={config.qr_path} testId="upi-qr-image" className="w-full rounded" /> : <QRCodeSVG value={upiLink} size={110} data-testid="upi-qr" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold uppercase tracking-widest text-emerald-800">Pay to UPI ID</div>
                <div className="flex items-center gap-2 mt-1">
                  <div className="font-heading text-xl font-extrabold text-emerald-900 tabular truncate select-all" data-testid="admin-upi-display">{config.admin_upi_id || "—"}</div>
                  <button type="button" onClick={copyUpi} className="p-1.5 rounded hover:bg-emerald-100 text-emerald-800" title="Copy" data-testid="copy-upi-btn"><Copy size={16} weight="bold" /></button>
                </div>
                {config.payee_name && <div className="text-xs text-emerald-800">{config.payee_name}</div>}
                <a href={upiLink} className="mt-2 inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1.5 rounded-md" data-testid="pay-upi-link">
                  <DeviceMobile size={14} weight="bold" /> Pay {money(contest.entry_fee)} in UPI app
                </a>
              </div>
            </div>
            {config.instructions && <p className="text-xs text-zinc-600 bg-zinc-50 border border-zinc-200 rounded p-2" data-testid="payment-instructions">{config.instructions}</p>}
            <div>
              <Label className="text-xs font-bold uppercase tracking-widest text-zinc-500">UTR / Ref no. (optional)</Label>
              <Input value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="12-digit UTR" className="mt-2 tabular" data-testid="input-utr" />
            </div>
            <div>
              <Label className="text-xs font-bold uppercase tracking-widest text-zinc-500">Payment screenshot</Label>
              <label className="mt-2 flex items-center justify-center gap-2 h-24 border-2 border-dashed border-zinc-300 hover:border-emerald-500 rounded-md cursor-pointer transition-colors" data-testid="upload-zone">
                <UploadSimple size={22} weight="bold" className="text-zinc-500" />
                <span className="text-sm text-zinc-600 font-semibold">{file ? file.name : "Click to upload (PNG/JPG, ≤5MB)"}</span>
                <input type="file" accept="image/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} data-testid="file-input" />
              </label>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="cancel-join">Cancel</Button>
          {manualOn && showManual && (
            <Button disabled={busy} onClick={submit} className="bg-emerald-600 hover:bg-emerald-700 font-bold" data-testid="submit-entry-btn">
              {busy ? "Submitting..." : "Submit for approval"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WithdrawDialog({ open, onClose, balance, onDone, config = {} }) {
  const [amt, setAmt] = useState("");
  const [upi, setUpi] = useState("");
  const [busy, setBusy] = useState(false);

  const min = Number(config.min_withdrawal || 0);
  const dayCap = Number(config.max_withdrawal_per_day || 0);
  const upiOk = /^[a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,}$/.test(upi.trim());

  const submit = async () => {
    const n = parseFloat(amt);
    if (!n || n <= 0) { toast.error("Enter a valid amount"); return; }
    if (min && n < min) { toast.error(`Minimum withdrawal is ${money(min)}`); return; }
    if (!upi.trim()) { toast.error("Enter your UPI ID"); return; }
    if (!upiOk) { toast.error("Enter a valid UPI ID, for example name@bank"); return; }
    setBusy(true);
    try {
      await api.post("/withdrawals", { amount: n, upi_id: upi.trim() });
      toast.success("Withdrawal requested. Admin will process shortly.");
      setAmt(""); setUpi("");
      onClose(); onDone();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md" data-testid="withdraw-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl font-extrabold">Request withdrawal</DialogTitle>
          <DialogDescription>Available balance: <span className="font-bold text-emerald-700 tabular">{money(balance)}</span></DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs font-bold uppercase tracking-widest text-zinc-500">Amount (₹)</Label>
            <Input value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" className="mt-2 tabular" data-testid="input-amount" />
            {(min || dayCap) && (
              <div className="text-[11px] text-zinc-500 mt-1 tabular" data-testid="withdrawal-limits">
                {min ? <>Minimum {money(min)}{dayCap ? " · " : ""}</> : null}
                {dayCap ? <>Up to {money(dayCap)} per day</> : null}
              </div>
            )}
          </div>
          <div>
            <Label className="text-xs font-bold uppercase tracking-widest text-zinc-500">Your UPI ID</Label>
            <Input value={upi} onChange={(e) => setUpi(e.target.value)} placeholder="you@upi" className="mt-2" data-testid="input-upi" />
            {upi.trim() && !upiOk && (
              <div className="text-[11px] text-red-600 mt-1" data-testid="upi-format-hint">Format: name@bank (the exact ID that should receive the money)</div>
            )}
          </div>
          <p className="text-[11px] text-zinc-500">Money is held from your wallet as soon as you request. If the payout is rejected it returns to your wallet automatically.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={submit} className="bg-orange-600 hover:bg-orange-700 font-bold" data-testid="submit-withdrawal-btn">
            {busy ? "Requesting..." : "Request payout"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NotificationBell({ refreshToken }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const prevUnread = useRef(0);

  const loadCount = useCallback(async () => {
    try {
      const { data } = await api.get("/notifications/unread-count");
      const n = data.unread || 0;
      setUnread(n);
      // New mail while the app is open -> raise a native alert too.
      if (n > prevUnread.current) {
        prevUnread.current = n;
        try { alertNewInboxItems((await api.get("/notifications")).data); } catch (_e) { /* ignore */ }
      } else if (n === 0) {
        prevUnread.current = 0;
      }
    } catch (_e) { /* ignore */ }
  }, []);

  useEffect(() => {
    loadCount();
    const t = setInterval(loadCount, 20000);
    return () => clearInterval(t);
  }, [loadCount, refreshToken]);

  const loadList = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/notifications");
      setItems(data);
    } catch (_e) {
      toast.error("Failed to load notifications");
    } finally {
      setLoading(false);
    }
  };

  const onOpenChange = (v) => { setOpen(v); if (v) loadList(); };

  const markAll = async () => {
    try {
      await api.post("/notifications/read-all");
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnread(0);
    } catch (_e) { /* ignore */ }
  };

  const markOne = async (n) => {
    if (n.read) return;
    try {
      await api.post(`/notifications/${n.id}/read`);
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
    } catch (_e) { /* ignore */ }
  };

  const iconFor = (type) => {
    switch (type) {
      case "win": return <Trophy size={18} weight="fill" className="text-orange-500" />;
      case "payout": return <CurrencyInr size={18} weight="fill" className="text-emerald-600" />;
      case "topup": return <PlusCircle size={18} weight="fill" className="text-emerald-600" />;
      case "wallet": return <Wallet size={18} weight="fill" className="text-emerald-600" />;
      default: return <Ticket size={18} weight="fill" className="text-zinc-500" />;
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button type="button" className="relative p-2 rounded-full hover:bg-zinc-100 text-zinc-700" aria-label="Notifications" data-testid="notification-bell">
          <Bell size={22} weight="duotone" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-600 text-white text-[10px] font-bold tabular" data-testid="notification-badge">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[92vw] sm:w-96 p-0" data-testid="notification-panel">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100">
          <div className="font-heading font-bold text-zinc-950">Notifications</div>
          {unread > 0 && (
            <button type="button" onClick={markAll} className="text-xs font-semibold text-emerald-700 hover:underline" data-testid="mark-all-read">
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-[60vh] overflow-y-auto divide-y divide-zinc-100">
          {loading ? (
            <div className="p-8 text-center text-sm text-zinc-500">Loading...</div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-sm text-zinc-500" data-testid="notifications-empty">No notifications yet</div>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => markOne(n)}
                className={`w-full text-left px-4 py-3 flex gap-3 hover:bg-zinc-50 ${n.read ? "opacity-60" : ""}`}
                data-testid={`notification-${n.id}`}
              >
                <div className="shrink-0 mt-0.5">{iconFor(n.type)}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-bold truncate ${n.read ? "text-zinc-700" : "text-zinc-950"}`}>{n.title}</span>
                    {!n.read && <span className="shrink-0 w-2 h-2 rounded-full bg-emerald-500" />}
                  </div>
                  {n.body && <div className="text-xs text-zinc-600 mt-0.5 leading-relaxed">{n.body}</div>}
                  <div className="text-[10px] text-zinc-400 uppercase tracking-wider mt-1">{new Date(n.created_at).toLocaleString()}</div>
                </div>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TopUpDialog({ open, onClose, onDone }) {
  const [amt, setAmt] = useState("");
  const [busy, setBusy] = useState(false);
  const presets = [100, 250, 500, 1000, 2000];

  useEffect(() => { if (open) { setAmt(""); setBusy(false); } }, [open]);

  const submit = async () => {
    const n = parseFloat(amt);
    if (!n || n < 1) { toast.error("Enter an amount of ₹1 or more"); return; }
    if (n > 100000) { toast.error("Maximum top-up is ₹1,00,000"); return; }
    setBusy(true);
    try {
      await topUpWallet(n);
      toast.success(`${money(n)} added to your wallet!`);
      onClose();
      onDone();
    } catch (e) {
      const msg = e?.response?.data?.detail || e?.message || "Top-up failed";
      if (msg !== "Payment cancelled") toast.error(msg); else toast("Payment cancelled");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md" data-testid="topup-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl font-extrabold">Add money to wallet</DialogTitle>
          <DialogDescription>Top up instantly via Razorpay. Your balance is ready to use for contest entries right away.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setAmt(String(p))}
                className={`px-4 py-2 rounded-full border text-sm font-bold tabular transition-colors ${String(p) === amt ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-zinc-700 border-zinc-200 hover:border-emerald-400"}`}
                data-testid={`topup-preset-${p}`}
              >
                {money(p)}
              </button>
            ))}
          </div>
          <div>
            <Label className="text-xs font-bold uppercase tracking-widest text-zinc-500">Amount (₹)</Label>
            <Input value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" placeholder="Enter amount" className="mt-2 tabular" data-testid="topup-amount-input" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="topup-cancel">Cancel</Button>
          <Button disabled={busy} onClick={submit} className="bg-emerald-600 hover:bg-emerald-700 font-bold" data-testid="topup-pay-btn">
            <Lightning size={16} weight="fill" className="mr-1" /> {busy ? "Opening checkout..." : "Proceed to pay"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SuccessBanner({ entry, onClose }) {
  return (
    <div className="relative overflow-hidden mb-6 rounded-lg border border-emerald-500 bg-emerald-600 text-white p-6 sm:p-7 animate-in fade-in slide-in-from-top-2 duration-500" data-testid="success-banner">
      <Confetti size={140} weight="duotone" className="absolute -right-6 -top-8 text-emerald-300/40 pointer-events-none" />
      <button type="button" onClick={onClose} className="absolute top-3 right-3 p-1.5 rounded-full hover:bg-white/15" aria-label="Dismiss" data-testid="success-banner-close"><X size={18} weight="bold" /></button>
      <div className="flex flex-col sm:flex-row sm:items-center gap-5 relative">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-emerald-100">
            <ShieldCheck size={16} weight="fill" /> Payment confirmed{entry.razorpay_payment_id ? ` · ${entry.razorpay_payment_id}` : entry.payment_method === "wallet" ? " · Paid from wallet" : ""}
          </div>
          <h2 className="font-heading text-3xl sm:text-4xl font-extrabold tracking-tighter mt-2">You're in! 🎉</h2>
          <p className="text-emerald-50 mt-1">Your spot in <b>{entry.contest_title}</b> is locked. Head over and set up your team before the match starts.</p>
        </div>
        {entry.external_link && (
          <a href={entry.external_link} target="_blank" rel="noopener noreferrer"
            className="shrink-0 inline-flex items-center justify-center gap-2 rounded-full bg-white text-emerald-800 hover:bg-emerald-50 font-extrabold px-6 py-3 active:scale-95 transition-transform"
            data-testid="success-banner-play-link">
            <ArrowSquareOut size={18} weight="bold" /> Open contest
          </a>
        )}
      </div>
    </div>
  );
}

function WinnersBoard({ winners }) {
  if (!winners.length) return null;
  return (
    <div className="mb-6 bg-zinc-950 text-white rounded-lg p-5 border border-zinc-800" data-testid="winners-board">
      <div className="flex items-center gap-2 text-gold text-xs font-bold uppercase tracking-widest">
        <Trophy size={16} weight="fill" /> Recent winners
      </div>
      <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {winners.slice(0, 6).map((w) => (
          <div key={w.id} className="bg-zinc-900 border border-zinc-800 rounded-md px-4 py-3 flex items-center justify-between" data-testid={`winner-${w.id}`}>
            <div className="min-w-0">
              <div className="font-heading font-bold truncate">{w.user_name}</div>
              <div className="text-xs text-zinc-400 truncate">{w.contest_title}</div>
            </div>
            <CountUp value={w.winner_prize} fromZero duration={1100} className="font-heading font-extrabold text-gold ml-3" />
          </div>
        ))}
      </div>
    </div>
  );
}

function SeasonStats({ stats }) {
  if (!stats) return <div className="text-sm text-zinc-500">Loading your season…</div>;
  if (!stats.contests_played && !stats.teams_built) {
    return (
      <EmptyState title="No season history yet" body="Join a contest and your wins, points and payout trail show up here." />
    );
  }
  const months = stats.monthly || [];
  const peak = Math.max(1, ...months.map((m) => Math.max(m.wagered, m.won)));
  const monthLabel = (m) => {
    const d = new Date(`${m}-01T00:00:00`);
    return isNaN(d.getTime()) ? m : d.toLocaleString("en-IN", { month: "short" });
  };
  const tiles = [
    { label: "Contests played", value: stats.contests_played, testId: "stat-played" },
    { label: "Contests won", value: stats.contests_won, testId: "stat-won" },
    { label: "Win rate", value: `${stats.win_rate}%`, testId: "stat-winrate" },
    { label: "Best finish", value: stats.best_rank ? `#${stats.best_rank}` : "—", testId: "stat-bestrank" },
  ];
  const moneyTiles = [
    { label: "Entry fees spent", value: money(stats.wagered), tone: "text-zinc-900", testId: "stat-wagered" },
    { label: "Prizes won", value: money(stats.winnings), tone: "text-orange-700", testId: "stat-winnings" },
    { label: "Net result", value: `${stats.net >= 0 ? "+" : "−"}${money(Math.abs(stats.net))}`, tone: stats.net >= 0 ? "text-emerald-700" : "text-red-600", testId: "stat-net" },
    { label: "Paid to UPI", value: money(stats.paid_out), tone: "text-emerald-700", testId: "stat-paidout" },
  ];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="bg-white border border-zinc-200 rounded-lg p-4" data-testid={t.testId}>
            <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{t.label}</div>
            <div className="font-heading text-2xl font-extrabold text-zinc-950 tabular mt-1">{t.value}</div>
          </div>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {moneyTiles.map((t) => (
          <div key={t.label} className="bg-white border border-zinc-200 rounded-lg p-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{t.label}</div>
            <div className={`font-heading text-xl font-extrabold tabular mt-1 ${t.tone}`} data-testid={t.testId}>{t.value}</div>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-3 gap-5">
        <div className="md:col-span-2 bg-white border border-zinc-200 rounded-lg p-5" data-testid="season-chart">
          <div className="font-heading font-bold text-zinc-950 flex items-center gap-2">
            <ChartBar size={16} weight="bold" className="text-emerald-600" /> Spent vs won
          </div>
          {months.length === 0 ? (
            <p className="text-sm text-zinc-500 mt-3">Not enough history to chart yet.</p>
          ) : (
            <>
              <div className="flex items-end gap-3 mt-5 h-40">
                {months.map((m) => (
                  <div key={m.month} className="flex-1 flex flex-col items-center gap-1.5">
                    <div className="w-full flex items-end justify-center gap-1.5 h-32">
                      <div className="w-1/2 max-w-[26px] rounded-t bg-zinc-200" style={{ height: `${Math.max(3, (m.wagered / peak) * 100)}%` }} title={`${money(m.wagered)} spent`} data-testid={`bar-spent-${m.month}`} />
                      <div className="w-1/2 max-w-[26px] rounded-t bg-orange-500" style={{ height: `${Math.max(3, (m.won / peak) * 100)}%` }} title={`${money(m.won)} won`} data-testid={`bar-won-${m.month}`} />
                    </div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{monthLabel(m.month)}</div>
                    <div className="text-[10px] text-zinc-400 tabular">{m.entries} ent</div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-4 mt-3 text-[11px] font-bold text-zinc-500">
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-zinc-200" /> entry fees</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-orange-500" /> prizes</span>
              </div>
            </>
          )}
        </div>

        <div className="bg-white border border-zinc-200 rounded-lg p-5 space-y-3" data-testid="season-extras">
          <div className="font-heading font-bold text-zinc-950 flex items-center gap-2">
            <Receipt size={16} weight="bold" className="text-emerald-600" /> Fine print
          </div>
          <Row label="Best win" value={stats.best_win ? `${money(stats.best_win.amount)} · ${stats.best_win.contest_title}` : "—"} testId="row-bestwin" />
          <Row label="Top-3 finishes" value={stats.top3_finishes} testId="row-top3" />
          <Row label="Fantasy teams built" value={stats.teams_built} testId="row-teams" />
          <Row label="Matches played" value={stats.matches_played} testId="row-matches" />
          <Row label="Total fantasy points" value={stats.total_points} testId="row-points" />
          <Row label="Average points" value={stats.avg_points} testId="row-avg" />
          {stats.contests_refunded > 0 && <Row label="Refunded entries" value={stats.contests_refunded} testId="row-refunds" />}
          {stats.contests_pending > 0 && <Row label="Awaiting approval" value={stats.contests_pending} testId="row-pending" />}
        </div>
      </div>

      <p className="text-[11px] text-zinc-500" data-testid="season-note">
        Counts approved entries and settled prizes. Pending payments are not included, so this always matches your wallet ledger.
      </p>
    </div>
  );
}

function Row({ label, value, testId }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm border-b border-zinc-100 pb-2 last:border-0" data-testid={testId}>
      <span className="text-zinc-500">{label}</span>
      <span className="font-bold text-zinc-900 tabular truncate max-w-[60%] text-right">{value}</span>
    </div>
  );
}

function WalletHistory({ items }) {
  const color = { prize: "text-orange-700", credit: "text-emerald-700", debit: "text-red-600", payout: "text-red-600" };
  return (
    <div className="bg-white border border-zinc-200 rounded-lg" data-testid="wallet-history">
      <div className="p-5 border-b border-zinc-100 font-heading font-bold text-zinc-950">Wallet history</div>
      {items.length === 0 ? (
        <div className="p-10 text-center text-zinc-500 text-sm">No transactions yet</div>
      ) : (
        <div className="divide-y divide-zinc-100">
          {items.map((t) => (
            <div key={t.id} className="px-5 py-3 flex items-center justify-between" data-testid={`wallet-tx-${t.id}`}>
              <div>
                <div className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
                  {t.note}
                  {t.kind === "bonus" && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 border border-gold/30 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-gold" data-testid={`wallet-kind-${t.id}`}>
                      <Coins size={10} weight="fill" /> bonus
                    </span>
                  )}
                </div>
                <div className="text-xs text-zinc-500 uppercase tracking-wider">{t.type} · {new Date(t.created_at).toLocaleString()}</div>
              </div>
              <div className={`font-heading font-extrabold tabular ${color[t.type]}`}>{t.amount > 0 ? "+" : "−"}{money(Math.abs(t.amount))}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ title, body }) {
  return (
    <div className="bg-white border border-dashed border-zinc-300 rounded-lg p-16 text-center">
      <Clock size={40} weight="duotone" className="text-zinc-400 mx-auto" />
      <div className="font-heading font-bold text-zinc-800 text-lg mt-3">{title}</div>
      <div className="text-sm text-zinc-500 mt-1">{body}</div>
    </div>
  );
}

function SafetyTile({ label, value, sub, tone = "zinc", testId }) {
  const skin = {
    zinc: "bg-white border-zinc-200",
    emerald: "bg-emerald-50 border-emerald-200",
    amber: "bg-amber-50 border-amber-200",
    red: "bg-red-50 border-red-200",
  };
  return (
    <div className={`rounded-lg border px-4 py-3 ${skin[tone] || skin.zinc}`} data-testid={testId}>
      <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{label}</div>
      <div className="font-heading text-xl font-extrabold text-zinc-950 tabular mt-0.5">{value}</div>
      {sub && <div className="text-[11px] text-zinc-600 mt-0.5">{sub}</div>}
    </div>
  );
}

function RealityCheck({ minutes, message, onTakeBreak }) {
  const [elapsed, setElapsed] = useState(0);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!minutes) return undefined;
    const t = setInterval(() => setElapsed((m) => m + 0.5), 30000);
    return () => clearInterval(t);
  }, [minutes]);
  if (!minutes || gone || elapsed < minutes) return null;
  return (
    <div className="mb-6 bg-amber-50 border border-amber-300 rounded-lg p-4 flex flex-wrap items-center gap-3" data-testid="reality-check">
      <Timer size={20} weight="fill" className="text-amber-700 shrink-0" />
      <div className="min-w-0">
        <div className="font-bold text-sm text-amber-900">You have been on the app about {Math.round(elapsed)} minutes</div>
        <div className="text-[11px] text-amber-800">{message}</div>
      </div>
      <div className="ml-auto flex gap-2">
        <button type="button" onClick={onTakeBreak} className="bg-amber-700 hover:bg-amber-800 text-white text-xs font-extrabold px-3 py-2 rounded-full" data-testid="reality-break-btn">
          Take a break
        </button>
        <button type="button" onClick={() => setGone(true)} className="bg-white border border-amber-300 text-amber-800 text-xs font-bold px-3 py-2 rounded-full" data-testid="reality-dismiss-btn">
          I'm fine
        </button>
      </div>
    </div>
  );
}

const EXCLUSION_OPTIONS = [1, 3, 7, 30, 90, 180];
const TICKET_CATEGORIES = [
  { key: "payment", label: "Payment or top-up" },
  { key: "entry", label: "Contest entry" },
  { key: "scorecard", label: "Scorecard or points" },
  { key: "payout", label: "Withdrawal or payout" },
  { key: "account", label: "Account or KYC" },
  { key: "safety", label: "Play-safety request" },
  { key: "other", label: "Something else" },
];

function PlaySafely({ safety, reload, onOpenWallet }) {
  const [limit, setLimit] = useState(safety.deposit_limit_daily ? String(safety.deposit_limit_daily) : "");
  const [rc, setRc] = useState(safety.reality_check_minutes ? String(safety.reality_check_minutes) : "");
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState(String(Math.max(safety.self_exclusion_min_days, 7)));
  const [reason, setReason] = useState("");
  const [kycName, setKycName] = useState("");
  const [pan, setPan] = useState("");

  const saveLimits = async () => {
    setBusy(true);
    try {
      await api.put("/me/safety", { deposit_limit_daily: Number(limit || 0), reality_check_minutes: Number(rc || 0) });
      toast.success("Limits saved");
      reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save your limits");
    } finally { setBusy(false); }
  };

  const exclude = async () => {
    setBusy(true);
    try {
      await api.post("/me/self-exclude", { days: Number(days), reason });
      toast.success(`Self-exclusion starts now — until ${days} day(s) from today`);
      reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not start the break");
    } finally { setBusy(false); }
  };

  const lift = async () => {
    setBusy(true);
    try {
      await api.post("/me/self-exclude/lift", { ack: true });
      toast.success("Exclusion lifted");
      reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "The organiser must lift this");
    } finally { setBusy(false); }
  };

  const submitKyc = async () => {
    setBusy(true);
    try {
      await api.put("/me/kyc", { full_name: kycName, pan });
      toast.success("PAN submitted for verification");
      reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Check the PAN and name");
    } finally { setBusy(false); }
  };

  const kycSkin = { verified: "emerald", pending: "amber", rejected: "red", none: "zinc" };
  const daysOptions = EXCLUSION_OPTIONS.filter((d) => d >= safety.self_exclusion_min_days && d <= safety.self_exclusion_max_days);

  return (
    <div className="space-y-5" data-testid="play-safely">
      {safety.excluded && (
        <div className="bg-red-50 border border-red-300 rounded-lg p-4 flex flex-wrap items-center gap-3" data-testid="exclusion-banner">
          <FirstAid size={22} weight="fill" className="text-red-700" />
          <div>
            <div className="font-bold text-sm text-red-900">You are on a self-imposed break</div>
            <div className="text-[11px] text-red-800">
              Until {String(safety.self_exclusion.until).slice(0, 10)} you cannot join contests or add money.
              Your wallet balance and winnings are safe — withdrawals stay open.
            </div>
          </div>
          {safety.allow_self_lift && (
            <Button size="sm" onClick={lift} disabled={busy} variant="outline" className="ml-auto rounded-full font-bold" data-testid="lift-exclusion-btn">
              Ask to lift it
            </Button>
          )}
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <SafetyTile label="Deposited today" value={money(safety.deposited_today)}
          sub={safety.deposit_limit_daily ? `limit ${money(safety.deposit_limit_daily)}` : safety.default_deposit_limit_daily ? `organiser limit ${money(safety.default_deposit_limit_daily)}` : "no limit set"}
          tone={safety.deposit_limit_daily && safety.deposited_today >= safety.deposit_limit_daily ? "amber" : "zinc"} testId="tile-deposited" />
        <SafetyTile label="Played today" value={money(safety.spent_today)}
          sub={safety.daily_spend_cap ? `cap ${money(safety.daily_spend_cap)}` : "no daily cap"} tone="zinc" testId="tile-spent" />
        <SafetyTile label="Reality check" value={safety.reality_check_minutes ? `${safety.reality_check_minutes} min` : "Off"}
          sub="A timer reminds you while you play" tone={safety.reality_check_minutes ? "emerald" : "zinc"} testId="tile-reality" />
        <SafetyTile label="KYC" value={(safety.kyc.status || "none").toUpperCase()}
          sub={safety.kyc.pan ? `${safety.kyc.name || "Verified name"} · ${safety.kyc.pan}` : safety.kyc_required_for_payouts ? "Needed before payouts" : "Optional until you withdraw"}
          tone={kycSkin[safety.kyc.status] || "zinc"} testId="tile-kyc" />
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <div className="bg-white border border-zinc-200 rounded-lg p-5" data-testid="limits-card">
          <div className="flex items-center gap-2 font-heading font-bold text-zinc-950">
            <CurrencyInr size={18} weight="fill" className="text-emerald-700" /> Money limits
          </div>
          <p className="text-[11px] text-zinc-500 mt-1">Applies to money you add to the wallet. Lower it any time; we only act on it immediately.</p>

          <Label className="block mt-4 text-xs font-bold uppercase tracking-wider text-zinc-600">Daily deposit limit (₹)</Label>
          <Input value={limit} onChange={(e) => setLimit(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric"
            placeholder="0 = no limit" className="mt-1.5 tabular" data-testid="deposit-limit-input" disabled={!safety.allow_user_deposit_limit} />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {[0, 100, 500, 1000, 2500].map((v) => (
              <button key={v} type="button" onClick={() => setLimit(v ? String(v) : "")}
                className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors ${String(v) === String(limit || 0) ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-zinc-600 border-zinc-200 hover:border-emerald-400"}`}
                data-testid={`limit-chip-${v}`}>{v ? money(v) : "No limit"}</button>
            ))}
          </div>

          <Label className="block mt-4 text-xs font-bold uppercase tracking-wider text-zinc-600">Reality-check reminder (minutes)</Label>
          <Input value={rc} onChange={(e) => setRc(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric"
            placeholder="0 = off" className="mt-1.5 tabular" data-testid="reality-input" />

          <Button onClick={saveLimits} disabled={busy} className="mt-4 w-full rounded-full bg-emerald-600 hover:bg-emerald-700 font-bold" data-testid="save-limits-btn">
            <CheckCircle size={16} weight="bold" className="mr-1" /> Save my limits
          </Button>
          {safety.kyc_required_for_payouts && safety.kyc.status !== "verified" && (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mt-3" data-testid="kyc-payout-note">
              Payouts are on hold until your PAN is verified. <button type="button" className="underline font-bold" onClick={onOpenWallet}>Wallet</button> stays usable.
            </p>
          )}
        </div>

        <div className="bg-white border border-zinc-200 rounded-lg p-5" data-testid="break-card">
          <div className="flex items-center gap-2 font-heading font-bold text-zinc-950">
            <FirstAid size={18} weight="fill" className="text-red-600" /> Take a break
          </div>
          <p className="text-[11px] text-zinc-500 mt-1">
            Blocks new entries and deposits for the period you choose.
            {safety.allow_self_lift ? " You can lift it yourself." : " Only the organiser can lift it early — that keeps the break honest."}
          </p>
          {safety.allow_self_exclusion ? (
            <>
              <div className="flex flex-wrap gap-1.5 mt-4">
                {daysOptions.map((d) => (
                  <button key={d} type="button" onClick={() => setDays(String(d))}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${days === String(d) ? "bg-red-600 text-white border-red-600" : "bg-white text-zinc-600 border-zinc-200 hover:border-red-400"}`}
                    data-testid={`exclude-days-${d}`}>{d} day{d > 1 ? "s" : ""}</button>
                ))}
              </div>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200}
                placeholder="Why now? (only you and the organiser see this)" className="mt-3" data-testid="exclude-reason" />
              <Button onClick={exclude} disabled={busy || safety.excluded} variant="outline"
                className="mt-3 w-full rounded-full font-bold text-red-700 border-red-200 hover:bg-red-50" data-testid="start-exclusion-btn">
                Start {days}-day break
              </Button>
            </>
          ) : (
            <p className="text-[11px] text-zinc-500 mt-3" data-testid="exclusion-disabled">
              Self-exclusion is turned off in this app — ask the organiser to restrict your account.
            </p>
          )}
          {(safety.support_email || safety.helpline) && (
            <div className="mt-4 pt-4 border-t border-zinc-100 text-[11px] text-zinc-600 space-y-1" data-testid="help-contacts">
              {safety.helpline && <div className="flex items-center gap-1.5"><DeviceMobile size={14} weight="bold" /> Helpline <b>{safety.helpline}</b></div>}
              {safety.support_email && <div className="flex items-center gap-1.5">@ <b>{safety.support_email}</b></div>}
              <div>Use the help desk below and we will reply inside the app.</div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg p-5" data-testid="kyc-card">
        <div className="flex items-center gap-2 font-heading font-bold text-zinc-950">
          <IdentificationCard size={18} weight="fill" className="text-violet-700" /> Identity (PAN)
        </div>
        <p className="text-[11px] text-zinc-500 mt-1">
          Real-money fantasy in India needs a verified adult identity. We store your PAN masked — it is never shown in full.
        </p>
        {safety.kyc.status === "verified" ? (
          <p className="text-[12px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-3 py-2 mt-3" data-testid="kyc-verified">
            Verified as {safety.kyc.name} · PAN {safety.kyc.pan}
          </p>
        ) : (
          <>
            {safety.kyc.status === "pending" && (
              <p className="text-[12px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 mt-3" data-testid="kyc-pending">
                Submitted {safety.kyc.pan} for {safety.kyc.name} — waiting for the organiser to check it.
              </p>
            )}
            {safety.kyc.status === "rejected" && (
              <p className="text-[12px] font-semibold text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2 mt-3" data-testid="kyc-rejected">
                Not accepted: {safety.kyc.note || "the name and PAN did not match"}. Send it again below.
              </p>
            )}
            <div className="flex flex-wrap gap-2 mt-3">
              <Input value={kycName} onChange={(e) => setKycName(e.target.value)} placeholder="Full name as on PAN"
                className="flex-1 min-w-[180px]" data-testid="kyc-name-input" />
              <Input value={pan} onChange={(e) => setPan(e.target.value.toUpperCase().slice(0, 10))} placeholder="PAN, e.g. ABCDE1234F"
                className="w-40 tabular uppercase" data-testid="kyc-pan-input" />
              <Button onClick={submitKyc} disabled={busy || kycName.trim().length < 3 || pan.length !== 10}
                className="rounded-full bg-violet-600 hover:bg-violet-700 text-white font-bold" data-testid="kyc-submit-btn">
                Submit
              </Button>
            </div>
          </>
        )}
      </div>

      <FaqList />
      <SupportDesk />
    </div>
  );
}

function FaqList() {
  const [items, setItems] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get("/legal/faq").then(({ data }) => { if (alive) setItems(data.items || []); }).catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, []);
  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-5" data-testid="faq-card">
      <div className="flex items-center gap-2 font-heading font-bold text-zinc-950">
        <Info size={18} weight="fill" className="text-emerald-700" /> Common questions
      </div>
      {items === null ? (
        <p className="text-[11px] text-zinc-500 mt-2">Loading answers…</p>
      ) : items.length === 0 ? (
        <p className="text-[11px] text-zinc-500 mt-2" data-testid="faq-empty">No answers published yet — use the help desk below.</p>
      ) : (
        <div className="mt-3 divide-y divide-zinc-100 border border-zinc-100 rounded-md overflow-hidden">
          {items.map((it, i) => (
            <details key={i} className="group px-4 py-3" data-testid={`faq-item-${i}`}>
              <summary className="flex items-center justify-between gap-3 cursor-pointer text-sm font-bold text-zinc-900 list-none">
                <span>{it.q}</span>
                <CaretDown size={16} weight="bold" className="text-zinc-400 shrink-0 group-open:rotate-180 transition-transform" />
              </summary>
              <p className="text-[12px] text-zinc-600 mt-2 leading-relaxed">{it.a}</p>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

function SupportDesk() {
  const [items, setItems] = useState([]);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [cat, setCat] = useState("payment");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api.get("/support/tickets/mine").then(({ data }) => setItems(data)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const send = async () => {
    setBusy(true);
    try {
      await api.post("/support/tickets", { subject, message, category: cat });
      toast.success("Sent to the help desk");
      setSubject(""); setMessage("");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not send your issue");
    } finally { setBusy(false); }
  };

  const canSend = subject.trim().length >= 4 && message.trim().length >= 10;
  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-5" data-testid="support-card">
      <div className="flex items-center gap-2 font-heading font-bold text-zinc-950">
        <ChatCenteredDots size={18} weight="fill" className="text-emerald-700" /> Help desk
      </div>
      <p className="text-[11px] text-zinc-500 mt-1">Payment stuck, wrong scorecard, payout delay — write it here and the reply lands in your notifications.</p>

      <div className="grid sm:grid-cols-3 gap-2 mt-4">
        <select value={cat} onChange={(e) => setCat(e.target.value)}
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm font-bold sm:col-span-1" data-testid="ticket-category">
          {TICKET_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={140} placeholder="Subject"
          className="sm:col-span-2" data-testid="ticket-subject" />
      </div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={2000}
        rows={3}
        placeholder="What happened? Include the contest or withdrawal reference if you have it."
        className="mt-2 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        data-testid="ticket-message"
      />
      <Button onClick={send} disabled={busy || !canSend} className="mt-3 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold" data-testid="ticket-send-btn">
        <PaperPlaneRight size={16} weight="fill" className="mr-1" /> {busy ? "Sending…" : "Send to help desk"}
      </Button>

      {items.length > 0 && (
        <div className="mt-5 space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Your tickets</div>
          {items.map((t) => (
            <div key={t.id} className="border border-zinc-200 rounded-md px-4 py-3" data-testid={`ticket-${t.id}`}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-zinc-900 flex-1 truncate">{t.subject}</span>
                <Badge variant={t.status === "resolved" || t.status === "closed" ? "secondary" : "default"}
                  className="uppercase text-[10px] font-extrabold" data-testid={`ticket-status-${t.id}`}>{t.status}</Badge>
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5">{t.category} · {new Date(t.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</div>
              <p className="text-[12px] text-zinc-700 mt-1.5">{t.message}</p>
              {(t.replies || []).map((r, i) => (
                <div key={i} className="mt-2 bg-emerald-50 border border-emerald-200 rounded px-3 py-2 text-[12px] text-emerald-900" data-testid={`ticket-reply-${t.id}-${i}`}>
                  <b>{r.by}</b> · {r.message}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
