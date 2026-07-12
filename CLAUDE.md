# CLAUDE.md

Operating manual for AI assistants (and humans) working in this repo. Read it
before you touch code — it encodes the design decisions that are easy to break
and hard to notice.

---

## TL;DR

- **What:** a drop-in OpenRouter model picker. Replaces a stale hardcoded model
  list with OpenRouter's **live catalog (400+ models)**, fetched at runtime and
  cached for an hour.
- **Shape:** a *library*, not an app. Three files under `src/`. No
  `package.json`, no build, no tests, no lockfile.
- **Prime directive:** never reintroduce a hardcoded model array. The whole repo
  exists to kill that pattern.
- **You can't run it here.** Correctness comes from careful reading, not
  `npm test`. There is no toolchain in-repo to invoke.

---

## Architecture at a glance

```
                 OpenRouter public API
      GET https://openrouter.ai/api/v1/models   (no auth, no SDK)
                          │
                          ▼
   ┌──────────────────────────────────────────────┐
   │  src/lib/openrouter-models.ts   (data layer)  │
   │                                               │
   │  getOpenRouterModels()                        │
   │    ├─ memory cache (memoryCache) ─┐  fresh?    │
   │    ├─ localStorage (CACHE_KEY)  ──┤─ 1h TTL    │
   │    ├─ live fetch (deduped via inflight)        │
   │    └─ network fails → serve STALE, don't throw │
   │                                               │
   │  pure helpers: searchModels, providerOf,      │
   │  listProviders, formatPricing, formatContext  │
   └──────────────────────────────────────────────┘
                          │  (imports helpers only)
                          ▼
   ┌──────────────────────────────────────────────┐
   │  src/components/OpenRouterModelPicker.tsx     │
   │  React control: search box · provider filter  │
   │  · pricing/context badges · ↻ refresh         │
   │  · loading / error / empty states             │
   └──────────────────────────────────────────────┘
                          │
                          ▼
   src/components/openrouter-model-picker.css  (orp- prefix, theme-neutral)
```

**The layering is the whole design.** The data layer knows nothing about React
or the DOM; the component knows nothing about fetching or caching. Keep that
wall intact — it's what lets the data layer run in Vue, plain JS, or React
Native (swap `localStorage` for AsyncStorage) untouched.

---

## File map

| File | Role | Depends on |
| --- | --- | --- |
| `src/lib/openrouter-models.ts` | Fetch + cache + pure helpers. Framework-agnostic. | browser `fetch`/`localStorage` (accessed defensively) |
| `src/components/OpenRouterModelPicker.tsx` | React settings control. | `react`, the data layer helpers |
| `src/components/openrouter-model-picker.css` | Neutral default styling. | nothing |
| `README.md` | User-facing usage + wiring examples. | — |

---

## Data layer API (`openrouter-models.ts`)

| Export | Kind | Notes |
| --- | --- | --- |
| `OpenRouterModel` | type | Upstream model shape. **Treat almost every field as optional** — the API varies per model/provider. |
| `getOpenRouterModels(forceRefresh?)` | async | The one entry point. Memory → localStorage → live fetch. Dedupes concurrent callers via `inflight`. On failure returns the last good list. |
| `searchModels(models, query)` | pure | Multi-term, case-insensitive AND-match over `id` + `name` + `description`. |
| `providerOf(model)` | pure | Slug before the `/` in the id (`anthropic/claude-sonnet-5` → `anthropic`), else `"other"`. |
| `listProviders(models)` | pure | Unique provider slugs, sorted. |
| `formatPricing(model)` | pure | Per-million-token string, e.g. `$3.00/M in · $15.00/M out`; `"free"` when zero. |
| `formatContext(model)` | pure | Compact context size, e.g. `200K ctx`, `1M ctx`. |
| `getFavorites()` / `isFavorite(id, favs?)` | storage | Read favorited ids (most-recent first). |
| `toggleFavorite(id)` | storage | Add/remove a favorite; persists and returns the new list. |
| `getRecents()` / `pushRecent(id)` | storage | Read / record recently-selected ids (deduped, capped at `MAX_RECENTS`). |

Favorites and recents are plain ordered `string[]`s in `localStorage`
(`FAVORITES_KEY` / `RECENTS_KEY`, both `-v1`-suffixed). They live in the data
layer on purpose — any UI, or none, can read them. Access is defensive: a
non-browser runtime or disabled storage yields an empty list, never a throw.

### Caching model (know this cold)

- **Two tiers:** in-memory `memoryCache` (survives within a session) + persistent
  `localStorage` under `CACHE_KEY`. TTL is `CACHE_TTL_MS` = 1 hour.
- **Freshness gate:** `isFresh()` — serve cache only if younger than the TTL.
- **In-flight dedupe:** the `inflight` promise means ten simultaneous callers
  trigger **one** network request. Don't remove this.
- **Graceful degradation:** if the fetch throws and any cache exists (even
  stale), `getOpenRouterModels` returns it instead of throwing. The picker must
  keep working offline. This is a feature, not an accident.
- **Cache versioning:** `CACHE_KEY` ends in `-v1`. If you change the cached
  shape, **bump the suffix** so stale-shaped data is invalidated, not misread.

---

## Row-height contract (don't break silently)

The virtualized list only works if three numbers agree:

| Concept | Component | CSS |
| --- | --- | --- |
| Row height | `ROW_HEIGHT = 60` | `--orp-row-height: 60px` |
| Viewport height | `LIST_HEIGHT = 340` | `--orp-list-height: 340px` |

If you change a row's height, change **both** sides or rows will overlap / gaps
appear and keyboard scroll-into-view will miss. There's no runtime that will
catch this for you — it's a manual invariant.

## The component (`OpenRouterModelPicker.tsx`)

- Self-contained, controlled: `value` (selected model id) in, `onChange(id)` out.
  Optional `placeholder`.
- Calls **only** the exported helpers — it never fetches or caches directly.
- State machine: `loading` → `ready` | `error`, with a retry path and a `↻`
  button that calls `getOpenRouterModels(true)` (force refresh).
- **Keyboard nav:** `↑`/`↓`/`Home`/`End` move `activeIndex`, `Enter` commits,
  `Esc` closes. A `useLayoutEffect` scrolls the active row into view — this has
  to cooperate with virtualization, so it drives `listRef.scrollTop` directly
  rather than relying on `scrollIntoView` on an unrendered node.
- **Favorites/recents** float to the top via the `rank()` sort (fav → recent →
  rest, then alpha). Selecting a model calls `pushRecent`; the ★ button calls
  `toggleFavorite` and **stops propagation** so it doesn't also select the row.
- **Virtualization:** rows are absolutely positioned inside a fixed-height
  scroll container. `ROW_HEIGHT` (60) and `LIST_HEIGHT` (340) are constants that
  **must stay in sync with the CSS** (`--orp-row-height` / `--orp-list-height`);
  the window math and the scroll-into-view math both depend on them. Only
  `[start, end)` rows render, with `OVERSCAN` padding.
- Accessibility: `role="listbox"`/`option`, `role="combobox"` search input with
  `aria-activedescendant`, `aria-selected`, `aria-pressed` on the star,
  click-outside to close. Preserve it if you edit the markup.
- Only runtime dep is `react` hooks. Don't pull in a UI kit or a virtualization
  library — the windowing is intentionally hand-rolled and dependency-free.

---

## Conventions

- **TypeScript + React, ES modules.** 2-space indent, double quotes, named
  exports (component also default-exports). Match the surrounding style exactly.
- **Keep the data layer framework-agnostic.** No React, no DOM-only globals in
  `openrouter-models.ts`. Reach for browser globals defensively:
  `globalThis.localStorage?.…`, so non-browser runtimes don't crash.
- **CSS: `orp-` prefix, theme-neutral.** Use system color keywords
  (`Canvas`/`CanvasText`) so the host app's theme flows through. New classes
  follow the prefix.
- **Never hardcode a model list.** See prime directive. If a "quick fix" adds a
  static array of model names, it's wrong by construction.
- **Don't break the three invariants** when editing `getOpenRouterModels`:
  in-flight dedupe, stale-cache fallback, and the freshness/TTL gate.

---

## Verifying changes (no in-repo runner)

There's nothing to `build` or `test` here. To actually validate:

1. Drop the files into a React app with network access to
   `https://openrouter.ai/api/v1/models`.
2. Render `<OpenRouterModelPicker value={…} onChange={…} />` (see `README.md`).
3. Confirm the loop end to end:
   - list populates on open;
   - typing narrows results (multi-word works);
   - the provider dropdown filters;
   - `↻` forces a fresh fetch;
   - `↑`/`↓`/`Enter`/`Esc` navigate and select by keyboard, and the active row
     stays in view while scrolling through all 400+;
   - starring a model pins it to the top and survives a reload; selecting one
     makes it show up under recents next time;
   - **kill the network and reopen** — the cached list still renders (this is
     the test people forget).

When you only touch the pure helpers, reason through inputs/outputs directly —
they have no side effects, so a paper trace is a valid check.

---

## Git workflow

- **Active branch for this work:** `claude/claude-md-docs-yeb1yf`.
- **Repo default branch:** `claude/openrouter-model-picker-sync-x3v919` (the
  feature branch this stacks on) — PRs target it.
- Clear commit messages. Push with `git push -u origin <branch>`. Open a **draft**
  PR for the branch if one isn't already open. **Never** push to another branch
  without explicit permission.
