export interface RuntimeConfig {
  maptilerKey: string;
}

let config: RuntimeConfig = { maptilerKey: '' };

/** Loads optional `config/runtime.json` (gitignored). Missing/invalid file ⇒ free map providers. */
export async function loadRuntimeConfig(): Promise<void> {
  try {
    const res = await fetch('config/runtime.json', { cache: 'no-store' });
    if (!res.ok) return;
    const text = await res.text();
    if (!text.trim().startsWith('{')) return; // SPA fallback returned index.html
    const json = JSON.parse(text) as Partial<RuntimeConfig>;
    config = { maptilerKey: (json.maptilerKey ?? '').trim() };
  } catch {
    // keep defaults
  }
}

export function runtimeConfig(): RuntimeConfig {
  return config;
}
