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
| `src/lib/openrouter-models.ts` | Fetch + cache the live catalog; search, provider, pricing, and context-length helpers. Framework-agnostic (works in React, Vue, plain JS, React Native*). |
| `src/components/OpenRouterModelPicker.tsx` | Ready-made React settings control: searchable dropdown, provider filter, pricing + context badges, refresh button, loading/error states. |
| `src/components/openrouter-model-picker.css` | Neutral default styles — swap for your design system. |

\* On React Native, replace the `localStorage` calls with AsyncStorage; the
in-memory cache works as-is.

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
