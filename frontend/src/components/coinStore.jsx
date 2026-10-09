import { useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { toast } from "sonner";
import { Coins, Lightning, Gift, CheckCircle, ArrowDown, ArrowUp, Crown, Sparkle } from "@phosphor-icons/react";

const coins = (n) => Number(n || 0).toLocaleString("en-IN");

const REASON_LABEL = {
  signup_bonus: "Welcome bonus",
  daily_bonus: "Daily bonus",
  store_purchase: "Store pack",
  plus_purchase: "PitchPlus",
  entry_fee: "Contest entry",
  prize: "Prize",
  refund: "Refund",
  admin_grant: "Adjusted by organiser",
};

/**
 * The Pitch Coin store: balance, the daily bonus, coin packs, PitchPlus and the
 * coin ledger. Purchases run through the store checkout — in sandbox billing
 * the grant is instant; in play mode the buttons wait for Google Play Billing.
 */
export function CoinStore({ coinCfg, onReload }) {
  const [ledger, setLedger] = useState([]);
  const [busy, setBusy] = useState("");

  const loadLedger = useCallback(() => {
    api.get("/coins/ledger").then((r) => setLedger(r.data)).catch(() => setLedger([]));
  }, []);
  useEffect(() => { loadLedger(); }, [loadLedger]);

  if (!coinCfg) {
    return (
      <div className="bg-white border border-zinc-200 rounded-lg p-8 text-center text-sm text-zinc-500" data-testid="store-loading">
        Loading the coin store…
      </div>
    );
  }

  if (!coinCfg.enabled) {
    return (
      <div className="bg-white border border-zinc-200 rounded-lg p-10 text-center" data-testid="store-disabled">
        <Coins size={40} weight="duotone" className="mx-auto text-amber-500" />
        <div className="font-heading text-xl font-extrabold text-zinc-950 mt-3">Pitch Coins are paused</div>
        <p className="text-sm text-zinc-500 mt-2 max-w-sm mx-auto">The organiser has switched the coin economy off for now. Your balance is safe — wallet contests continue as usual.</p>
        <div className="font-heading text-3xl font-extrabold text-amber-600 tabular mt-4">{coins(coinCfg.balance)}</div>
      </div>
    );
  }

  const claimDaily = async () => {
    setBusy("daily");
    try {
      const { data } = await api.post("/coins/daily");
      toast.success(`+${coins(data.claimed)} coins claimed!`);
      onReload();
      loadLedger();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't claim today's bonus");
    } finally {
      setBusy("");
    }
  };

  const buy = async (pack) => {
    setBusy(pack.id);
    try {
      const { data } = await api.post("/coins/store/checkout", { pack_id: pack.id });
      if (data.kind === "plus") toast.success("PitchPlus is active — enjoy your discount!");
      else toast.success(`+${coins(pack.coins)} coins added!`);
      onReload();
      loadLedger();
    } catch (e) {
      const code = e?.response?.status;
      if (code === 503) toast.info("Coin purchases are moving to Google Play — check back soon.");
      else toast.error(e?.response?.data?.detail || "Purchase failed");
    } finally {
      setBusy("");
    }
  };

  const coinPacks = (coinCfg.packs || []).filter((p) => (p.kind || "coins") === "coins");
  const plusPack = (coinCfg.packs || []).find((p) => p.kind === "plus");
  const playMode = coinCfg.billing_mode !== "sandbox";

  return (
    <div className="space-y-5" data-testid="coin-store">
      {/* Balance + daily bonus */}
      <div className="grid md:grid-cols-3 gap-5">
        <div className="md:col-span-2 bg-gradient-to-br from-amber-400 to-amber-600 text-white rounded-lg p-6 border border-amber-500">
          <div className="text-xs font-bold uppercase tracking-widest opacity-80">Pitch Coin balance</div>
          <div className="font-heading text-5xl font-extrabold tabular tracking-tighter mt-2" data-testid="coin-balance">
            {coins(coinCfg.balance)}
          </div>
          {coinCfg.plus_active ? (
            <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/15 border border-white/30 px-3 py-1.5" data-testid="plus-chip">
              <Crown size={14} weight="fill" className="text-white" />
              <span className="text-xs font-extrabold">PitchPlus active</span>
              <span className="text-[10px] font-bold uppercase tracking-widest opacity-80">{coinCfg.plus_discount_pct}% off entries</span>
            </div>
          ) : (
            <div className="mt-3 text-[11px] font-bold uppercase tracking-widest opacity-75">Spend on contest entries · never withdrawable</div>
          )}
        </div>
        <div className="bg-white border border-zinc-200 rounded-lg p-5 flex flex-col justify-between" data-testid="daily-bonus-card">
          <div>
            <div className="flex items-center gap-2">
              <Gift size={20} weight="duotone" className="text-amber-500" />
              <div className="font-heading font-bold text-zinc-950">Daily bonus</div>
            </div>
            <p className="text-xs text-zinc-500 mt-1.5">
              {coinCfg.daily_bonus > 0 ? `${coins(coinCfg.daily_bonus)} free coins every day you open PitchPlay.` : "No daily bonus is running right now."}
            </p>
          </div>
          {coinCfg.can_claim_daily ? (
            <Button onClick={claimDaily} disabled={busy === "daily"} className="mt-4 w-full bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-md active:scale-95" data-testid="claim-daily-btn">
              <Lightning size={16} weight="fill" className="mr-1" /> {busy === "daily" ? "Claiming…" : `Claim ${coins(coinCfg.daily_bonus)}`}
            </Button>
          ) : (
            <div className="mt-4 w-full text-center text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md py-2.5" data-testid="daily-claimed">
              <CheckCircle size={14} weight="fill" className="inline mr-1" /> Claimed today
            </div>
          )}
        </div>
      </div>

      {/* Packs */}
      <div>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-heading text-lg font-extrabold tracking-tight text-zinc-950">Coin packs</h2>
          {playMode && (
            <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-400" data-testid="play-mode-note">
              Purchases arrive with the next app update
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
          {coinPacks.map((p) => (
            <div key={p.id} className="bg-white border border-zinc-200 rounded-lg p-4 flex flex-col" data-testid={`pack-${p.id}`}>
              {p.tag && <span className="text-[10px] font-bold uppercase tracking-widest text-amber-600">{p.tag}</span>}
              <div className="flex items-center gap-1.5 mt-1">
                <Coins size={22} weight="fill" className="text-amber-500 shrink-0" />
                <span className="font-heading text-2xl font-extrabold text-zinc-950 tabular">{coins(p.coins)}</span>
              </div>
              <div className="text-xs text-zinc-500 font-semibold mt-0.5">{p.title}</div>
              <div className="mt-auto pt-3">
                <Button
                  disabled={busy === p.id || playMode || !(p.coins > 0)}
                  onClick={() => buy(p)}
                  className="w-full bg-zinc-950 hover:bg-zinc-800 text-white font-bold rounded-full text-xs active:scale-95"
                  data-testid={`buy-${p.id}`}
                >
                  {busy === p.id ? "Adding…" : playMode ? "Soon" : p.price_inr > 0 ? `Buy · ₹${coins(p.price_inr)}` : "Add free"}
                </Button>
              </div>
            </div>
          ))}
          {coinPacks.length === 0 && (
            <div className="col-span-full bg-white border border-zinc-200 rounded-lg p-6 text-center text-sm text-zinc-500">No coin packs on the shelf right now.</div>
          )}
        </div>
      </div>

      {/* PitchPlus */}
      {plusPack && (
        <div className="turf-air rounded-lg p-5 flex flex-col sm:flex-row sm:items-center gap-4" data-testid="plus-card">
          <div className="h-12 w-12 shrink-0 rounded-full bg-trophy/20 border border-trophy/50 grid place-items-center">
            <Crown size={24} weight="duotone" className="text-trophy-light" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-heading text-lg font-extrabold uppercase tracking-tight text-trophy-light">PitchPlus</span>
              <Sparkle size={14} weight="fill" className="text-trophy-light" />
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              {coinCfg.plus_discount_pct}% off every coin entry · {coinCfg.plus_days} days · pays for itself fast
            </p>
            {coinCfg.plus_active && <div className="text-[11px] font-bold text-neon-air mt-1">Active{coinCfg.plus_until ? ` until ${new Date(coinCfg.plus_until).toLocaleDateString("en-IN")}` : ""}</div>}
          </div>
          <Button
            disabled={playMode || coinCfg.plus_active || busy === plusPack.id}
            onClick={() => buy(plusPack)}
            className="shrink-0 bg-trophy hover:bg-trophy-light text-ink-950 font-extrabold rounded-full active:scale-95"
            data-testid="buy-plus-btn"
          >
            <Crown size={16} weight="fill" className="mr-1" />
            {coinCfg.plus_active ? "Already Plus" : `Get for ${coins(coinCfg.plus_price_coins)} coins`}
          </Button>
        </div>
      )}

      {/* Ledger */}
      <div className="bg-white border border-zinc-200 rounded-lg">
        <div className="p-5 border-b border-zinc-100 flex items-center gap-2">
          <Coins size={18} weight="duotone" className="text-amber-500" />
          <div className="font-heading font-bold text-zinc-950">Coin history</div>
        </div>
        {ledger.length === 0 ? (
          <div className="p-10 text-center text-sm text-zinc-500" data-testid="ledger-empty">No coin activity yet — claim the daily bonus to get started.</div>
        ) : (
          <div className="divide-y divide-zinc-100">
            {ledger.map((l) => (
              <div key={l.id} className="p-4 flex items-center justify-between gap-3" data-testid={`ledger-row-${l.id}`}>
                <div className="min-w-0">
                  <div className="font-bold text-sm text-zinc-950">{REASON_LABEL[l.reason] || l.reason}</div>
                  {l.note && <div className="text-xs text-zinc-500 mt-0.5 truncate">{l.note}</div>}
                  <div className="text-[11px] text-zinc-400 mt-0.5">{l.created_at ? new Date(l.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : ""}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className={`font-heading font-extrabold tabular ${l.delta >= 0 ? "text-emerald-700" : "text-red-600"}`} data-testid={`ledger-delta-${l.id}`}>
                    <span className="inline-flex items-center gap-1">
                      {l.delta >= 0 ? <ArrowDown size={13} weight="bold" /> : <ArrowUp size={13} weight="bold" />}
                      {l.delta >= 0 ? "+" : "−"}{coins(Math.abs(l.delta))}
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-400 tabular">bal {coins(l.balance_after)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
