import { Map as MlMap, setWorkerUrl, type ErrorEvent as MlErrorEvent } from 'maplibre-gl';
import { MapLibreOverlay } from '@deck.gl/maplibre';
import type { Layer } from '@deck.gl/core';
import { ViewSpec } from '../core/domain/scenario';
import { registerDemProtocol } from './style/dem-protocol';
import { buildStyle, MapProvider, StyleOptions } from './style/style-builder';

let workerConfigured = false;

export interface MapEngineHooks {
  onProviderChange(provider: MapProvider, reason: string): void;
  onClick(info: { object?: unknown; layer?: { id: string } | null }, ev: { srcEvent?: MouseEvent }): void;
  onHover(info: { object?: unknown; layer?: { id: string } | null }): void;
}

/**
 * MapLibre (basemap, camera, terrain, labels, buildings) + deck.gl interleaved overlay
 * (all operational graphics). Provider fallback: MapTiler → OpenFreeMap → offline.
 */
export class MapEngine {
  readonly map: MlMap;
  readonly overlay: MapLibreOverlay;
  private opts: StyleOptions;
  private providerErrors = 0;
  private errorWindowStart = 0;

  constructor(
    container: HTMLElement,
    view: ViewSpec,
    opts: StyleOptions,
    private readonly hooks: MapEngineHooks,
  ) {
    if (!workerConfigured) {
      setWorkerUrl(new URL('maplibre-gl-worker.mjs', document.baseURI).href);
      registerDemProtocol();
      workerConfigured = true;
    }
    this.opts = opts;
    this.map = new MlMap({
      container,
      style: buildStyle(opts),
      center: view.center,
      zoom: view.zoom,
      pitch: view.pitch,
      bearing: view.bearing,
      maxPitch: 85,
      canvasContextAttributes: { antialias: true },
      attributionControl: { compact: true },
      fadeDuration: 150,
      dragRotate: true,
      pitchWithRotate: true,
    });
    this.map.on('error', (e: MlErrorEvent) => this.handleError(e));
    (globalThis as unknown as { __suuarmMap?: MlMap }).__suuarmMap = this.map;

    this.overlay = new MapLibreOverlay({
      interleaved: true,
      layers: [],
      pickingRadius: 6,
      onClick: (info, ev) => this.hooks.onClick(info as never, ev as never),
      onHover: (info) => this.hooks.onHover(info as never),
      getCursor: ({ isHovering, isDragging }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'),
    });
    this.map.addControl(this.overlay);
  }

  get provider(): MapProvider {
    return this.opts.provider;
  }

  setLayers(layers: Layer[]): void {
    this.overlay.setProps({ layers });
  }

  updateStyle(patch: Partial<StyleOptions>): void {
    const next = { ...this.opts, ...patch };
    const changed = (Object.keys(patch) as (keyof StyleOptions)[]).some((k) => this.opts[k] !== next[k]);
    if (!changed) return;
    this.opts = next;
    this.map.setStyle(buildStyle(next));
  }

  private handleError(e: MlErrorEvent): void {
    const err = e.error as (Error & { status?: number; url?: string }) | undefined;
    console.warn('[map]', err?.message ?? e);
    const status = err?.status ?? 0;
    const url = err?.url ?? '';
    if (this.opts.provider === 'MAPTILER' && (status === 401 || status === 403) && (!url || url.includes('maptiler'))) {
      this.switchProvider('OPENFREEMAP', `MapTiler rejected request (${status || 'error'})`);
      return;
    }
    if (this.opts.provider === 'OFFLINE') return;
    const now = performance.now();
    if (now - this.errorWindowStart > 15000) {
      this.errorWindowStart = now;
      this.providerErrors = 0;
    }
    this.providerErrors++;
    if (this.providerErrors > 30 && !this.map.areTilesLoaded()) {
      const nextProvider: MapProvider = this.opts.provider === 'MAPTILER' ? 'OPENFREEMAP' : 'OFFLINE';
      this.switchProvider(nextProvider, 'Tile service unreachable');
    }
  }

  private switchProvider(p: MapProvider, reason: string): void {
    if (this.opts.provider === p) return;
    this.providerErrors = 0;
    this.updateStyle({ provider: p });
    this.hooks.onProviderChange(p, reason);
  }

  destroy(): void {
    this.overlay.finalize();
    this.map.remove();
  }
}
