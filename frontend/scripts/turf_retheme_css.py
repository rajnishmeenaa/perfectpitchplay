"""One-shot retheme: Stadium Gold (green/gold) -> Turf (brand red + charcoal).

Run from frontend/:  python scripts/turf_retheme_css.py
It rewrites src/index.css in place. Idempotent: re-running only re-applies
substitutions that are still present.
"""
import io
import re

PATH = "src/index.css"

GREEN_TO_CHARCOAL = [
    ("hsl(153 40% 8%)", "hsl(222 22% 9%)"),
    ("hsl(153 40% 8% / 0.9)", "hsl(222 22% 9% / 0.9)"),
    ("hsl(153 40% 8% / 0.95)", "hsl(222 22% 9% / 0.95)"),
    ("hsl(153 40% 8% / 0.8)", "hsl(222 22% 9% / 0.8)"),
    ("hsl(153 40% 8% / 0.7)", "hsl(222 22% 9% / 0.7)"),
    ("hsl(153 40% 8% / 0.6)", "hsl(222 22% 9% / 0.6)"),
    ("hsl(153 40% 8% / 0.5)", "hsl(222 22% 9% / 0.5)"),
    ("hsl(153 40% 8% / 0.4)", "hsl(222 22% 9% / 0.4)"),
    ("hsl(153 40% 8% / 0.3)", "hsl(222 22% 9% / 0.3)"),
    ("hsl(153 40% 8% / 0.2)", "hsl(222 22% 9% / 0.2)"),
    ("hsl(153 40% 8% / 0.1)", "hsl(222 22% 9% / 0.1)"),
    ("hsl(153 40% 8% / 0.05)", "hsl(222 22% 9% / 0.05)"),
    ("hsl(153 40% 8% / 0.72)", "hsl(222 22% 9% / 0.72)"),
    ("#071109", "#0A0C11"),
    ("#0A1810", "#0E1117"),
    ("#0D1D14", "#14181F"),
    ("#0C1B13", "#12151C"),
    ("#050D08", "#05060A"),
    ("#10261B", "#12151C"),
    ("#16301F", "#171B23"),
    ("#1B3A28", "#1A1F28"),
    ("#1B352A", "#272E3A"),
    ("#2A4D3D", "#3A4352"),
    ("#0F2119", "#12151C"),
    ("#5E7869", "#3A4352"),
    ("#0C1A13", "#101319"),
    ("rgb(10 24 16 /", "rgb(10 12 17 /"),
    ("rgb(16 38 27 /", "rgb(18 21 28 /"),
    ("#F4FAF6", "#F7FAFD"),
    ("rgb(244 250 246 /", "rgb(247 250 253 /"),
    ("#F7FBF9", "#FDFEFF"),
    ("#EFF7F2", "#F6F9FC"),
    ("#DEEDE4", "#EBF0F5"),
    ("#C4DACC", "#D9E1EA"),
    ("#93B3A3", "#93A0B0"),
    ("rgba(31, 169, 104, 0.14)", "rgba(237, 27, 36, 0.18)"),
    ("rgba(242, 182, 50, 0.10)", "rgba(43, 245, 124, 0.09)"),
    ("accent-color: #1FA968", "accent-color: #ED1B24"),
    ("accent-color: #F2B632", "accent-color: #ED1B24"),
]

# Semantic tint families: hue-shift the light-theme badges onto charcoal tints.
TINT_HUES = [
    ("rgb(16 185 129 /", "rgb(43 245 124 /"),    # emerald -> neon turf green
    ("rgb(239 68 68 /", "rgb(237 27 36 /"),      # red -> brand red
    ("rgb(245 158 11 /", "rgb(242 182 50 /"),    # amber -> trophy gold
    ("rgb(249 115 22 /", "rgb(251 146 60 /"),    # orange
    ("rgb(59 130 246 /", "rgb(96 165 250 /"),    # blue
    ("rgb(14 165 233 /", "rgb(56 189 248 /"),    # sky
    ("rgb(139 92 246 /", "rgb(167 139 250 /"),   # violet
]

TEXT_SHADES = [
    (".text-emerald-700 { color: #6ee7b7; }",
     ".text-emerald-500 { color: #2BF57C; }\n.text-emerald-600 { color: #35F58A; }\n.text-emerald-700 { color: #6BFFA8; }"),
    (".text-emerald-800 { color: #a7f3d0; }", ".text-emerald-800 { color: #A5FFC8; }"),
    (".text-emerald-900 { color: #d1fae5; }", ".text-emerald-900 { color: #D6FFE6; }"),
    (".text-red-700 { color: #fca5a5; }",
     ".text-red-500 { color: #FF4B52; }\n.text-red-600 { color: #FF6A70; }\n.text-red-700 { color: #FF8A8F; }"),
    (".text-red-800 { color: #fecaca; }", ".text-red-800 { color: #FFBDC0; }"),
    (".text-red-900 { color: #fee2e2; }", ".text-red-900 { color: #FFD9DB; }"),
    (".text-amber-700 { color: #fcd34d; }", ".text-amber-700 { color: #FFD35C; }"),
    (".text-amber-800 { color: #fde68a; }", ".text-amber-800 { color: #FFE08A; }"),
    (".text-amber-900 { color: #fef3c7; }", ".text-amber-900 { color: #FFF1C7; }"),
    (".border-emerald-300 { border-color: rgb(43 245 124 / 0.45); }",
     ".border-emerald-300 { border-color: rgb(43 245 124 / 0.46); }\n.border-emerald-400 { border-color: rgb(43 245 124 / 0.55); }"),
]

VARS_OLD_START = "        --background: 152 47% 4%;"
VARS_OLD_END = "        --chart-5: 166 70% 38%;"
VARS_NEW = """        --background: 225 33% 3%;
        --foreground: 213 24% 91%;
        --card: 222 22% 9%;
        --card-foreground: 213 24% 91%;
        --popover: 223 25% 6%;
        --popover-foreground: 213 24% 91%;
        --primary: 357 85% 52%;
        --primary-foreground: 0 0% 100%;
        --secondary: 221 20% 15%;
        --secondary-foreground: 213 24% 91%;
        --muted: 221 18% 14%;
        --muted-foreground: 216 13% 60%;
        --accent: 357 85% 52%;
        --accent-foreground: 0 0% 100%;
        --destructive: 0 72% 51%;
        --destructive-foreground: 0 0% 100%;
        --border: 220 17% 19%;
        --input: 220 16% 22%;
        --ring: 357 85% 52%;
        --radius: 0.625rem;
        --chart-1: 148 82% 48%;
        --chart-2: 43 88% 57%;
        --chart-3: 357 85% 52%;
        --chart-4: 38 92% 50%;
        --chart-5: 199 89% 48%;"""

TURF_CLASSES = """

/* ============================================================================
   TURF COMPONENT CLASSES
   Molecules and organisms compose these instead of restating raw hex values, so
   one token change moves web, Android and iOS together.
   ========================================================================== */

/* Card surface: charcoal with a hairline and a soft drop. */
.turf-card {
    background: linear-gradient(180deg, #14181F 0%, #101319 100%);
    border: 1px solid #272E3A;
    border-radius: 0.875rem;
    box-shadow: 0 10px 28px -18px rgba(0, 0, 0, 0.9);
}

/* Leading colour bar on a card edge - brand red by default. */
.turf-flag { position: relative; overflow: hidden; }
.turf-flag::before {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    width: 4px;
    background: linear-gradient(180deg, #FF4B52, #ED1B24 55%, #B01018);
}
.turf-flag.is-neon::before { background: linear-gradient(180deg, #6BFFA8, #2BF57C 55%, #0B7A43); }
.turf-flag.is-trophy::before { background: linear-gradient(180deg, #FFD35C, #F2B632 55%, #B97F14); }

/* Primary action: brand red, condensed uppercase label. */
.turf-cta {
    background: linear-gradient(180deg, #FF3640 0%, #ED1B24 52%, #C6121A 100%);
    color: #fff;
    font-family: 'Barlow Condensed', ui-sans-serif, sans-serif;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    border: 1px solid rgba(255, 255, 255, 0.14);
    box-shadow: 0 10px 26px -16px rgba(237, 27, 36, 0.95);
}
.turf-cta:hover { filter: brightness(1.06); }
.turf-cta:active { transform: translateY(1px); }
.turf-cta:disabled { filter: grayscale(0.55) brightness(0.72); box-shadow: none; }

/* Secondary action on charcoal. */
.turf-ghost {
    background: #171B23;
    border: 1px solid #272E3A;
    color: #D9E1EA;
    font-family: 'Barlow Condensed', ui-sans-serif, sans-serif;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
}
.turf-ghost:hover { border-color: #ED1B24; color: #FDFEFF; }

/* Eyebrow label above a section, stat block or table. */
.turf-eyebrow {
    font-family: 'Barlow Condensed', ui-sans-serif, sans-serif;
    font-weight: 700;
    font-size: 0.6875rem;
    line-height: 0.875rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #93A0B0;
}

/* Scoreboard numerals: countdowns, prize pools, ranks, credits. */
.turf-num { font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }

/* Mowed-turf texture behind the team-creation pitch. */
.turf-pitch {
    background:
        repeating-linear-gradient(180deg, rgba(43, 245, 124, 0.075) 0 34px, rgba(43, 245, 124, 0.02) 34px 68px),
        radial-gradient(120% 80% at 50% 0%, rgba(43, 245, 124, 0.10), transparent 70%),
        #080B0E;
}

/* Horizontally scrolling sport / filter strip, no visible scrollbar. */
.turf-strip {
    display: flex;
    gap: 0.5rem;
    overflow-x: auto;
    scroll-snap-type: x proximity;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
}
.turf-strip::-webkit-scrollbar { display: none; }
.turf-strip > * { scroll-snap-align: start; flex: 0 0 auto; }

/* Brand-red treatment for hero copy. */
.text-turf-fire {
    background: linear-gradient(100deg, #FF4B52 0%, #ED1B24 46%, #B01018 100%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
}

/* Radix switches, ranges and checkboxes take the brand colour when on. */
[role="switch"][data-state="checked"] { background-color: #ED1B24; border-color: #ED1B24; }
input[type="range"] { accent-color: #ED1B24; }
"""


def main():
    s = io.open(PATH, encoding="utf-8").read()
    before = s

    # Fonts: a condensed display face for scoreboards, Barlow for dense body stats.
    s = s.replace(
        "@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900"
        "&family=Manrope:wght@400;500;600;700;800&display=swap');",
        "@import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800;900"
        "&family=Barlow+Condensed:wght@500;600;700;800;900&display=swap');")
    s = s.replace("    font-family: 'Manrope', ui-sans-serif, system-ui, sans-serif;",
                  "    font-family: 'Barlow', ui-sans-serif, system-ui, sans-serif;")
    s = s.replace(".font-heading { font-family: 'Outfit', ui-sans-serif, system-ui, sans-serif; }",
                  ".font-heading { font-family: 'Barlow Condensed', ui-sans-serif, system-ui, sans-serif; letter-spacing: 0.01em; }")
    s = s.replace(".font-body { font-family: 'Manrope', ui-sans-serif, system-ui, sans-serif; }",
                  ".font-body { font-family: 'Barlow', ui-sans-serif, system-ui, sans-serif; }\n"
                  ".font-display { font-family: 'Barlow Condensed', Impact, ui-sans-serif, sans-serif; }")

    s = s.replace("    background-color: #071109;\n    color: #F0F7F2;",
                  "    background-color: #05060A;\n    color: #E7ECF3;")

    if VARS_OLD_START in s:
        i = s.index(VARS_OLD_START)
        j = s.index(VARS_OLD_END) + len(VARS_OLD_END)
        s = s[:i] + VARS_NEW + s[j:]

    for pairs in (GREEN_TO_CHARCOAL, TINT_HUES, TEXT_SHADES):
        for a, b in pairs:
            s = s.replace(a, b)

    # Selection colour follows the brand.
    s = s.replace("::selection {\n    background: #F2B632;\n    color: #0A0C11;\n}",
                  "::selection {\n    background: #ED1B24;\n    color: #FFFFFF;\n}")

    # Rename the money gradient helper to the Turf name, keep the old one working.
    s = s.replace("/* Gold gradient text for money / hero moments */\n.text-gold-grad {",
                  "/* Trophy gradient for prize money and hero numbers */\n.text-turf-grad,\n.text-gold-grad {")

    if ".turf-card" not in s:
        s = s.rstrip() + TURF_CLASSES

    io.open(PATH, "w", encoding="utf-8", newline="\n").write(s)

    left = re.findall(r"#(?:071109|0A1810|10261B|1B352A|1FA968|0F2119|5E7869|0C1A13|16301F|1B3A28)\b", s)
    print("bytes %d -> %d" % (len(before), len(s)))
    print("leftover green tokens:", sorted(set(left)))
    print("barlow refs:", s.count("Barlow"), "| turf classes:", len(re.findall(r"\.turf-", s)))


if __name__ == "__main__":
    main()
