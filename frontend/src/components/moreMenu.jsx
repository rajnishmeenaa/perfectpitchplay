import { useEffect, useState } from "react";
import {
  Trophy, CalendarBlank, Ticket, Gear, GameController, ShieldCheck, List,
  Headset, CaretRight, SignOut, Coins, Info,
} from "@phosphor-icons/react";

/**
 * The account menu that opens from the avatar row: one place for prizes,
 * entries, bonus cash, profile details, help and play-safety shortcuts.
 * Rows carry their live numbers so the menu is readable at a glance, and every
 * row lands on a real screen — nothing here is a placeholder.
 */
export function MoreMenu({ open, onClose, user, stats, entries, onGo, onOpenTerms, onLogout, version }) {
  const [shown, setShown] = useState(open);

  // Keep the panel mounted through the slide-out so the transition can finish.
  useEffect(() => {
    if (open) setShown(true);
    else {
      const t = setTimeout(() => setShown(false), 220);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!shown) return null;

  const active = (entries || []).filter((e) => ["pending", "approved"].includes(e.status)).length;
  const wins = stats?.contests_won ?? 0;
  const won = stats?.winnings ?? 0;
  const bonus = user?.bonus_balance ?? 0;
  const name = (user?.name || "Player").trim();
  const initial = name.charAt(0).toUpperCase();

  const go = (tab, section) => {
    onGo(tab, section);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50" data-testid="more-menu" role="dialog" aria-modal="true" aria-label="Account menu">
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className={`absolute inset-0 bg-black/70 backdrop-blur-[2px] transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`}
        data-testid="more-menu-scrim"
      />
      <aside
        className={`absolute inset-y-0 left-0 w-full max-w-[380px] bg-night border-r border-night-line flex flex-col shadow-2xl transition-transform duration-200 ease-out ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        {/* Identity row — same shape as the nav so the panel feels like a continuation */}
        <div className="px-5 py-5 flex items-center gap-3 border-b border-night-line">
          <div className="h-12 w-12 shrink-0 rounded-full bg-gold/15 border border-gold/40 flex items-center justify-center font-heading text-xl font-extrabold text-gold" data-testid="more-avatar">
            {initial}
          </div>
          <button type="button" onClick={() => go("stats")} className="min-w-0 flex-1 flex items-center justify-between gap-2 text-left" data-testid="more-profile-row">
            <span className="font-heading text-xl font-extrabold uppercase tracking-tight text-zinc-50 truncate">{name}</span>
            <CaretRight size={18} weight="bold" className="text-zinc-500 shrink-0" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
          <MenuGroup>
            <MenuRow icon={Trophy} label="My Prizes" hint="Winnings and payout status"
              value={wins ? `${wins} · ₹${Number(won).toLocaleString("en-IN")}` : null} onClick={() => go("entries")} testid="more-prizes" />
            <MenuRow icon={CalendarBlank} label="My Matches" hint="Contests you are in"
              value={active || null} onClick={() => go("fantasy")} testid="more-matches" />
            <MenuRow icon={Ticket} label="Bonus & Coupons" hint="Non-withdrawable entry credit"
              value={bonus ? `₹${Number(bonus).toLocaleString("en-IN")}` : null} onClick={() => go("wallet", "bonus")} testid="more-vouchers" />
          </MenuGroup>

          <MenuGroup>
            <MenuRow icon={Gear} label="My Info & Settings" hint="Mobile, KYC and payout details"
              onClick={() => go("safety", "kyc")} testid="more-info" />
            <MenuRow icon={GameController} label="How to Play" hint="Scoring, credits and captain rules"
              onClick={() => go("safety", "faq")} testid="more-howtoplay" />
            <MenuRow icon={ShieldCheck} label="Responsible Play" hint="Limits, breaks and self-exclusion"
              onClick={() => go("safety", "limits")} testid="more-responsible" />
            <MenuRow icon={List} label="More" hint="Terms, skill-game notice and eligibility"
              onClick={() => { onOpenTerms(); onClose(); }} testid="more-more" />
          </MenuGroup>

          <MenuGroup>
            <MenuRow icon={Headset} label="24×7 Help & Support" hint="Ask about money, matches or accounts"
              onClick={() => go("safety", "support")} testid="more-support" />
          </MenuGroup>

          <div className="flex items-start gap-2 px-2 pb-1 text-[11px] leading-relaxed text-zinc-500">
            <Info size={13} weight="bold" className="mt-0.5 shrink-0 text-zinc-500" />
            <span>
              PitchPlay is a paid skill game. Only you can withdraw your wallet balance, and every
              settlement is published with its scorecard. 18+ only.
              {version ? ` You are on v${version}.` : ""}
            </span>
          </div>
        </div>

        <div className="px-4 py-4 border-t border-night-line flex items-center gap-2">
          <button
            type="button"
            onClick={() => { onLogout(); onClose(); }}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-md border border-night-line bg-night-card py-2.5 text-sm font-bold text-zinc-300 hover:text-red-400 hover:border-red-900 active:scale-[0.99] transition-colors"
            data-testid="more-logout"
          >
            <SignOut size={16} weight="bold" /> Sign out
          </button>
        </div>
      </aside>
    </div>
  );
}

function MenuGroup({ children }) {
  return <div className="bg-night-card border border-night-line rounded-xl overflow-hidden">{children}</div>;
}

function MenuRow({ icon: Icon, label, hint, value, onClick, testid }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full px-4 py-4 flex items-center gap-3.5 text-left hover:bg-white/5 active:bg-white/10 transition-colors border-b border-night-line last:border-b-0"
      data-testid={testid}
    >
      <Icon size={22} weight="duotone" className="text-zinc-300 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold text-zinc-100 leading-tight">{label}</span>
        {hint && <span className="block text-[11px] text-zinc-500 mt-0.5 truncate">{hint}</span>}
      </span>
      {value != null && value !== "" && (
        <span className="shrink-0 text-xs font-extrabold text-gold tabular" data-testid={`${testid}-value`}>{value}</span>
      )}
      <CaretRight size={16} weight="bold" className="text-zinc-600 shrink-0" />
    </button>
  );
}

/** Compact avatar trigger for the top nav — opens MoreMenu. */
export function AvatarTrigger({ user, onClick }) {
  const name = (user?.name || "Player").trim();
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2.5 pl-1.5 pr-2.5 py-1.5 rounded-full hover:bg-white/5 active:scale-[0.98] transition-all"
      data-testid="avatar-trigger"
      aria-label="Open account menu"
    >
      <span className="h-9 w-9 shrink-0 rounded-full bg-gold/15 border border-gold/40 flex items-center justify-center font-heading text-base font-extrabold text-gold" data-testid="avatar-initial">
        {name.charAt(0).toUpperCase()}
      </span>
      <span className="block max-w-[92px] sm:max-w-[150px] truncate font-heading text-sm font-extrabold uppercase tracking-tight text-zinc-100">{name}</span>
      <CaretRight size={15} weight="bold" className="text-zinc-500" />
    </button>
  );
}
