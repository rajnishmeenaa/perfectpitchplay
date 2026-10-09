"""Rename the retired Stadium Gold colour tokens onto the Turf scale, and move
solid "go" greens onto the brand red so primary actions are unmistakably Turf.

Run from frontend/:  python scripts/turf_rename_tokens.py
Only class-name substrings are touched; copy text and comments are left alone.
"""
import io
import re
import glob

# Token renames: old Stadium Gold name -> Turf name.
RENAMES = [
    # gold -> turf (brand red). Order matters: longest first.
    ("shadow-glow-gold", "shadow-glow-turf"),
    ("text-gold-grad", "text-turf-grad"),
    ("text-gold-light", "text-trophy-light"),
    ("text-gold-dark", "text-trophy-dark"),
    ("text-gold", "text-turf"),
    ("bg-gold-soft", "bg-turf-red-soft"),
    ("bg-gold", "bg-turf"),
    ("border-gold", "border-turf"),
    ("ring-gold", "ring-turf"),
    ("from-gold", "from-turf"),
    ("via-gold", "via-turf"),
    ("to-gold", "to-turf"),
    # night -> ink (charcoal surfaces)
    ("bg-night-card", "bg-ink-card"),
    ("bg-night-soft", "bg-ink-soft"),
    ("bg-night", "bg-ink"),
    ("border-night-line", "border-ink-line"),
    ("border-night", "border-ink-line"),
    ("text-night", "text-ink"),
    # pitch -> neon (the old brand green is now a status colour)
    ("shadow-glow-pitch", "shadow-glow-neon"),
    ("bg-pitch-deep", "bg-neon-deep"),
    ("bg-pitch-bright", "bg-neon-bright"),
    ("bg-pitch", "bg-neon"),
    ("text-pitch", "text-neon"),
    ("border-pitch", "border-neon"),
    ("from-pitch", "from-neon"),
    ("to-pitch", "to-neon"),
]

# Solid "go" greens carried the primary action; brand red owns that now.
# Soft emerald badges (bg-emerald-50/100/200, text/border-emerald-*) stay as the
# positive-status colour, so only the solid 500/600/700 fills and rings move.
ACTION_GREENS = [
    ("hover:bg-emerald-700", "hover:bg-turf-red-dark"),
    ("hover:bg-emerald-600", "hover:bg-turf-red-dark"),
    ("hover:bg-emerald-500", "hover:bg-turf-red-dark"),
    ("bg-emerald-700", "bg-turf-red-dark"),
    ("bg-emerald-600", "bg-turf"),
    ("bg-emerald-500", "bg-turf"),
    ("border-emerald-600", "border-turf"),
    ("border-emerald-500", "border-turf"),
    ("ring-emerald-600", "ring-turf"),
    ("ring-emerald-500", "ring-turf"),
    ("focus:ring-emerald-500", "focus:ring-turf"),
    ("from-emerald-600", "from-turf"),
    ("to-emerald-600", "to-turf"),
    ("to-emerald-500", "to-turf"),
    # Active-tab / selected chips that used the same green.
    ("text-emerald-950", "text-white"),
]

FILES = sorted(glob.glob("src/**/*.jsx", recursive=True)) + ["src/index.css"]


def main():
    total = {}
    for path in FILES:
        s = io.open(path, encoding="utf-8").read()
        orig = s
        for a, b in RENAMES + ACTION_GREENS:
            if a in s:
                n = s.count(a)
                total[a] = total.get(a, 0) + n
                s = s.replace(a, b)
        if s != orig:
            io.open(path, "w", encoding="utf-8", newline="\n").write(s)
            print("updated", path)
    for a, n in sorted(total.items(), key=lambda kv: -kv[1]):
        print("%-26s %d" % (a, n))
    left = []
    for path in FILES:
        s = io.open(path, encoding="utf-8").read()
        for tok in ("-gold", "-night", "-pitch"):
            if tok in s:
                left.append((path, tok))
    print("retired-token leftovers:", left or "none")


if __name__ == "__main__":
    main()
