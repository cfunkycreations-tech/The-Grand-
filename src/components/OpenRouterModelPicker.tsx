import { useEffect, useMemo, useRef, useState } from "react";
import {
  OpenRouterModel,
  getOpenRouterModels,
  searchModels,
  listProviders,
  providerOf,
  formatPricing,
  formatContext,
} from "../lib/openrouter-models";

export interface OpenRouterModelPickerProps {
  /** Currently selected model id, e.g. "anthropic/claude-sonnet-5". */
  value: string;
  /** Called with the model id when the user picks a model. */
  onChange: (modelId: string) => void;
  /** Optional placeholder for the search box. */
  placeholder?: string;
}

/**
 * Searchable model picker for app settings, backed by OpenRouter's live
 * model catalog. Shows every model OpenRouter offers (400+), searchable
 * by name/id and filterable by provider, with context size and pricing.
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
  const rootRef = useRef<HTMLDivElement>(null);

  const load = (force = false) => {
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
  };

  useEffect(() => {
    load();
  }, []);

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

  const visible = useMemo(() => {
    let list = provider === "all" ? models : models.filter((m) => providerOf(m) === provider);
    list = searchModels(list, query);
    return [...list].sort((a, b) => a.id.localeCompare(b.id));
  }, [models, provider, query]);

  const selected = models.find((m) => m.id === value);

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
        <div className="orp-panel">
          <div className="orp-controls">
            <input
              autoFocus
              type="search"
              className="orp-search"
              placeholder={placeholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
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
              </div>
              <ul className="orp-list" role="listbox" aria-label="OpenRouter models">
                {visible.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={m.id === value}
                      className={`orp-item${m.id === value ? " orp-item-selected" : ""}`}
                      onClick={() => {
                        onChange(m.id);
                        setOpen(false);
                      }}
                    >
                      <span className="orp-item-name">{m.name || m.id}</span>
                      <span className="orp-item-id">{m.id}</span>
                      <span className="orp-item-meta">
                        {[formatContext(m), formatPricing(m)].filter(Boolean).join(" · ")}
                      </span>
                    </button>
                  </li>
                ))}
                {visible.length === 0 && (
                  <li className="orp-status">No models match “{query}”.</li>
                )}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default OpenRouterModelPicker;
