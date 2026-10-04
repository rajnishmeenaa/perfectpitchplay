import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "./ui/dialog";
import { Button } from "./ui/button";
import { Ticket, Flag, Trophy, Sparkle } from "@phosphor-icons/react";

const SEEN_KEY = "pp.onboarded.v1";

export function hasSeenOnboarding() {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markOnboardingSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* private mode — the tour simply shows again next launch */
  }
}

/**
 * Smoothly rolls a number to its new value. Used for wallet balances and prize pots.
 *
 * requestAnimationFrame is paused while a WebView or tab is backgrounded, so the
 * roll is guarded by a timer that always lands on the target, and a page that is
 * already hidden shows the final figure immediately instead of sitting at zero.
 */
export function CountUp({ value, prefix = "₹", duration = 850, className = "", fromZero = false }) {
  const target = Number(value || 0);
  const [shown, setShown] = useState(fromZero ? 0 : target);
  const fromRef = useRef(fromZero ? 0 : target);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return undefined;

    const hidden = typeof document !== "undefined" && document.hidden;
    if (hidden) {
      fromRef.current = target;
      setShown(target);
      return undefined;
    }

    const start = performance.now();
    let raf = 0;
    let finished = false;
    const finish = () => {
      finished = true;
      fromRef.current = target;
      setShown(target);
    };
    const step = (now) => {
      if (finished) return;
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(from + (target - from) * eased));
      if (t < 1) raf = requestAnimationFrame(step);
      else finish();
    };
    raf = requestAnimationFrame(step);
    const guard = setTimeout(finish, duration + 250);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(guard);
    };
  }, [target, duration]);

  return (
    <span className={`tabular ${className}`} data-testid="count-up">
      {prefix}
      {shown.toLocaleString("en-IN")}
    </span>
  );
}

const STEPS = [
  {
    icon: Ticket,
    title: "Pick a contest",
    body: "Mega leagues, head-to-heads or a private contest from a friend's code. Entry fee and prize pool are always shown up front.",
    accent: "text-gold",
  },
  {
    icon: Flag,
    title: "Build your XI",
    body: "11 players, 100 credits. Captain scores 2x, vice-captain 1.5x. Auto-pick ranks the squad for you if you're short on time.",
    accent: "text-pitch-bright",
  },
  {
    icon: Trophy,
    title: "Watch live, get paid",
    body: "Ball-by-ball centre with your rank after every over. When the admin settles the contest, winnings land in your wallet for UPI withdrawal.",
    accent: "text-gold-light",
  },
];

export function OnboardingTour({ open, onClose }) {
  const [i, setI] = useState(0);
  if (!open) return null;
  const step = STEPS[i];
  const Icon = step.icon;
  const last = i === STEPS.length - 1;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md border-night-line bg-night-card text-zinc-900 rounded-2xl" data-testid="onboarding-tour">
        <div className="relative pt-2">
          <div className="absolute -top-6 -right-4 h-28 w-28 rounded-full bg-gold-soft blur-2xl pointer-events-none" />
          <div className="glass inline-flex h-14 w-14 items-center justify-center rounded-2xl">
            <Icon size={26} weight="duotone" className={step.accent} />
          </div>
          <DialogTitle className="mt-4 font-heading text-2xl font-extrabold tracking-tighter text-zinc-950">
            {step.title}
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm leading-relaxed text-zinc-500">
            {step.body}
          </DialogDescription>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <div className="flex items-center gap-1.5" data-testid="onboarding-dots">
            {STEPS.map((_, n) => (
              <span
                key={n}
                className={`h-1.5 rounded-full transition-all ${n === i ? "w-6 bg-gold" : "w-1.5 bg-zinc-300"}`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} className="text-zinc-500 font-bold" data-testid="onboarding-skip">
              Skip
            </Button>
            <Button
              size="sm"
              onClick={() => (last ? onClose() : setI(i + 1))}
              className="rounded-full bg-gold px-5 text-night font-extrabold hover:bg-gold-light shadow-glow-gold active:scale-95 transition-transform"
              data-testid="onboarding-next"
            >
              {last ? "Enter the lobby" : "Next"}
              {last && <Sparkle size={14} weight="fill" className="ml-1.5" />}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
