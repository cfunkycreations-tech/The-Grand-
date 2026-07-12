/**
 * Live OpenRouter model catalog.
 *
 * Fetches the full model list (400+) straight from OpenRouter's public API,
 * so the picker is always in sync with what OpenRouter actually offers.
 * No SDK and no API key are required for this endpoint.
 *
 * Results are cached in memory and in localStorage (1 hour TTL) so the
 * settings screen opens instantly after the first load.
 */

export interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  context_length?: number;
  created?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
    image?: string;
    request?: string;
  };
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
    tokenizer?: string;
  };
  top_provider?: {
    context_length?: number;
    max_completion_tokens?: number;
    is_moderated?: boolean;
  };
}

const MODELS_URL = "https://openrouter.ai/api/v1/models";
const CACHE_KEY = "openrouter-models-cache-v1";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const FAVORITES_KEY = "openrouter-favorites-v1";
const RECENTS_KEY = "openrouter-recents-v1";
const MAX_RECENTS = 8;

interface CacheEntry {
  fetchedAt: number;
  models: OpenRouterModel[];
}

let memoryCache: CacheEntry | null = null;
let inflight: Promise<OpenRouterModel[]> | null = null;

function readLocalStorage(): CacheEntry | null {
  try {
    const raw = globalThis.localStorage?.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!Array.isArray(parsed.models) || typeof parsed.fetchedAt !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeLocalStorage(entry: CacheEntry): void {
  try {
    globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Storage full or unavailable — memory cache still works.
  }
}

function isFresh(entry: CacheEntry | null): entry is CacheEntry {
  return !!entry && Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

async function fetchFromApi(): Promise<OpenRouterModel[]> {
  const res = await fetch(MODELS_URL, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`OpenRouter models request failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { data?: OpenRouterModel[] };
  if (!Array.isArray(body.data)) {
    throw new Error("Unexpected response shape from OpenRouter /models");
  }
  return body.data;
}

/**
 * Get the full, current OpenRouter model list.
 *
 * - Serves from cache when fresh (memory first, then localStorage).
 * - Otherwise fetches live from OpenRouter and refreshes the cache.
 * - If the network fails but a stale cache exists, returns the stale list
 *   rather than throwing, so the picker degrades gracefully offline.
 *
 * @param forceRefresh bypass the cache and hit the API now
 */
export async function getOpenRouterModels(
  forceRefresh = false
): Promise<OpenRouterModel[]> {
  if (!forceRefresh) {
    if (isFresh(memoryCache)) return memoryCache.models;
    const stored = readLocalStorage();
    if (isFresh(stored)) {
      memoryCache = stored;
      return stored.models;
    }
  }

  if (!inflight) {
    inflight = fetchFromApi()
      .then((models) => {
        const entry: CacheEntry = { fetchedAt: Date.now(), models };
        memoryCache = entry;
        writeLocalStorage(entry);
        return models;
      })
      .catch((err) => {
        const stale = memoryCache ?? readLocalStorage();
        if (stale && stale.models.length > 0) return stale.models;
        throw err;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Case-insensitive search across model id, name, and description. */
export function searchModels(
  models: OpenRouterModel[],
  query: string
): OpenRouterModel[] {
  const q = query.trim().toLowerCase();
  if (!q) return models;
  const terms = q.split(/\s+/);
  return models.filter((m) => {
    const haystack = `${m.id} ${m.name ?? ""} ${m.description ?? ""}`.toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
}

/** Provider slug from a model id, e.g. "anthropic/claude-sonnet-5" → "anthropic". */
export function providerOf(model: OpenRouterModel): string {
  const slash = model.id.indexOf("/");
  return slash > 0 ? model.id.slice(0, slash) : "other";
}

/** Unique provider slugs, sorted alphabetically. */
export function listProviders(models: OpenRouterModel[]): string[] {
  return [...new Set(models.map(providerOf))].sort();
}

/** Human-readable price per million tokens, e.g. "$3.00/M in · $15.00/M out". */
export function formatPricing(model: OpenRouterModel): string {
  const perM = (v?: string) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    if (n === 0) return "free";
    return `$${(n * 1_000_000).toFixed(2)}/M`;
  };
  const input = perM(model.pricing?.prompt);
  const output = perM(model.pricing?.completion);
  if (input === "free" && output === "free") return "free";
  if (!input && !output) return "";
  return [input && `${input} in`, output && `${output} out`]
    .filter(Boolean)
    .join(" · ");
}

/** Compact context length, e.g. 200000 → "200K". */
export function formatContext(model: OpenRouterModel): string {
  const len = model.context_length ?? model.top_provider?.context_length;
  if (!len) return "";
  return len >= 1_000_000
    ? `${(len / 1_000_000).toFixed(len % 1_000_000 ? 1 : 0)}M ctx`
    : `${Math.round(len / 1000)}K ctx`;
}

/* ------------------------------------------------------------------ *
 * Favorites & recents
 *
 * Both are just ordered lists of model ids in localStorage. Kept in the
 * (framework-agnostic) data layer so any UI — or none — can read/write them.
 * All access is defensive so non-browser runtimes and disabled storage
 * degrade to empty lists instead of throwing.
 * ------------------------------------------------------------------ */

function readIdList(key: string): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeIdList(key: string, ids: string[]): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(ids));
  } catch {
    // Storage full or unavailable — non-fatal.
  }
}

/** Favorited model ids, most-recently-favorited first. */
export function getFavorites(): string[] {
  return readIdList(FAVORITES_KEY);
}

/** True if `id` is in the given favorites list (or in storage if omitted). */
export function isFavorite(id: string, favorites: string[] = getFavorites()): boolean {
  return favorites.includes(id);
}

/** Toggle a favorite, persist, and return the new list (new favorites go first). */
export function toggleFavorite(id: string): string[] {
  const current = getFavorites();
  const next = current.includes(id)
    ? current.filter((x) => x !== id)
    : [id, ...current];
  writeIdList(FAVORITES_KEY, next);
  return next;
}

/** Recently selected model ids, most-recent first (capped at MAX_RECENTS). */
export function getRecents(): string[] {
  return readIdList(RECENTS_KEY);
}

/** Record a model as just-used; move it to the front, dedupe, cap, persist. */
export function pushRecent(id: string): string[] {
  if (!id) return getRecents();
  const next = [id, ...getRecents().filter((x) => x !== id)].slice(0, MAX_RECENTS);
  writeIdList(RECENTS_KEY, next);
  return next;
}
