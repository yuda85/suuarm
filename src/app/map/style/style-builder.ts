import type { LayerSpecification, SourceSpecification, StyleSpecification } from 'maplibre-gl';
import { DEM_PROTOCOL } from './dem-protocol';

export type MapProvider = 'MAPTILER' | 'OPENFREEMAP' | 'OFFLINE';
export type BasemapKind = 'VECTOR' | 'SATELLITE';

export interface StyleOptions {
  provider: MapProvider;
  basemap: BasemapKind;
  terrain: boolean;
  buildings: boolean;
  maptilerKey: string;
  /** Rendering for a sensor point of view: no labels, natural imagery, solid structures. */
  sensorView?: boolean;
  /** GeoJSON polygon (lng/lat) whose OSM buildings are hidden (synthetic campus sits there). */
  excludeArea?: GeoJSON.Polygon;
}

export const BUILDING_LAYER_ID = 'buildings-3d';
/** deck.gl layers are inserted before this id so labels stay on top. */
export const LABELS_ANCHOR_ID = 'labels-anchor';

const C = {
  land: '#0d1218',
  landAlt: '#0f151c',
  water: '#081624',
  waterLine: '#10263b',
  sand: '#121820',
  park: '#0f1a1c',
  industrial: '#10161e',
  aeroway: '#141b24',
  runway: '#1b232e',
  road0: '#2b3644',
  road1: '#232d39',
  road2: '#1c242e',
  road3: '#171e27',
  rail: '#1f2731',
  building2d: '#151c25',
  building3d: '#1d2734',
  boundary: '#2b3542',
  label: '#7e8a9a',
  labelStrong: '#a9b4c2',
  halo: '#07090d',
};

function sources(o: StyleOptions): Record<string, SourceSpecification> {
  const s: Record<string, SourceSpecification> = {};
  if (o.provider === 'MAPTILER') {
    s['omt'] = { type: 'vector', url: `https://api.maptiler.com/tiles/v3/tiles.json?key=${o.maptilerKey}` };
    s['sat'] = {
      type: 'raster',
      url: `https://api.maptiler.com/tiles/satellite-v2/tiles.json?key=${o.maptilerKey}`,
      tileSize: 256,
    };
    s['dem'] = {
      type: 'raster-dem',
      tiles: [`${DEM_PROTOCOL}://https://api.maptiler.com/tiles/terrain-rgb-v2/{z}/{x}/{y}.webp?key=${o.maptilerKey}`],
      tileSize: 512,
      maxzoom: 14,
      encoding: 'mapbox',
      attribution: '© MapTiler © OpenStreetMap contributors',
    };
    s['dem-hs'] = { ...s['dem'] };
  } else if (o.provider === 'OPENFREEMAP') {
    s['omt'] = { type: 'vector', url: 'https://tiles.openfreemap.org/planet' };
    s['sat'] = {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagery: Powered by Esri — Esri, Maxar, Earthstar Geographics',
    };
    s['dem'] = {
      type: 'raster-dem',
      tiles: [`${DEM_PROTOCOL}://https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`],
      tileSize: 256,
      maxzoom: 15,
      encoding: 'terrarium',
      attribution: 'Terrain: Mapzen / AWS Terrain Tiles',
    };
    const { attribution: _omit, ...hs } = s['dem'] as SourceSpecification & { attribution?: string };
    s['dem-hs'] = hs as SourceSpecification;
  }
  return s;
}

function glyphs(o: StyleOptions): string | undefined {
  if (o.provider === 'MAPTILER') return `https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=${o.maptilerKey}`;
  if (o.provider === 'OPENFREEMAP') return 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
  return undefined;
}

const FONT_REG = ['Noto Sans Regular'];
const FONT_BOLD = ['Noto Sans Bold'];

function vectorBase(sat: boolean): LayerSpecification[] {
  const fade = sat ? 0 : 1;
  const L: LayerSpecification[] = [];
  if (!sat) {
    L.push(
      {
        id: 'landcover',
        type: 'fill',
        source: 'omt',
        'source-layer': 'landcover',
        paint: {
          'fill-color': ['match', ['get', 'class'], ['sand', 'bare_rock'], C.sand, ['grass', 'wood', 'farmland', 'wetland'], C.park, C.landAlt],
          'fill-opacity': 0.9,
        },
      },
      {
        id: 'landuse',
        type: 'fill',
        source: 'omt',
        'source-layer': 'landuse',
        paint: {
          'fill-color': ['match', ['get', 'class'], ['industrial', 'commercial', 'retail', 'railway'], C.industrial, ['stadium', 'pitch', 'cemetery'], C.park, C.landAlt],
          'fill-opacity': 0.75,
        },
      },
      { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': C.park, 'fill-opacity': 0.9 } },
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': C.water } },
      {
        id: 'water-edge',
        type: 'line',
        source: 'omt',
        'source-layer': 'water',
        paint: { 'line-color': C.waterLine, 'line-width': 1 },
      },
      {
        id: 'aeroway-area',
        type: 'fill',
        source: 'omt',
        'source-layer': 'aeroway',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': C.aeroway, 'fill-opacity': 0.9 },
      },
      {
        id: 'aeroway-runway',
        type: 'line',
        source: 'omt',
        'source-layer': 'aeroway',
        filter: ['all', ['==', ['geometry-type'], 'LineString'], ['in', ['get', 'class'], ['literal', ['runway', 'taxiway']]]],
        paint: { 'line-color': C.runway, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 11, 2, 17, 50] },
      },
    );
  }
  const roadColor: unknown = [
    'match',
    ['get', 'class'],
    'motorway',
    sat ? 'rgba(255,255,255,0.32)' : C.road0,
    ['trunk', 'primary'],
    sat ? 'rgba(255,255,255,0.26)' : C.road1,
    ['secondary', 'tertiary'],
    sat ? 'rgba(255,255,255,0.18)' : C.road2,
    sat ? 'rgba(255,255,255,0.10)' : C.road3,
  ];
  const roadWidth: unknown = [
    'interpolate',
    ['exponential', 1.6],
    ['zoom'],
    10,
    ['match', ['get', 'class'], 'motorway', 1.4, ['trunk', 'primary'], 1, 0.4],
    18,
    ['match', ['get', 'class'], 'motorway', 26, ['trunk', 'primary'], 20, ['secondary', 'tertiary'], 14, 8],
  ];
  L.push(
    {
      id: 'roads',
      type: 'line',
      source: 'omt',
      'source-layer': 'transportation',
      filter: ['!', ['in', ['get', 'class'], ['literal', ['rail', 'transit', 'ferry', 'path', 'track']]]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': roadColor as never, 'line-width': roadWidth as never },
    },
    {
      id: 'rail',
      type: 'line',
      source: 'omt',
      'source-layer': 'transportation',
      filter: ['in', ['get', 'class'], ['literal', ['rail', 'transit']]],
      paint: { 'line-color': C.rail, 'line-width': 1, 'line-dasharray': [3, 2], 'line-opacity': fade },
    },
  );
  return L;
}

function buildingLayers(o: StyleOptions, sat: boolean): LayerSpecification[] {
  const exclude: unknown[] = o.excludeArea ? [['!', ['within', { type: 'Feature', geometry: o.excludeArea, properties: {} }]]] : [];
  const filter = ['all', ['!=', ['get', 'hide_3d'], true], ...exclude];
  if (!o.buildings) {
    return [
      {
        id: 'buildings-2d',
        type: 'fill',
        source: 'omt',
        'source-layer': 'building',
        filter: filter as never,
        paint: { 'fill-color': sat ? 'rgba(160,175,195,0.18)' : C.building2d },
      },
    ];
  }
  return [
    {
      id: BUILDING_LAYER_ID,
      type: 'fill-extrusion',
      source: 'omt',
      'source-layer': 'building',
      minzoom: 12,
      filter: filter as never,
      paint: {
        'fill-extrusion-color': o.sensorView
          ? '#aaa397'
          : sat
          ? '#9aa6b5'
          : ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 8], 0, '#18212c', 40, '#1e2936', 160, '#26334a'],
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': o.sensorView ? 1 : sat ? 0.55 : 0.92,
        'fill-extrusion-vertical-gradient': true,
      },
    },
  ];
}

function labelLayers(sat: boolean): LayerSpecification[] {
  const halo = sat ? 'rgba(0,0,0,0.85)' : C.halo;
  return [
    // Anchor marks where deck.gl draws (beneath labels).
    { id: LABELS_ANCHOR_ID, type: 'background', paint: { 'background-opacity': 0 } },
    {
      id: 'road-labels',
      type: 'symbol',
      source: 'omt',
      'source-layer': 'transportation_name',
      minzoom: 14,
      filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary']]],
      layout: {
        'symbol-placement': 'line',
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name']],
        'text-font': FONT_REG,
        'text-size': 10,
        'text-letter-spacing': 0.04,
      },
      paint: { 'text-color': sat ? '#c9d2dc' : C.label, 'text-halo-color': halo, 'text-halo-width': 1.2 },
    },
    {
      id: 'water-labels',
      type: 'symbol',
      source: 'omt',
      'source-layer': 'water_name',
      layout: {
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name']],
        'text-font': FONT_REG,
        'text-size': 11,
        'text-letter-spacing': 0.18,
        'text-transform': 'uppercase',
      },
      paint: { 'text-color': '#3f5d7a', 'text-halo-color': halo, 'text-halo-width': 1 },
    },
    {
      id: 'place-labels',
      type: 'symbol',
      source: 'omt',
      'source-layer': 'place',
      filter: ['in', ['get', 'class'], ['literal', ['city', 'town', 'suburb', 'neighbourhood', 'island', 'quarter']]],
      layout: {
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name']],
        'text-font': ['match', ['get', 'class'], 'city', ['literal', FONT_BOLD], ['literal', FONT_REG]] as never,
        'text-size': ['match', ['get', 'class'], 'city', 14, ['town', 'island'], 12, 10.5],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.12,
        'text-max-width': 9,
      },
      paint: { 'text-color': sat ? '#e1e7ee' : C.labelStrong, 'text-halo-color': halo, 'text-halo-width': 1.4, 'text-opacity': 0.9 },
    },
  ];
}

export function buildStyle(o: StyleOptions): StyleSpecification {
  const sat = o.basemap === 'SATELLITE' && o.provider !== 'OFFLINE';
  const layers: LayerSpecification[] = [
    { id: 'background', type: 'background', paint: { 'background-color': sat ? '#05070a' : C.land } },
  ];

  if (o.provider !== 'OFFLINE') {
    if (sat) {
      layers.push({
        id: 'satellite',
        type: 'raster',
        source: 'sat',
        paint: o.sensorView
          ? { 'raster-saturation': -0.08, 'raster-brightness-max': 0.97, 'raster-contrast': 0.05, 'raster-fade-duration': 0 }
          : { 'raster-saturation': -0.45, 'raster-brightness-max': 0.78, 'raster-contrast': 0.08, 'raster-fade-duration': 150 },
      });
    }
    if (!(o.sensorView && sat)) layers.push(...vectorBase(sat));
    if (o.terrain && !sat) {
      layers.push({
        id: 'hillshade',
        type: 'hillshade',
        source: 'dem-hs',
        paint: {
          'hillshade-shadow-color': '#04060a',
          'hillshade-highlight-color': '#1a2330',
          'hillshade-accent-color': '#0b1016',
          'hillshade-exaggeration': 0.35,
        },
      });
    }
    layers.push(...buildingLayers(o, sat));
    if (o.sensorView) layers.push({ id: LABELS_ANCHOR_ID, type: 'background', paint: { 'background-opacity': 0 } });
    else layers.push(...labelLayers(sat));
  } else {
    layers.push({ id: LABELS_ANCHOR_ID, type: 'background', paint: { 'background-opacity': 0 } });
  }

  const style: StyleSpecification = {
    version: 8,
    name: `suuarm-${o.provider}-${o.basemap}`,
    sources: sources(o),
    layers,
    sky: {
      'sky-color': '#0a1422',
      'horizon-color': '#1b2838',
      'fog-color': '#0c1219',
      'fog-ground-blend': 0.75,
      'horizon-fog-blend': 0.6,
      'sky-horizon-blend': 0.55,
      'atmosphere-blend': 0,
    },
    light: { anchor: 'map', color: '#ffffff', intensity: 0.42, position: [1.4, 215, 35] },
  };
  const g = glyphs(o);
  if (g) style.glyphs = g;
  if (o.terrain && o.provider !== 'OFFLINE') style.terrain = { source: 'dem', exaggeration: 1 };
  return style;
}
