# The Grand — website + OpenRouter model picker

## The website (`index.html`)

`index.html` is a **complete, self-contained website** — no build, no install.
Double-click it to open in any browser, or host it anywhere static.

It has three things:

1. **Live model explorer** — fetches *every* model OpenRouter offers in real
   time, with search, provider filter, favorites (★, saved locally), and
   pricing/context badges. Open it in a real browser to see the full live list.
2. **HTML5 album player** — press play, drag-and-drop audio in, or preload your
   tracks. To ship your album with the site, drop the files in an `audio/`
   folder next to `index.html` and list them in the `ALBUM_TRACKS` array near
   the bottom of the file (there's a commented example).
3. **Contact / mailing list** — change `you@yourdomain.com` in the file to your
   address; the signup opens the visitor's mail client (no backend needed).

### Put it online (a public URL tonight)

Any static host works — the file is fully self-contained:

- **GitHub Pages:** repo → Settings → Pages → deploy from this branch (root).
- **Netlify / Vercel / Cloudflare Pages:** drag the folder in, or point it at
  this repo. Done.

---

# OpenRouter model picker — always in sync

This branch contains a drop-in fix for the settings model picker so it always
shows **every model OpenRouter currently offers** (400+), instead of a stale
hardcoded list.

## Why models were missing

Model pickers go stale when the app ships with a hardcoded array of model
names. OpenRouter adds models constantly, so anything not in that array never
shows up — even though it works fine on openrouter.ai.

## The fix (no SDK needed)

You do **not** need to install an SDK to stay current. OpenRouter publishes
its full live catalog at a public, no-auth endpoint:

```
GET https://openrouter.ai/api/v1/models
```

This code fetches that endpoint at runtime, caches it for an hour
(memory + localStorage), and falls back to the cached copy if the network is
down. Every time a user opens settings, the list is at most an hour old — and
the ↻ button refreshes it on demand.

## What's here

| File | Purpose |
| --- | --- |
| `src/lib/openrouter-models.ts` | Fetch + cache the live catalog; search, provider, pricing, context-length, plus favorites + recents helpers. Framework-agnostic (works in React, Vue, plain JS, React Native*). |
| `src/components/OpenRouterModelPicker.tsx` | Ready-made React settings control: searchable dropdown, provider filter, pricing + context badges, refresh button, loading/error states, keyboard nav, favorites, recents, and a virtualized list. |
| `src/components/openrouter-model-picker.css` | Themeable default styles driven by `--orp-*` design tokens. |

\* On React Native, replace the `localStorage` calls with AsyncStorage; the
in-memory cache works as-is.

## What the picker does

- **Searchable + provider filter.** Multi-word, case-insensitive search over id,
  name, and description; filter to a single provider.
- **Full keyboard navigation.** `↑`/`↓` to move, `Home`/`End` to jump, `Enter`
  to select, `Esc` to close. The active row auto-scrolls into view.
- **Favorites (★) and recents.** Star any model to pin it to the top; recently
  selected models float up too. Both persist in `localStorage`.
- **Virtualized list.** Only the visible rows render, so all 400+ models scroll
  smoothly with no framework or list library.
- **Graceful offline.** If OpenRouter is unreachable, the last cached list is
  served instead of breaking.

## Theming

Every color, radius, and size is a `--orp-*` custom property on `.orp-root`.
Override any of them — on `:root`, a wrapper, or the element itself — to reskin
the picker without editing selectors:

```css
.orp-root {
  --orp-accent: #7c3aed;   /* selection + focus ring */
  --orp-radius: 12px;
  --orp-star: #f59e0b;
}
```

Sensible light **and** dark defaults ship in the CSS (via
`prefers-color-scheme`), using system `Canvas`/`CanvasText` colors so the picker
inherits your app's surface by default.

## Wiring it into your settings screen

```tsx
import { OpenRouterModelPicker } from "./components/OpenRouterModelPicker";
import "./components/openrouter-model-picker.css";

function SettingsModelSection() {
  const [model, setModel] = useSetting("openrouter.model"); // your settings store

  return (
    <OpenRouterModelPicker
      value={model}
      onChange={setModel}
    />
  );
}
```

If you'd rather keep your existing picker UI, call the data layer directly:

```ts
import { getOpenRouterModels, searchModels } from "./lib/openrouter-models";

const models = await getOpenRouterModels();       // full live list, cached 1h
const claude = searchModels(models, "claude");    // simple search helper
```

## Keeping it current forever

Nothing to maintain: the list comes from OpenRouter itself on every cache
expiry. New models appear automatically within an hour of OpenRouter listing
them (or instantly via the refresh button). If OpenRouter is unreachable, the
picker serves the last good list instead of breaking.
