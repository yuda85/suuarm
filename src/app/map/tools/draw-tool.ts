import type { Layer } from '@deck.gl/core';
import { PathLayer, ScatterplotLayer, SolidPolygonLayer } from '@deck.gl/layers';
import type { Map as MlMap, MapMouseEvent } from 'maplibre-gl';
import { Vec2 } from '../../core/domain/geometry';
import { LocalFrame } from '../../core/world/geo';

export type DrawKind = 'polygon' | 'line' | 'circle' | 'point';

export interface DrawSession {
  kind: DrawKind;
  points: Vec2[];
  cursor: Vec2 | null;
  resolve: (pts: Vec2[] | null) => void;
}

/**
 * Minimal map drawing state machine (click to add, double-click / Enter to finish, Esc cancels).
 * Used by the mission builder for operator-defined areas; reused by map tools.
 */
export class DrawTool {
  session: DrawSession | null = null;
  onChange: () => void = () => {};

  constructor(
    private readonly map: MlMap,
    private readonly geo: LocalFrame,
  ) {
    map.on('click', this.onClick);
    map.on('mousemove', this.onMove);
    map.on('dblclick', this.onDbl);
    window.addEventListener('keydown', this.onKey);
  }

  destroy(): void {
    this.map.off('click', this.onClick);
    this.map.off('mousemove', this.onMove);
    this.map.off('dblclick', this.onDbl);
    window.removeEventListener('keydown', this.onKey);
  }

  get active(): boolean {
    return this.session !== null;
  }

  start(kind: DrawKind): Promise<Vec2[] | null> {
    this.cancel();
    return new Promise((resolve) => {
      this.session = { kind, points: [], cursor: null, resolve };
      this.map.doubleClickZoom.disable();
      this.map.getCanvas().style.cursor = 'crosshair';
      this.onChange();
    });
  }

  cancel(): void {
    if (!this.session) return;
    const s = this.session;
    this.end();
    s.resolve(null);
  }

  finish(): void {
    const s = this.session;
    if (!s) return;
    const need = s.kind === 'polygon' ? 3 : s.kind === 'point' ? 1 : 2;
    if (s.points.length < need) return;
    this.end();
    s.resolve(s.points);
  }

  private end(): void {
    this.session = null;
    this.map.doubleClickZoom.enable();
    this.map.getCanvas().style.cursor = '';
    this.onChange();
  }

  private local(e: MapMouseEvent): Vec2 {
    return this.geo.fromLngLat(e.lngLat.lng, e.lngLat.lat);
  }

  private onClick = (e: MapMouseEvent): void => {
    const s = this.session;
    if (!s) return;
    const p = this.local(e);
    const last = s.points[s.points.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < 1) return; // dblclick second click
    s.points.push(p);
    if (s.kind === 'point') return this.finish();
    if ((s.kind === 'circle' || s.kind === 'line') && s.points.length === 2 && s.kind === 'circle') return this.finish();
    this.onChange();
  };

  private onMove = (e: MapMouseEvent): void => {
    if (!this.session) return;
    this.session.cursor = this.local(e);
  };

  private onDbl = (e: MapMouseEvent): void => {
    if (!this.session) return;
    e.preventDefault();
    this.finish();
  };

  private onKey = (e: KeyboardEvent): void => {
    if (!this.session) return;
    if (e.key === 'Escape') this.cancel();
    else if (e.key === 'Enter') this.finish();
    else if (e.key === 'Backspace') {
      this.session.points.pop();
      this.onChange();
    }
  };

  /** Preview layers for the in-progress geometry. */
  layers(toWorld: (p: Vec2) => [number, number, number]): Layer[] {
    const s = this.session;
    if (!s) return [];
    const pts = s.points.map(toWorld);
    const live = s.cursor ? [...pts, toWorld(s.cursor)] : pts;
    let ring = s.kind === 'polygon' && live.length >= 3 ? [...live, live[0]] : live;
    if (s.kind === 'circle' && s.points.length === 1 && s.cursor) {
      const c = s.points[0];
      const r = Math.hypot(s.cursor.x - c.x, s.cursor.y - c.y);
      ring = Array.from({ length: 49 }, (_, i) => {
        const a = (i / 48) * Math.PI * 2;
        return toWorld({ x: c.x + Math.sin(a) * r, y: c.y + Math.cos(a) * r });
      });
      ring.push(...[toWorld(c), toWorld(s.cursor)]);
    }
    return [
      new SolidPolygonLayer<[number, number, number][]>({
        id: 'draw-fill',
        data: s.kind === 'polygon' && live.length >= 3 ? [live] : [],
        getPolygon: (d) => d,
        getFillColor: [61, 139, 255, 40],
        parameters: { depthCompare: 'always' },
      }),
      new PathLayer<[number, number, number][]>({
        id: 'draw-path',
        data: [ring],
        getPath: (d) => d,
        getColor: [99, 162, 255, 255],
        getWidth: 2,
        widthUnits: 'pixels',
        parameters: { depthCompare: 'always' },
      }),
      new ScatterplotLayer<[number, number, number]>({
        id: 'draw-vertices',
        data: pts,
        getPosition: (d) => d,
        getRadius: 4,
        radiusUnits: 'pixels',
        getFillColor: [232, 237, 243, 255],
        stroked: true,
        getLineColor: [61, 139, 255, 255],
        getLineWidth: 2,
        lineWidthUnits: 'pixels',
        parameters: { depthCompare: 'always' },
      }),
    ];
  }
}
