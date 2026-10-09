# PitchPlay — Dream11-grade light retheme (v1.8.0)

Working plan for the retheme. Implementation is a token pivot, not a screen rewrite:
the app's screens were authored with *light-intent* classnames (`bg-white`,
`text-zinc-950`, `bg-emerald-50`) and only turned dark through two levers — the
inverted `zinc` scale in `tailwind.config.js` and the unlayered remap block in
`index.css`. Flipping those two levers converts ~1000 class usages at once.

## Subject

Private fantasy-cricket contests for Indian players on mid-range Android. The
surface the product is judged on is the **contest lobby** — money has to be legible
in one glance, and "Join" has to be the loudest thing on the row.

## Palette (6 families)

| Name | Value | Role |
|---|---|---|
| Ground | `#F5F6F8` | page canvas — cool near-white, deliberately not cream |
| Chalk | `#FFFFFF` | card surfaces, sheet, dialogs |
| Brand | `#ED1B24` (+ fire `#FF4B52`, dark `#C6121A`, deep `#8E0C12`, tint `#FDECEC`) | wordmark, selection ring, live, destructive |
| Pitch | `#0E8B4E` (+ bright `#22C55E`, deep `#096B3C`, tint `#E8F6EE`) | the entry/join action, positive deltas, in-XI |
| Metal | `#9A6708` on light / `#F2B632` on dark (tint `#FDF3DE`) | prize money moments only |
| Broadcast | `#0B0E13` (+ raised `#151A22`, line `#262D38`) | live-score panels, winners board — stays dark on purpose |

Text neutral: `ink-950 #0B0E13` → `ink-500 #6B7480`, hairline `#E6E9EF`,
divider `#EEF1F5`. Contrast floor: every text token ≥ 4.5:1 on its surface.

Why green carries the CTA instead of the brand red: Dream11 convention says the
entry button is green and the brand is red, and here it is also literally the
colour of the ground the contest is played on. Red stays the identity, not the
every-button colour — that is what stops the light theme from reading as a wall
of alerts.

## Type

- **Display** — Barlow Condensed 800, uppercase, tracked +0.06em: fixtures, eyebrows,
  button labels, section heads.
- **Body** — Barlow 500/600 at 13–15px.
- **Money** — Barlow 800, `tabular-nums`, tracking −0.02em, with the ₹ glyph set at
  0.7em and weight 600 so the *number* is what lands. This is the typographic signature
  and it costs no new font download (the APK must stay offline-safe).

No third family: a new webfont is a network dependency in a packaged app.

## Layout

White cards on a cool grey canvas, 1px `#E6E9EF` borders, layered low-opacity shadows
(no glassmorphism). Contest row becomes a three-column money ledger —
`Prize pool | Spots left | Entry fee` separated by hairlines, `JOIN` pill on the right;
this is the scanning order a player actually uses. Fixture strip keeps the letter
badges; selected fixture gets a red ring, not a red fill. Live and winners sections
sit on Broadcast-dark so they read as a different instrument from the lobby.

## Signature element

**The mowed ground band** (`.turf-ground`): a freshly-cut-outfield stripe gradient
used as the header band of a featured/mega contest card and behind the prize numeral
in white condensed type. It comes from the subject's own material — groundsmanship —
rather than a decorative gradient, and it is the one thing in the app nobody else has.

## Rejected defaults (self-review)

- Left the charcoal + acid-green + gold look, which is the most common
  generated-theme cliché — and the app's current one.
- Rejected gold prize numerals on white (fails contrast and reads "premium badge"
  generically); prize figures are near-black, gold is reserved for dark bands.
- Rejected a serif display / cream canvas pairing — wrong register for sport.
- Rejected a new display webfont (offline APK) and reworked the money treatment instead.
- Boldness spent in exactly one place (the ground band); everything else stays quiet.

## Quality floor

Reduced-motion honoured (existing `prefers-reduced-motion` handling stays), visible
focus rings on red, 44px touch targets on Join/Bottom-nav, mobile-first one-column
lobby that becomes two at `md`.
