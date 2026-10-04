import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { toast } from "sonner";
import { ArrowRight, ShieldCheck, Lightning, Trophy, GoogleLogo, NumberCircleOne, NumberCircleTwo, NumberCircleThree, Sparkle } from "@phosphor-icons/react";
import OtpAuth from "../components/otpAuth";

const HERO = process.env.PUBLIC_URL + "/brand/hero-stadium.jpg";
const LOGO = process.env.PUBLIC_URL + "/brand/logo-gold.png";

const STEPS = [
  { icon: NumberCircleOne, title: "Pick your contest", body: "Join a mega league, a head-to-head, or a private contest from a friend's code." },
  { icon: NumberCircleTwo, title: "Build your XI", body: "11 players, 100 credits, captain earns 2x. Live player insights help you decide." },
  { icon: NumberCircleThree, title: "Win real money", body: "Watch the ball-by-ball centre, track your rank live, withdraw to UPI after settlement." },
];

export default function Landing() {
  const { user, login, signup, loginWithToken } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [method, setMethod] = useState("password");
  const [form, setForm] = useState(() => ({
    name: "", mobile: "", password: "",
    invite: (new URLSearchParams(window.location.search).get("ref") || "").toUpperCase().slice(0, 6),
  }));
  const [busy, setBusy] = useState(false);

  // Already signed in? Go straight to the right lobby (in an effect, so React
  // doesn't see a router update triggered from another component's render).
  useEffect(() => {
    if (user) navigate(user.role === "admin" ? "/admin" : "/app", { replace: true });
  }, [user, navigate]);

  const signInWithToken = async (token) => {
    const u = await loginWithToken(token);
    navigate(u.role === "admin" ? "/admin" : "/app", { replace: true });
    return u;
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const u = mode === "login"
        ? await login(form.mobile.trim(), form.password)
        : await signup(form.name.trim(), form.mobile.trim(), form.password, form.invite.trim().toUpperCase());
      toast.success(`Welcome ${u.name}`);
      navigate(u.role === "admin" ? "/admin" : "/app", { replace: true });
    } catch (err) {
      const msg = err?.response?.data?.detail
        || (err?.response ? "Something went wrong" : "Can't reach the server. Check your connection and try again.");
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const googleSignIn = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + "/app";
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  return (
    <div className="min-h-screen stadium-bg" data-testid="landing-page">
      {/* Nav */}
      <nav className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-zinc-200">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5 font-heading font-extrabold text-lg text-zinc-950" data-testid="brand-logo">
            <img src={LOGO} alt="PitchPlay" className="h-9 w-9 rounded-xl object-cover ring-1 ring-zinc-200" />
            <span className="tracking-tight">Pitch<span className="text-gold-grad">Play</span></span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMode("login")}
              className="text-sm font-semibold text-zinc-700 hover:text-gold transition-colors"
              data-testid="nav-login-btn"
            >
              Login
            </button>
            <Button
              onClick={() => setMode("signup")}
              className="rounded-full bg-gold hover:bg-gold-light text-night font-bold active:scale-95 transition-transform shadow-glow-gold"
              data-testid="nav-signup-btn"
            >
              Sign up
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero + Auth */}
      <section className="max-w-7xl mx-auto px-6 pt-10 pb-16 grid lg:grid-cols-5 gap-10 items-start">
        <div className="lg:col-span-3">
          <div className="relative rounded-2xl overflow-hidden border border-zinc-200 shadow-card">
            <img src={HERO} alt="Stadium under lights" className="w-full h-[420px] object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-night via-night/40 to-transparent" />
            <div className="grain absolute inset-0 opacity-20 mix-blend-overlay pointer-events-none" />
            <div className="absolute inset-0 p-10 flex flex-col justify-end">
              <span className="inline-flex items-center gap-2 self-start bg-gold text-night text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full shadow-glow-gold">
                <Sparkle weight="fill" size={12} /> Live Match Centre
              </span>
              <h1 className="mt-4 font-heading text-white text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tighter leading-[1.05]">
                Private cricket contests.<br />
                <span className="text-gold-grad">Play the pitch, win the pot.</span>
              </h1>
              <p className="mt-4 text-zinc-200 text-base max-w-lg leading-relaxed">
                Ball-by-ball scores, live rank movement, and winnings paid straight to your UPI.
              </p>
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-4 mt-6">
            {[
              { icon: ShieldCheck, title: "Play-safe controls", body: "Deposit limits, reality checks and self-exclusion built in." },
              { icon: Lightning, title: "Live everything", body: "Ball-by-ball feed, innings card and your rank after every over." },
              { icon: Trophy, title: "Direct payouts", body: "Winners withdraw to UPI once the contest settles." },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="bg-white border border-zinc-200 rounded-lg p-5 hover:border-zinc-300 hover:-translate-y-0.5 transition-transform shadow-card">
                <Icon size={22} weight="duotone" className="text-gold" />
                <div className="font-heading font-bold text-zinc-950 mt-3">{title}</div>
                <div className="text-sm text-zinc-500 mt-1 leading-relaxed">{body}</div>
              </div>
            ))}
          </div>

          {/* How it works */}
          <div className="mt-10" data-testid="how-it-works">
            <div className="text-xs font-bold uppercase tracking-widest text-zinc-500">How it works</div>
            <div className="grid sm:grid-cols-3 gap-4 mt-3">
              {STEPS.map(({ icon: Icon, title, body }, i) => (
                <div key={title} className="relative glass rounded-xl p-5 overflow-hidden">
                  <div className="absolute -right-4 -top-6 font-heading text-[92px] font-extrabold text-white/5 select-none tabular">{i + 1}</div>
                  <Icon size={26} weight="duotone" className="text-pitch" />
                  <div className="font-heading font-bold text-zinc-900 mt-3">{title}</div>
                  <div className="text-sm text-zinc-500 mt-1 leading-relaxed">{body}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="bg-white border border-zinc-200 rounded-2xl p-8 shadow-card" data-testid="auth-card">
            <div className="flex items-center gap-6 border-b border-zinc-100 pb-4">
              <button
                onClick={() => setMode("login")}
                className={`font-heading text-lg font-bold pb-2 transition-colors ${mode === "login" ? "text-gold border-b-2 border-gold -mb-[17px]" : "text-zinc-400"}`}
                data-testid="tab-login"
              >
                Login
              </button>
              <button
                onClick={() => setMode("signup")}
                className={`font-heading text-lg font-bold pb-2 transition-colors ${mode === "signup" ? "text-gold border-b-2 border-gold -mb-[17px]" : "text-zinc-400"}`}
                data-testid="tab-signup"
              >
                Sign up
              </button>
              <div className="ml-auto flex items-center rounded-full border border-zinc-200 p-0.5" data-testid="auth-method-switch">
                <button
                  onClick={() => setMethod("password")}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-widest transition-colors ${method === "password" ? "bg-night-card text-gold" : "text-zinc-500"}`}
                  data-testid="method-password"
                >
                  Password
                </button>
                <button
                  onClick={() => setMethod("otp")}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-widest transition-colors ${method === "otp" ? "bg-night-card text-gold" : "text-zinc-500"}`}
                  data-testid="method-otp"
                >
                  OTP
                </button>
              </div>
            </div>

            {method === "otp" ? (
              <OtpAuth onSignedIn={signInWithToken} invite={form.invite} />
            ) : (
            <form className="mt-6 space-y-4" onSubmit={submit}>
              {mode === "signup" && (
                <div>
                  <Label htmlFor="name" className="text-xs font-bold uppercase tracking-widest text-zinc-500">Full name</Label>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Virat K."
                    className="mt-2 border-zinc-200 focus-visible:ring-gold"
                    data-testid="input-name"
                    required
                  />
                </div>
              )}
              {mode === "signup" && (
                <div>
                  <Label htmlFor="invite" className="text-xs font-bold uppercase tracking-widest text-zinc-500">Invite code (optional)</Label>
                  <Input
                    id="invite"
                    value={form.invite}
                    onChange={(e) => setForm({ ...form, invite: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) })}
                    placeholder="6 characters from a friend"
                    className="mt-2 border-zinc-200 focus-visible:ring-gold tracking-[0.3em] uppercase"
                    data-testid="input-invite"
                  />
                </div>
              )}
              <div>
                <Label htmlFor="mobile" className="text-xs font-bold uppercase tracking-widest text-zinc-500">Mobile number</Label>
                <Input
                  id="mobile"
                  inputMode="numeric"
                  pattern="[0-9]{6,15}"
                  value={form.mobile}
                  onChange={(e) => setForm({ ...form, mobile: e.target.value })}
                  placeholder="9876543210"
                  className="mt-2 border-zinc-200 focus-visible:ring-gold tabular"
                  data-testid="input-mobile"
                  required
                />
              </div>
              <div>
                <Label htmlFor="password" className="text-xs font-bold uppercase tracking-widest text-zinc-500">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="Minimum 4 characters"
                  className="mt-2 border-zinc-200 focus-visible:ring-gold"
                  data-testid="input-password"
                  required
                />
              </div>
              <Button
                type="submit"
                disabled={busy}
                className="w-full h-11 bg-gold hover:bg-gold-light text-night font-bold text-base rounded-md active:scale-[0.98] transition-transform shadow-glow-gold"
                data-testid="auth-submit-btn"
              >
                {busy ? "Please wait..." : mode === "login" ? "Enter contest lobby" : "Create my account"}
                <ArrowRight size={18} weight="bold" className="ml-2" />
              </Button>
              <p className="text-xs text-zinc-500 text-center">
                Only your mobile is stored. Visible only to the admin.
              </p>
            </form>
            )}

            <div className="mt-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-zinc-200" />
              <span className="text-xs font-bold uppercase tracking-widest text-zinc-400">or</span>
              <div className="h-px flex-1 bg-zinc-200" />
            </div>

            <button
              type="button"
              onClick={googleSignIn}
              className="mt-5 w-full h-11 flex items-center justify-center gap-3 rounded-md border border-zinc-300 bg-white text-zinc-800 font-bold hover:bg-zinc-50 active:scale-[0.98] transition-transform"
              data-testid="google-signin-btn"
            >
              <GoogleLogo size={20} weight="bold" className="text-gold" />
              Continue with Google
            </button>
            <p className="mt-3 text-xs text-zinc-400 text-center">
              We'll ask for your mobile once, so payouts reach you.
            </p>
          </div>
        </div>
      </section>

      <footer className="border-t border-zinc-200 bg-white/90">
        <div className="max-w-7xl mx-auto px-6 py-6 flex justify-between text-sm text-zinc-500">
          <span>© PitchPlay — Play responsibly. 18+ only.</span>
          <span className="font-mono">v1.4.0</span>
        </div>
      </footer>
    </div>
  );
}
