import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { toast } from "sonner";
import {
  Gift, Copy, WhatsappLogo, Trophy, ChartBar, Ticket, Flag, Lightning, Timer,
  ShieldCheck, Lock, ArrowUp, ArrowDown, Minus,
} from "@phosphor-icons/react";

const BADGE_ICONS = { Flag, Ticket, Trophy, ChartBar, Lightning, Timer, ShieldCheck };

/** Invite-and-earn card. Renders a disabled state when the operator has not switched referrals on. */
export function ReferralCard() {
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get("/me/referral").then((r) => alive && setData(r.data)).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!data) return null;

  const copy = () => {
    navigator.clipboard?.writeText(data.share_text);
    toast.success("Invite message copied");
  };
  const share = async () => {
    const payload = { title: "PitchPlay", text: data.share_text };
    if (navigator.share) {
      try { await navigator.share(payload); return; } catch (e) { if (e?.name === "AbortError") return; }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(data.share_text)}`, "_blank", "noopener");
  };

  const rewardsOn = data.enabled && (data.referee_bonus > 0 || data.referrer_reward > 0);

  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-5" data-testid="referral-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-heading font-extrabold text-zinc-950 flex items-center gap-2">
            <Gift size={18} weight="fill" className="text-gold" /> Invite friends
          </h3>
          <p className="text-sm text-zinc-500 mt-1">
            {rewardsOn
              ? `You earn ${money(data.referrer_reward)} bonus for each friend who deposits ${money(data.min_deposit)}. They start with ${money(data.referee_bonus)} bonus.`
              : "Share your code now — rewards switch on when the organiser enables them."}
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="font-heading text-2xl font-extrabold text-gold tabular leading-none">{data.code}</div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mt-1">your code</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-4">
        <Button size="sm" onClick={share} className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold active:scale-95" data-testid="referral-share-btn">
          <WhatsappLogo size={15} weight="fill" className="mr-1.5" /> Share invite
        </Button>
        <Button size="sm" variant="outline" onClick={copy} className="rounded-full font-bold" data-testid="referral-copy-btn">
          <Copy size={14} weight="bold" className="mr-1.5" /> Copy message
        </Button>
        <span className="ml-auto text-xs text-zinc-500 tabular" data-testid="referral-counts">
          {data.invited_count} invited · {data.rewarded_count} joined the pitch
          {data.earned > 0 && <> · {money(data.earned)} earned</>}
        </span>
      </div>

      {data.invited.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {data.invited.slice(0, 5).map((i) => (
            <li key={i.name + (i.at || "")} className="flex items-center justify-between text-sm" data-testid={`referral-row-${i.name}`}>
              <span className="text-zinc-700 font-semibold">{i.name}</span>
              <span className={`text-[11px] font-bold uppercase tracking-wider ${i.rewarded ? "text-emerald-700" : "text-zinc-500"}`}>
                {i.rewarded ? "rewarded" : "signed up"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {data.invited_by && (
        <p className="text-[11px] text-zinc-500 mt-3">Invited by {data.invited_by}.</p>
      )}
    </div>
  );
}

/** Trophy cabinet built from settled contest history. */
export function BadgeShelf() {
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get("/me/badges").then((r) => alive && setData(r.data)).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!data) return null;

  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-5" data-testid="badge-shelf">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-heading font-extrabold text-zinc-950 flex items-center gap-2">
          <Trophy size={18} weight="fill" className="text-gold" /> Badge cabinet
        </h3>
        <span className="text-xs font-bold uppercase tracking-widest text-zinc-500 tabular" data-testid="badge-count">
          {data.earned_count} of {data.badges.length} earned · {data.week_streak}-week streak
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 mt-4">
        {data.badges.map((b) => {
          const Icon = BADGE_ICONS[b.icon] || Trophy;
          return (
            <div
              key={b.key}
              className={`rounded-lg border px-3 py-3 ${b.earned ? "border-gold/40 bg-gold/10" : "border-zinc-200 bg-zinc-50 opacity-60"}`}
              data-testid={`badge-${b.key}`}
            >
              {b.earned
                ? <Icon size={20} weight="fill" className="text-gold" />
                : <Lock size={20} weight="bold" className="text-zinc-400" />}
              <div className="text-[12px] font-extrabold text-zinc-900 mt-2 leading-tight">{b.label}</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">{b.hint}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Where you sit against everyone else this season. */
export function SeasonLadder() {
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get("/leaderboard/season?limit=15").then((r) => alive && setData(r.data)).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!data) return null;
  const medal = (rank) => (rank === 1 ? "bg-gold text-night" : rank === 2 ? "bg-zinc-300 text-night" : rank === 3 ? "bg-orange-300 text-night" : "bg-zinc-100 text-zinc-600");

  return (
    <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden" data-testid="season-ladder">
      <div className="px-5 py-4 flex items-center justify-between gap-3 border-b border-zinc-100">
        <h3 className="font-heading font-extrabold text-zinc-950 flex items-center gap-2">
          <ChartBar size={18} weight="fill" className="text-gold" /> {data.season} ranking
        </h3>
        <span className="text-xs text-zinc-500 tabular">{data.total_players} players</span>
      </div>
      {data.rows.length === 0 ? (
        <div className="p-8 text-center text-sm text-zinc-500">
          Nobody has scored yet. Settle a contest and the ladder fills up.
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {data.rows.map((r) => (
            <li key={r.user_id} className={`px-5 py-3 flex items-center gap-3 ${r.is_me ? "bg-emerald-50" : ""}`} data-testid={`ladder-row-${r.rank}`}>
              <span className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-[11px] font-extrabold tabular ${medal(r.rank)}`}>
                {r.rank}
              </span>
              <span className="flex-1 min-w-0 truncate text-sm font-bold text-zinc-900">
                {r.name}{r.is_me && <span className="ml-2 text-[10px] uppercase tracking-widest text-emerald-700">you</span>}
              </span>
              {r.wins > 0 && (
                <span className="text-[11px] font-bold text-zinc-500 tabular hidden sm:inline" data-testid={`ladder-wins-${r.rank}`}>
                  {r.wins}W
                </span>
              )}
              <span className="font-heading font-extrabold text-zinc-950 tabular text-sm" data-testid={`ladder-pts-${r.rank}`}>
                {r.points} <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">pts</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {data.me && !data.rows.some((r) => r.is_me) && (
        <div className="px-5 py-3 border-t border-zinc-100 flex items-center gap-3 bg-emerald-50" data-testid="ladder-me">
          <span className="w-7 h-7 shrink-0 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[11px] font-extrabold tabular">{data.me.rank}</span>
          <span className="flex-1 text-sm font-bold text-zinc-900">You</span>
          <span className="font-heading font-extrabold text-zinc-950 tabular text-sm">{data.me.points} pts</span>
        </div>
      )}
    </div>
  );
}

/** Small helper used by the ladder to show movement without a second call. */
export function DeltaArrow({ delta }) {
  if (!delta) return <Minus size={13} className="text-zinc-400 inline" />;
  return delta > 0
    ? <ArrowUp size={13} weight="bold" className="text-emerald-600 inline" />
    : <ArrowDown size={13} weight="bold" className="text-red-500 inline" />;
}

const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
