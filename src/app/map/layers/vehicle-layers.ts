import type { Layer } from '@deck.gl/core';
import { IconLayer, LineLayer, PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { SimpleMeshLayer } from '@deck.gl/mesh-layers';
import { PathStyleExtension } from '@deck.gl/extensions';
import { AirframeClass, CAPABILITY_CODE } from '../../core/domain/vehicle';
import { airframeMesh, AIRFRAME_SPAN } from '../meshes/mesh-builder';
import { iconAtlas } from '../meshes/icon-atlas';
import { LocalFrame } from '../../core/world/geo';
import { ACCENT_RGB, RenderFrame, RenderVehicle } from '../render-frame';

const CLASSES: AirframeClass[] = ['QUAD', 'HEXA', 'VTOL', 'RELAY'];
const BODY_RGB: [number, number, number] = [200, 209, 221];
const MATERIAL = { ambient: 0.42, diffuse: 0.62, shininess: 40, specularColor: [70, 76, 86] as [number, number, number] };
const dashExt = new PathStyleExtension({ dash: true });

export const VEHICLE_FONT = 'IBM Plex Mono, ui-monospace, monospace';

/** On-screen exaggeration so a 1 m airframe stays legible; collapses to true scale up close. */
export function meshScale(frame: RenderFrame, targetPx = 24): number {
  return Math.min(48, Math.max(1, (targetPx * frame.mpp) / 1.2));
}

export interface RouteGeometry {
  remaining: [number, number, number][];
  flown: [number, number, number][];
}

export interface Trail {
  path: [number, number, number][];
  color: [number, number, number, number];
}

const GLYPH_STATES = new Set(['WARNING', 'OFFLINE', 'HOLD', 'RETURNING']);

export function vehicleLayers(frame: RenderFrame, route: RouteGeometry | null, geo: LocalFrame, trails: Trail[] = []): Layer[] {
  const layers: Layer[] = [];
  const t = frame.n;
  const is3D = frame.dim === '3D';
  const pov = frame.povId;
  const scale = pov ? 1.6 : meshScale(frame);
  const vis = frame.vehicles.filter((v) => !v.clustered);
  const airborne = vis.filter((v) => v.airborne);
  const hot = frame.fx === 'THERMAL' || frame.fx === 'IR';

  if (pov) {
    // Inside a payload: only physical aircraft are visible (no symbology), own airframe hidden.
    for (const cls of CLASSES) {
      const data = frame.byClass[cls].filter((v) => v.id !== pov && !v.clustered);
      if (!data.length) continue;
      const mesh = airframeMesh(cls);
      for (const part of ['body', 'accent'] as const) {
        layers.push(
          new SimpleMeshLayer<RenderVehicle>({
            id: `pov-${part}-${cls}`,
            data,
            mesh: mesh[part] as never,
            getPosition: (d) => d.position,
            getOrientation: (d) => [-d.pitch, 90 - d.heading, d.roll],
            getColor: hot ? (part === 'accent' ? [255, 255, 255, 255] : [235, 235, 235, 255]) : part === 'accent' ? [70, 76, 86, 255] : [168, 176, 188, 255],
            sizeScale: scale,
            material: hot ? { ambient: 1, diffuse: 0, shininess: 0, specularColor: [0, 0, 0] } : MATERIAL,
            updateTriggers: { getPosition: t, getOrientation: t, getColor: frame.fx },
          }),
        );
      }
    }
    return layers;
  }

  if (trails.length) {
    layers.push(
      new PathLayer<Trail>({
        id: 'uav-trails',
        data: trails,
        getPath: (d) => d.path,
        getColor: (d) => d.color,
        getWidth: 1.5,
        widthUnits: 'pixels',
        updateTriggers: { getPath: t, getColor: t },
      }),
    );
  }

  if (route && frame.selected) {
    layers.push(
      new PathLayer<[number, number, number][]>({
        id: 'sel-route-remaining',
        data: [route.remaining],
        getPath: (d) => d,
        getColor: [...ACCENT_RGB, 210],
        getWidth: 2,
        widthUnits: 'pixels',
        ...({ getDashArray: [6, 4], dashJustified: true } as object),
        extensions: [dashExt],
        updateTriggers: { getPath: t },
        parameters: { depthCompare: 'always' },
      }),
    );
  }

  if (is3D) {
    layers.push(
      new ScatterplotLayer<RenderVehicle>({
        id: 'uav-shadow',
        data: airborne,
        getPosition: (d) => d.ground,
        getRadius: 5,
        radiusUnits: 'pixels',
        getFillColor: [0, 0, 0, 110],
        updateTriggers: { getPosition: t },
      }),
      new LineLayer<RenderVehicle>({
        id: 'uav-dropline',
        data: airborne,
        getSourcePosition: (d) => d.ground,
        getTargetPosition: (d) => d.position,
        getColor: (d) => [d.color[0], d.color[1], d.color[2], d.selected ? 200 : 70],
        getWidth: (d) => (d.selected ? 1.5 : 1),
        widthUnits: 'pixels',
        updateTriggers: { getSourcePosition: t, getTargetPosition: t, getColor: t, getWidth: t },
      }),
      new ScatterplotLayer<RenderVehicle>({
        id: 'uav-ring',
        data: vis,
        getPosition: (d) => d.position,
        getRadius: (d) => (d.selected ? 0 : 15),
        radiusUnits: 'pixels',
        stroked: true,
        filled: false,
        getLineColor: (d) => [d.color[0], d.color[1], d.color[2], d.hovered ? 255 : 150],
        getLineWidth: 1.25,
        lineWidthUnits: 'pixels',
        pickable: true,
        updateTriggers: { getPosition: t, getRadius: t, getLineColor: t },
      }),
    );
    for (const cls of CLASSES) {
      const data = frame.byClass[cls].filter((v) => !v.clustered);
      if (!data.length) continue;
      const mesh = airframeMesh(cls);
      const s = scale * (1.2 / AIRFRAME_SPAN[cls]) * (cls === 'VTOL' ? 1.5 : 1);
      layers.push(
        new SimpleMeshLayer<RenderVehicle>({
          id: `uav-body-${cls}`,
          data,
          mesh: mesh.body as never,
          getPosition: (d) => d.position,
          getOrientation: (d) => [-d.pitch, 90 - d.heading, d.roll],
          getColor: (d) => (d.state === 'OFFLINE' ? [110, 116, 126, 255] : [...BODY_RGB, 255]),
          sizeScale: s,
          material: MATERIAL,
          pickable: true,
          updateTriggers: { getPosition: t, getOrientation: t, getColor: t },
        }),
        new SimpleMeshLayer<RenderVehicle>({
          id: `uav-accent-${cls}`,
          data,
          mesh: mesh.accent as never,
          getPosition: (d) => d.position,
          getOrientation: (d) => [-d.pitch, 90 - d.heading, d.roll],
          getColor: (d) => d.color,
          sizeScale: s,
          material: { ambient: 0.75, diffuse: 0.4, shininess: 8, specularColor: [30, 30, 30] },
          pickable: true,
          updateTriggers: { getPosition: t, getOrientation: t, getColor: t },
        }),
      );
    }
  } else {
    const atlas = iconAtlas();
    layers.push(
      new ScatterplotLayer<RenderVehicle>({
        id: 'uav-halo-2d',
        data: vis,
        getPosition: (d) => d.position,
        getRadius: 17,
        radiusUnits: 'pixels',
        getFillColor: [7, 9, 13, 150],
        stroked: true,
        getLineColor: (d) => [d.color[0], d.color[1], d.color[2], d.hovered ? 255 : 120],
        getLineWidth: 1,
        lineWidthUnits: 'pixels',
        pickable: true,
        updateTriggers: { getPosition: t, getLineColor: t },
      }),
      new IconLayer<RenderVehicle>({
        id: 'uav-icon-2d',
        data: vis,
        iconAtlas: atlas.canvas as never,
        iconMapping: atlas.mapping,
        getIcon: (d) => d.cls,
        getPosition: (d) => d.position,
        getAngle: (d) => -d.heading,
        getSize: (d) => (d.cls === 'VTOL' ? 30 : 24),
        sizeUnits: 'pixels',
        billboard: false,
        getColor: (d) => d.color,
        pickable: true,
        updateTriggers: { getPosition: t, getAngle: t, getColor: t },
      }),
    );
  }

  // Selection highlight
  const sel = frame.selected;
  if (sel) {
    const ahead = 46 * frame.mpp;
    const h = (sel.heading * Math.PI) / 180;
    const ll = geo.toLngLat(sel.local[0] + Math.sin(h) * ahead, sel.local[1] + Math.cos(h) * ahead);
    const tip: [number, number, number] = [ll[0], ll[1], sel.position[2]];
    layers.push(
      new ScatterplotLayer<RenderVehicle>({
        id: 'sel-ring',
        data: [sel],
        getPosition: (d) => d.position,
        getRadius: 22,
        radiusUnits: 'pixels',
        stroked: true,
        filled: true,
        getFillColor: [...ACCENT_RGB, 28],
        getLineColor: [...ACCENT_RGB, 255],
        getLineWidth: 2,
        lineWidthUnits: 'pixels',
        updateTriggers: { getPosition: t },
        parameters: { depthCompare: 'always' },
      }),
      new ScatterplotLayer<RenderVehicle>({
        id: 'sel-ground',
        data: is3D && sel.airborne ? [sel] : [],
        getPosition: (d) => d.ground,
        getRadius: 10,
        radiusUnits: 'pixels',
        stroked: true,
        filled: false,
        getLineColor: [...ACCENT_RGB, 180],
        getLineWidth: 1.5,
        lineWidthUnits: 'pixels',
        updateTriggers: { getPosition: t },
      }),
      new LineLayer({
        id: 'sel-heading',
        data: [{ s: sel.position, e: tip }],
        getSourcePosition: (d: { s: number[] }) => d.s as [number, number, number],
        getTargetPosition: (d: { e: number[] }) => d.e as [number, number, number],
        getColor: [...ACCENT_RGB, 230],
        getWidth: 2,
        widthUnits: 'pixels',
        updateTriggers: { getSourcePosition: t, getTargetPosition: t },
        parameters: { depthCompare: 'always' },
      }),
    );
  }

  // Status glyphs (shape-coded) + capability badges at working zoom
  const atlas = iconAtlas();
  layers.push(
    new IconLayer<RenderVehicle>({
      id: 'uav-status-glyph',
      data: vis.filter((v) => GLYPH_STATES.has(v.state)),
      iconAtlas: atlas.canvas as never,
      iconMapping: atlas.mapping,
      getIcon: (d) => 'S_' + d.state,
      getPosition: (d) => d.position,
      getSize: 13,
      sizeUnits: 'pixels',
      getPixelOffset: [15, -15],
      getColor: (d) => (d.state === 'OFFLINE' ? [240, 82, 79, 255] : d.color),
      billboard: true,
      updateTriggers: { getPosition: t, getIcon: t, getColor: t },
      parameters: { depthCompare: 'always' },
    }),
  );
  if (frame.zoom > 15.4 && vis.length < 160) {
    layers.push(
      new TextLayer<RenderVehicle>({
        id: 'uav-cap-badge',
        data: vis,
        getPosition: (d) => d.position,
        getText: (d) => CAPABILITY_CODE[d.capability],
        getSize: 9,
        getColor: [232, 237, 243, 235],
        getPixelOffset: [-16, -15],
        background: true,
        getBackgroundColor: [22, 29, 39, 230],
        backgroundPadding: [3, 1],
        fontFamily: VEHICLE_FONT,
        fontWeight: 600,
        characterSet: 'auto',
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        updateTriggers: { getPosition: t },
        parameters: { depthCompare: 'always' },
      }),
    );
  }

  // Labels: selected + hovered always; everyone at close range
  const labelled = frame.zoom > 16.4 && vis.length < 80 ? vis : vis.filter((v) => v.selected || v.hovered);
  layers.push(
    new TextLayer<RenderVehicle>({
      id: 'uav-label',
      data: labelled,
      getPosition: (d) => d.position,
      getText: (d) => (d.selected || d.hovered ? `${d.id}  ${Math.round(d.local[2])}m` : d.id),
      getSize: (d) => (d.selected ? 12 : 10.5),
      getColor: (d) => (d.selected ? [232, 237, 243, 255] : [169, 180, 194, 230]),
      getPixelOffset: [0, -30],
      fontFamily: VEHICLE_FONT,
      characterSet: 'auto',
      fontWeight: 500,
      background: true,
      getBackgroundColor: [7, 9, 13, 200],
      backgroundPadding: [4, 2],
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'bottom',
      updateTriggers: { getPosition: t, getText: t, getSize: t, getColor: t },
      parameters: { depthCompare: 'always' },
    }),
  );
  return layers;
}
