# CLAUDE.md

Guidance for AI assistants working in this repository.

## What this repo is

A small, **drop-in code library** (not a full application) that provides a
settings model picker backed by OpenRouter's live model catalog. The whole
point is to replace a stale, hardcoded list of model names with one that
fetches every model OpenRouter currently offers (400+) at runtime and caches
it for an hour.

There is **no build system, no `package.json`, no test suite, and no lockfile**
in this repo. The source files are meant to be copied into a consuming
React/TypeScript project that already has its own toolchain. Keep that in mind:
you cannot run, build, lint, or test in isolation here, so correctness comes
from careful reading rather than a local test run.

## Layout

```
README.md                                   Usage docs & wiring examples
src/
  lib/openrouter-models.ts                  Data layer: fetch + cache + helpers
  components/OpenRouterModelPicker.tsx       React UI control
  components/openrouter-model-picker.css     Neutral default styles
```

### `src/lib/openrouter-models.ts` — the data layer

Framework-agnostic. Works in React, Vue, plain JS, and React Native (with an
AsyncStorage swap for `localStorage`).

- `getOpenRouterModels(forceRefresh = false)` — the main entry point. Serves
  from memory cache, then `localStorage`, then a live fetch of
  `https://openrouter.ai/api/v1/models` (public, no API key). Dedupes
  concurrent calls via an `inflight` promise. On network failure it returns
  the last good (stale) list rather than throwing — graceful offline
  degradation is a deliberate design property; preserve it.
- Cache: memory (`memoryCache`) + `localStorage` under `CACHE_KEY`, 1-hour TTL
  (`CACHE_TTL_MS`). Bump the `-v1` suffix on `CACHE_KEY` if you change the
  cached shape, so old cached data is invalidated.
- Pure helpers: `searchModels` (multi-term, case-insensitive over id/name/
  description), `providerOf`, `listProviders`, `formatPricing` (per-million-
  token), `formatContext` (compact "200K ctx"). These have no side effects —
  keep them pure so they stay trivially usable outside React.

### `src/components/OpenRouterModelPicker.tsx` — the UI

A self-contained React control: searchable dropdown, provider filter, pricing
+ context badges, a ↻ refresh button, and loading/error/empty states. It calls
only the exported helpers from the data layer — it does not fetch or cache
directly. Uses `react` hooks (`useEffect`/`useMemo`/`useRef`/`useState`); no
other runtime dependencies.

### `src/components/openrouter-model-picker.css`

Theme-neutral styles under the `orp-` class prefix, using system color
keywords (`Canvas`/`CanvasText`) so they inherit the host app's look. Meant to
be overridden by the consuming design system.

## Conventions

- **TypeScript + React, ES modules.** Match the existing style: 2-space
  indent, double quotes, named exports (the component also has a default
  export). `OpenRouterModel` is the shared type; treat most of its fields as
  optional because the upstream API shape can vary.
- **Keep the data layer framework-agnostic.** Don't import React or DOM-only
  APIs into `openrouter-models.ts`. Access browser globals defensively
  (`globalThis.localStorage?.…`) so it doesn't crash in non-browser runtimes.
- **CSS class names use the `orp-` prefix.** Keep new classes consistent and
  keep colors theme-neutral.
- **Don't hardcode a model list.** The entire reason this repo exists is to
  stay in sync with OpenRouter automatically. Any change that reintroduces a
  static model array defeats the purpose.
- Preserve the offline/stale-cache fallback and the in-flight request dedupe
  when touching `getOpenRouterModels`.

## Verifying changes

There's nothing to run in-repo. To validate a change, drop the files into a
React app with the OpenRouter endpoint reachable, render `<OpenRouterModelPicker>`,
and confirm: the list populates, search + provider filter narrow it, ↻ forces a
refresh, and disabling the network still shows the cached list. When editing
only the pure helpers, reason through the inputs/outputs directly.

## Git workflow

- Active development branch for this work: **`claude/claude-md-docs-yeb1yf`**.
- The existing feature work lives on `claude/openrouter-model-picker-sync-x3v919`.
- Commit with clear messages, push with `git push -u origin <branch>`, and open
  a **draft** PR for the pushed branch if one isn't already open. Never push to
  another branch without explicit permission.
