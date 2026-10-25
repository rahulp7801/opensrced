# opensrcer brand system

Warm paper, near-black ink, one cobalt signal; a heavy, slightly condensed
display face in sentence case, a quiet sans that explains; a code map and a
pen-ring "o" as the signature, a few fine hand-drawn marks. Personal, calm,
readable. Everything here is CSS + SVG + a little React, no dependencies.

## Tokens (app/globals.css `@theme`)

Legacy names, **inverted**: `ink` is the GROUND, `paper` is the TEXT. Keep the
names; the values are the brand.

| Token | Value | Use |
| --- | --- | --- |
| `ink` | `#f6e9e0` | page ground (blush paper); also text on dark/cobalt fills |
| `ink-2` | `#faf2ec` | a lighter band of ground |
| `surface` | `#fffaf6` | sheets on the ground (cards, pills, inputs) |
| `surface-2` / `surface-3` | `#f0e1d6` / `#e8d6c9` | hover, wells, selected rows |
| `border-soft` / `border` / `border-strong` | `#e6d5c9` / `#d8c2b3` / `#968070` | hairlines; strong is 3.1:1 on ground |
| `paper` | `#1c1714` | text, the CTA pill, stickers |
| `paper-2`, `-dim`, `-muted`, `-faint` | `#2e2622` `#463c36` `#5e524a` `#685b52` | secondary text, in that order of quiet |
| `signal` | `#2338e6` | cobalt: links, the CTA arrow, emphasis, signal stickers |
| `signal-soft` | `#1b2dcc` | deeper cobalt (hover on cobalt fills) |
| `signal-dim` | `#b3bbf4` | pale cobalt tint: unrevealed InkReveal words, decorative fills. Never body text |
| `signal-faint` | `#e9e8fc` | soft fill behind cobalt text |
| `ok` / `alert` / `info` (+ `-dim`) | `#145a33` / `#971c26` / `#1d4f8f` | status text and dots |

Measured contrast (WCAG 2.x):

| Text on → | ink | ink-2 | surface | surface-2 | surface-3 |
| --- | --- | --- | --- | --- | --- |
| paper | 14.9 | 16.1 | 17.1 | 13.9 | 12.6 |
| paper-muted | 6.4 | 6.8 | 7.3 | 5.9 | 5.4 |
| paper-faint | 5.5 | 5.9 | 6.3 | 5.1 | 4.6 |
| signal | 6.4 | 6.8 | 7.3 | 5.9 | 5.4 |
| ok / alert / info | 7.0 / 7.0 / 6.9 | | 8.0 / 8.1 / 7.9 | | 5.9 / 5.9 / 5.8 |

White on `signal` 7.5:1; `ink` on `signal` 6.4:1; `signal` on `signal/20` over
the ground 4.6:1 (ok 5.1, alert 5.0, info 5.0); `signal` on `signal-faint` 6.3:1.
`paper` on `signal` is only 2.4:1: put white or `text-ink` on cobalt, never ink.

Easing: `--ease-pop` (a settle with a little overshoot: stickers, pills),
`--ease-arrive` (long calm ease-out: things arriving).

## Type (app/layout.tsx, next/font, all OFL, self-hosted)

- **Bricolage Grotesque** (`font-display`, `.display`, `.shout`): headlines.
  Width axis 75–100 via `font-stretch`; optical size is automatic, so big
  sizes get the ink-trapped display cut. `.display` = 750, 88% wide: headlines
  and page titles. The landing hero is the same face at 800, 82% wide,
  sentence case. `.shout` (800, 75%, uppercase) still exists for a single
  word or number at most; never a whole hero.
- **Instrument Sans** (`font-sans`, the default): everything you read.
- **JetBrains Mono** (`font-mono`): code, logs, ids, receipts.
- `.kicker`: 12.5px uppercase tracked label in the sans (section labels).
- `.rise`: a load-time arrival (0.25em rise + fade, `--ease-arrive`); stagger
  with `style={{ "--delay": "80ms" }}`. Hero lines only. Never blur type in.

## Components (components/brand)

| Component | What | Motion |
| --- | --- | --- |
| `<CodeMap label>` | **the signature**: eight small nodes, hairline edges, and one cobalt path that draws through them and lands in the ring-"o" (the function you're changing, named by `label`). Illustrative: always caption it in HTML with a true statement | hairlines fade in, nodes settle, the cobalt path draws, the ring lands (load) |
| `<Sticker tone="ink\|signal\|paper" tilt={-2} pop="load\|scroll\|none" delay>` | small pill; one per view at most, tilt ≤ 2°, never covering text | pops (scale + rotate settle, `--ease-pop`) |
| `<CtaPill href size="md\|sm">` | near-black pill + round cobalt arrow: the brand CTA, **landing hero and stage close only** | arrow turns 45° and swells on hover |
| `.text-link` (class) | secondary actions as words: underlined, 40px tap height, cobalt on hover; external links get a trailing ↗ | colour |
| `.tab-link` (class) | navigation as text (header nav, tab strips); `aria-current="page"` = ink text + 2px ink rule on the bar's hairline | colour |
| `.fig-tag` (class) | the boxed `fig. 1` ahead of a mono figure caption (`font-mono text-[11.5px] text-paper-faint`) | none |
| `.pill` (class) | off-white pill; only for toggles (filters, segmented controls) now, not links or statuses | press scale |
| `<Marquee items curved tone>` | ticker band. **Not used on the landing any more**; avoid `curved` (see Don't) | drifts; static under reduced motion |
| `<Doodle doodle={loop} tone draw="load\|scroll\|none" weight={0.6} stretch>` | hand-drawn marks: `loop`, `heroLoop`, `underline`, `arrow`, `nodes`, `circle`, `spark`, `o` (named exports of `doodle-data.ts`). `weight` scales the pen (default fine 0.6; the wordmark uses 1). `stretch` fills a word's box exactly (underlining) | stroke draws on through a mask |
| `<InkReveal text as>` | paragraph whose words fill pale cobalt → cobalt → ink as you scroll | CSS scroll timeline |
| `<Wordmark draw>` | "opensrcer", the "o" a cobalt pen ring that doesn't quite close | ring draws on load |

Doodles are generated: edit the points in `scripts/gen-doodles.mjs` and run
`node scripts/gen-doodles.mjs`. Never edit `doodle-data.ts` by hand.

## Motion rules

1. **Finished first.** The server HTML is the final, readable state. Motion is
   layered on only under `prefers-reduced-motion: no-preference`, and never
   starts something invisible that needs JS to show it.
2. **Cheap properties.** transform and opacity; the two paint-only
   exceptions are `stroke-dashoffset` (doodles) and `color` (ink reveal).
   The curved marquee moves its words with `startOffset` (an SVG text
   attribute, no layout) and only runs while on screen.
3. **Scroll-driven = CSS scroll timelines** (`animation-timeline: view()`),
   inside `@supports`; browsers without them (Firefox today) get the static,
   finished state. No scroll listeners. They need the page (the viewport) to
   be the scroller: `body` uses `overflow-x: clip`, never `hidden`, or every
   timeline freezes at its end.
4. **One language.** Pops settle with `--ease-pop` in ~0.75s; arrivals use
   `--ease-arrive`. Stagger by 80–150ms, not more.

## Do / don't

Balance: pleasing AND readable. Our signature is the code map and the ring-"o",
not a studio-site pastiche.

- Do: sentence-case display headlines with generous whitespace, left-aligned;
  one cobalt word or thing per view; big type doing the work.
- Do: the code map (`<CodeMap>`) as the hero motif; hand-drawn marks only as
  quiet accents, fine pen (`weight` ≈ 0.5–0.6), at most one per section.
- Do: body text ≥ 17px on desktop and ≥ 16px on phones, lines ≤ 70ch, a clear
  heading → body → evidence hierarchy.
- Do: hairline borders (`.card` is a hairline sheet, no shadow); ruled lists
  rather than stacks of cards.
- Do: per view, one primary action (a 10px-radius rectangle, or the CtaPill on
  the landing hero), everything else a `.text-link`.
- Do: editorial contrast: a run-in heading (a bold display claim running into a
  quieter sans sentence at the same size), mono labels in a left rail, mono
  receipts and figure captions for real facts.
- Don't: all-caps `.shout` heroes, piles of tilted stickers, or a curved
  marquee band (that's another studio's signature). At most ONE small sticker
  in a view, tilt ≤ 2°. If a ticker earns a place, it's one still, quiet line.
- Don't: let any decoration overlap text you need to read (underline beneath
  words, never a circle over them).
- Don't: gradients, glass/blur panels, drop shadows on every block, emoji as
  section markers, centring everything, more than one CTA pill in view.
- Don't: put `paper` text on `signal`; don't use `signal-dim` for readable text.
- Don't: add a stroke-draw or reveal to body copy in the app; motifs belong to
  marketing surfaces (landing, header, footer, stage demo).
