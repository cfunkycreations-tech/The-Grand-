import {
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  OpenRouterModel,
  getOpenRouterModels,
  searchModels,
  listProviders,
  providerOf,
  formatPricing,
  formatContext,
  getFavorites,
  toggleFavorite as persistToggleFavorite,
  getRecents,
  pushRecent,
} from "../lib/openrouter-models";

export interface OpenRouterModelPickerProps {
  /** Currently selected model id, e.g. "anthropic/claude-sonnet-5". */
  value: string;
  /** Called with the model id when the user picks a model. */
  onChange: (modelId: string) => void;
  /** Optional placeholder for the search box. */
  placeholder?: string;
}

/** Fixed row height (px) — must match `.orp-row` height in the CSS. */
const ROW_HEIGHT = 60;
/** Viewport height of the scroll area (px) — must match `.orp-list` max-height. */
const LIST_HEIGHT = 340;
/** Extra rows rendered above/below the viewport to avoid blank flashes on scroll. */
const OVERSCAN = 6;

/** Priority bucket for sorting: favorites first, then recents, then the rest. */
function rank(id: string, favSet: Set<string>, recentSet: Set<string>): number {
  if (favSet.has(id)) return 0;
  if (recentSet.has(id)) return 1;
  return 2;
}

/**
 * Searchable model picker for app settings, backed by OpenRouter's live
 * model catalog. Shows every model OpenRouter offers (400+), searchable by
 * name/id and filterable by provider, with context size and pricing.
 *
 * Features: full keyboard navigation, favorites (★) and recents that float to
 * the top, and windowed virtualization so the 400+ row list stays smooth.
 */
export function OpenRouterModelPicker({
  value,
  onChange,
  placeholder = "Search 400+ models…",
}: OpenRouterModelPickerProps) {
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string>("");
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback((force = false) => {
    setStatus("loading");
    setError("");
    getOpenRouterModels(force)
      .then((list) => {
        setModels(list);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      });
  }, []);

  useEffect(() => {
    load();
    setFavorites(getFavorites());
    setRecents(getRecents());
  }, [load]);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const providers = useMemo(() => listProviders(models), [models]);
  const favSet = useMemo(() => new Set(favorites), [favorites]);
  const recentSet = useMemo(() => new Set(recents), [recents]);

  const visible = useMemo(() => {
    let list = provider === "all" ? models : models.filter((m) => providerOf(m) === provider);
    list = searchModels(list, query);
    return [...list].sort((a, b) => {
      const r = rank(a.id, favSet, recentSet) - rank(b.id, favSet, recentSet);
      return r !== 0 ? r : a.id.localeCompare(b.id);
    });
  }, [models, provider, query, favSet, recentSet]);

  const selected = models.find((m) => m.id === value);

  // Reset the active row whenever the filtered list changes shape.
  useEffect(() => {
    setActiveIndex(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [query, provider]);

  // On open, jump to the currently selected model and focus search.
  useEffect(() => {
    if (!open || status !== "ready") return;
    const idx = visible.findIndex((m) => m.id === value);
    setActiveIndex(idx >= 0 ? idx : 0);
    searchRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, status]);

  // Keep the active row scrolled into view (works with virtualization).
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const top = activeIndex * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    const view = el.clientHeight || LIST_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + view) el.scrollTop = bottom - view;
  }, [activeIndex]);

  const commit = useCallback(
    (id: string) => {
      onChange(id);
      setRecents(pushRecent(id));
      setOpen(false);
    },
    [onChange]
  );

  const toggleFav = useCallback((id: string) => {
    setFavorites(persistToggleFavorite(id));
  }, []);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((i) => Math.min(visible.length - 1, i + 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((i) => Math.max(0, i - 1));
          break;
        case "Home":
          e.preventDefault();
          setActiveIndex(0);
          break;
        case "End":
          e.preventDefault();
          setActiveIndex(visible.length - 1);
          break;
        case "Enter": {
          e.preventDefault();
          const m = visible[activeIndex];
          if (m) commit(m.id);
          break;
        }
        case "Escape":
          e.preventDefault();
          setOpen(false);
          break;
      }
    },
    [visible, activeIndex, commit]
  );

  // Virtualization window: only render rows near the viewport.
  const total = visible.length;
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(
    total,
    Math.ceil((scrollTop + LIST_HEIGHT) / ROW_HEIGHT) + OVERSCAN
  );
  const windowRows = visible.slice(start, end);

  return (
    <div className="orp-root" ref={rootRef}>
      <button
        type="button"
        className="orp-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="orp-trigger-label">
          {selected ? selected.name || selected.id : value || "Choose a model"}
        </span>
        <span className="orp-trigger-caret" aria-hidden>▾</span>
      </button>

      {open && (
        <div className="orp-panel" onKeyDown={onKeyDown}>
          <div className="orp-controls">
            <input
              ref={searchRef}
              autoFocus
              type="search"
              className="orp-search"
              placeholder={placeholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              role="combobox"
              aria-expanded
              aria-controls="orp-listbox"
              aria-activedescendant={
                visible[activeIndex] ? `orp-opt-${visible[activeIndex].id}` : undefined
              }
            />
            <select
              className="orp-provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              aria-label="Filter by provider"
            >
              <option value="all">All providers</option>
              {providers.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <button
              type="button"
              className="orp-refresh"
              onClick={() => load(true)}
              title="Refresh model list from OpenRouter"
              aria-label="Refresh model list"
            >
              ↻
            </button>
          </div>

          {status === "loading" && (
            <div className="orp-status">Loading models from OpenRouter…</div>
          )}
          {status === "error" && (
            <div className="orp-status orp-error">
              Couldn’t load models: {error}{" "}
              <button type="button" onClick={() => load(true)}>Retry</button>
            </div>
          )}

          {status === "ready" && (
            <>
              <div className="orp-count">
                {visible.length} of {models.length} models
                {favorites.length > 0 && ` · ${favorites.length} ★`}
              </div>
              <div
                id="orp-listbox"
                className="orp-list"
                role="listbox"
                aria-label="OpenRouter models"
                ref={listRef}
                style={{ height: LIST_HEIGHT }}
                onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
              >
                <div className="orp-list-inner" style={{ height: total * ROW_HEIGHT }}>
                  {windowRows.map((m, i) => {
                    const index = start + i;
                    const isSel = m.id === value;
                    const isActive = index === activeIndex;
                    const fav = favSet.has(m.id);
                    const recent = !fav && recentSet.has(m.id);
                    return (
                      <div
                        key={m.id}
                        className="orp-row"
                        style={{ top: index * ROW_HEIGHT }}
                      >
                        <div
                          id={`orp-opt-${m.id}`}
                          role="option"
                          aria-selected={isSel}
                          className={
                            "orp-item" +
                            (isSel ? " orp-item-selected" : "") +
                            (isActive ? " orp-item-active" : "")
                          }
                          onClick={() => commit(m.id)}
                          onMouseEnter={() => setActiveIndex(index)}
                        >
                          <span className="orp-item-name">
                            {m.name || m.id}
                            {recent && <span className="orp-badge">recent</span>}
                          </span>
                          <span className="orp-item-id">{m.id}</span>
                          <span className="orp-item-meta">
                            {[formatContext(m), formatPricing(m)].filter(Boolean).join(" · ")}
                          </span>
                        </div>
                        <button
                          type="button"
                          className={"orp-star" + (fav ? " orp-star-on" : "")}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFav(m.id);
                          }}
                          title={fav ? "Remove from favorites" : "Add to favorites"}
                          aria-label={fav ? "Remove from favorites" : "Add to favorites"}
                          aria-pressed={fav}
                        >
                          {fav ? "★" : "☆"}
                        </button>
                      </div>
                    );
                  })}
                </div>
                {total === 0 && (
                  <div className="orp-status">No models match “{query}”.</div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default OpenRouterModelPicker;
