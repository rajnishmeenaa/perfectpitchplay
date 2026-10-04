import { House, Flag, Trophy, Wallet, List } from "@phosphor-icons/react";

/**
 * Primary navigation, floating at the bottom like the apps people already use.
 * The five destinations are the ones a player reaches for with one thumb; the
 * long tail (stats, safety, help, terms) lives behind "More".
 */
export function BottomNav({ active, onChange, openEntries = 0, balance, onMore }) {
  const items = [
    { key: "contests", icon: House, label: "Home" },
    { key: "fantasy", icon: Flag, label: "Fantasy" },
    { key: "entries", icon: Trophy, label: "My Contests", badge: openEntries },
    { key: "wallet", icon: Wallet, label: "Wallet", value: balance },
    { key: "more", icon: List, label: "More", action: onMore },
  ];

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 px-3"
      style={{ paddingBottom: "max(0.65rem, env(safe-area-inset-bottom))", paddingTop: "0.5rem" }}
      data-testid="bottom-nav"
      aria-label="Main navigation"
    >
      <div className="mx-auto max-w-md rounded-[26px] bg-ink/95 backdrop-blur-md border border-ink-line shadow-[0_-6px_30px_rgba(0,0,0,0.45)] px-1.5 py-1.5 flex items-stretch justify-between gap-0.5">
        {items.map((it) => {
          const Icon = it.icon;
          const on = active === it.key;
          return (
            <button
              key={it.key}
              type="button"
              onClick={() => (it.action ? it.action() : onChange(it.key))}
              aria-current={on ? "page" : undefined}
              className={`relative flex-1 min-w-0 rounded-[20px] px-1 py-2 flex flex-col items-center gap-1 transition-colors active:scale-[0.97] ${on ? "bg-turf/15" : "hover:bg-white/5"}`}
              data-testid={`nav-${it.key}`}
            >
              <span className="relative">
                <Icon size={21} weight={on ? "fill" : "bold"} className={on ? "text-turf" : "text-zinc-500"} />
                {it.badge > 0 && (
                  <span className="absolute -right-2 -top-1.5 min-w-[16px] h-4 px-1 rounded-full bg-turf text-ink text-[10px] font-extrabold leading-4 tabular" data-testid={`nav-badge-${it.key}`}>
                    {it.badge > 99 ? "99+" : it.badge}
                  </span>
                )}
              </span>
              <span className={`text-[10px] font-bold uppercase tracking-tight truncate max-w-full ${on ? "text-zinc-50" : "text-zinc-500"}`}>
                {it.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
