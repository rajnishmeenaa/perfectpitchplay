import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { toast } from "sonner";
import { ChatCenteredText, ShieldCheck, ArrowClockwise } from "@phosphor-icons/react";

const RESEND_SECONDS = 30;

/**
 * Passwordless mobile sign-in. The backend picks the delivery channel
 * (mock in development, MSG91 once keys are set), so this form never has to
 * know which SMS provider is live.
 */
export default function OtpAuth({ onSignedIn, invite = "" }) {
  const [step, setStep] = useState("phone"); // phone -> code -> profile
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [ref, setRef] = useState(invite || "");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const timer = useRef(null);

  useEffect(() => () => clearInterval(timer.current), []);

  const startCooldown = () => {
    setCooldown(RESEND_SECONDS);
    clearInterval(timer.current);
    timer.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) clearInterval(timer.current);
        return c - 1;
      });
    }, 1000);
  };

  const send = async (e) => {
    e?.preventDefault();
    const val = mobile.trim();
    if (!/^[0-9]{10}$/.test(val)) {
      toast.error("Enter your 10-digit mobile number");
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post("/auth/otp/request", { mobile: val });
      setStep("code");
      startCooldown();
      if (data.dev_code) {
        setCode(data.dev_code);
        toast.success(`Demo code ${data.dev_code} — SMS provider not configured yet`);
      } else {
        toast.success(`Code sent to ${val}`);
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not send the code right now");
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e) => {
    e?.preventDefault();
    if (code.trim().length !== 6) {
      toast.error("Enter the 6-digit code");
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post("/auth/otp/verify", { mobile: mobile.trim(), code: code.trim() });
      if (data.token) {
        const u = await onSignedIn(data.token);
        toast.success(`Welcome ${u.name}`);
        return;
      }
      if (data.needs_signup) {
        setStep("profile");
        toast.success("Number verified — choose a name and password");
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || "That code did not match");
    } finally {
      setBusy(false);
    }
  };

  const finishSignup = async (e) => {
    e?.preventDefault();
    if (!name.trim()) {
      toast.error("What should we call you?");
      return;
    }
    if (password.length < 4) {
      toast.error("Pick a password of at least 4 characters");
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post("/auth/otp/signup", {
        mobile: mobile.trim(), name: name.trim(), password, ref: ref.trim().toUpperCase() || undefined,
      });
      const u = await onSignedIn(data.token);
      toast.success(`Welcome ${u.name}`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not create your account");
    } finally {
      setBusy(false);
    }
  };

  const field = "mt-2 border-zinc-200 focus-visible:ring-gold";

  if (step === "phone") {
    return (
      <form onSubmit={send} className="mt-6 space-y-4" data-testid="otp-phone-form">
        <div>
          <Label htmlFor="otp-mobile" className="text-xs font-bold uppercase tracking-widest text-zinc-500">Mobile number</Label>
          <Input
            id="otp-mobile"
            inputMode="numeric"
            pattern="[0-9]{10}"
            value={mobile}
            onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
            placeholder="9876543210"
            className={`tabular ${field}`}
            data-testid="otp-mobile"
            required
          />
        </div>
        <Button
          type="submit"
          disabled={busy}
          className="w-full h-11 bg-gold hover:bg-gold-light text-night font-bold text-base rounded-md shadow-glow-gold active:scale-[0.98] transition-transform"
          data-testid="otp-send-btn"
        >
          <ChatCenteredText size={18} weight="bold" className="mr-2" />
          {busy ? "Sending…" : "Send verification code"}
        </Button>
        <p className="text-xs text-zinc-500 flex items-center gap-1.5">
          <ShieldCheck size={14} weight="fill" className="text-pitch" /> No password to forget. We text you a code each time.
        </p>
      </form>
    );
  }

  if (step === "code") {
    return (
      <form onSubmit={verify} className="mt-6 space-y-4" data-testid="otp-code-form">
        <div>
          <Label htmlFor="otp-code" className="text-xs font-bold uppercase tracking-widest text-zinc-500">6-digit code</Label>
          <Input
            id="otp-code"
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="••••••"
            className={`tabular tracking-[0.5em] text-center font-heading text-lg ${field}`}
            data-testid="otp-code"
            required
          />
        </div>
        <Button
          type="submit"
          disabled={busy}
          className="w-full h-11 bg-gold hover:bg-gold-light text-night font-bold text-base rounded-md shadow-glow-gold active:scale-[0.98] transition-transform"
          data-testid="otp-verify-btn"
        >
          {busy ? "Checking…" : "Verify and continue"}
        </Button>
        <button
          type="button"
          onClick={send}
          disabled={cooldown > 0 || busy}
          className="w-full text-xs font-bold uppercase tracking-widest text-zinc-500 hover:text-gold disabled:opacity-50 flex items-center justify-center gap-1.5"
          data-testid="otp-resend-btn"
        >
          <ArrowClockwise size={13} weight="bold" />
          {cooldown > 0 ? `Resend in ${cooldown}s` : "Send a new code"}
        </button>
        <button
          type="button"
          onClick={() => setStep("phone")}
          className="w-full text-xs text-zinc-500 hover:text-zinc-800"
          data-testid="otp-back-btn"
        >
          Use a different number
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={finishSignup} className="mt-6 space-y-4" data-testid="otp-profile-form">
      <div>
        <Label htmlFor="otp-name" className="text-xs font-bold uppercase tracking-widest text-zinc-500">Full name</Label>
        <Input id="otp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Virat K." className={field} data-testid="otp-name" required />
      </div>
      <div>
        <Label htmlFor="otp-password" className="text-xs font-bold uppercase tracking-widest text-zinc-500">Backup password</Label>
        <Input
          id="otp-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Minimum 4 characters"
          className={field}
          data-testid="otp-password"
          required
        />
      </div>
      <div>
        <Label htmlFor="otp-ref" className="text-xs font-bold uppercase tracking-widest text-zinc-500">Invite code (optional)</Label>
        <Input
          id="otp-ref"
          value={ref}
          onChange={(e) => setRef(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
          placeholder="6 characters from a friend"
          className={`tracking-[0.3em] uppercase ${field}`}
          data-testid="otp-ref"
        />
      </div>
      <Button
        type="submit"
        disabled={busy}
        className="w-full h-11 bg-gold hover:bg-gold-light text-night font-bold text-base rounded-md shadow-glow-gold active:scale-[0.98] transition-transform"
        data-testid="otp-signup-btn"
      >
        {busy ? "Creating…" : "Create my account"}
      </Button>
      <p className="text-xs text-zinc-500">
        {mobile} is verified. You can still sign in with the code instead of this password.
      </p>
    </form>
  );
}
