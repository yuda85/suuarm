import { MapView, type Layer } from '@deck.gl/core';
import { MapLibreOverlay } from '@deck.gl/maplibre';
import { Map as MlMap, type StyleSpecification } from 'maplibre-gl';
import { CamState, DEFAULT_FOV } from './camera/camera-controller';

/**
 * Secondary, non-interactive MapLibre + deck.gl view (sensor feeds, PIP). Same world, same
 * layers, different camera — that is what keeps feeds spatially linked to the main map.
 */
export class MiniMap {
  readonly map: MlMap;
  readonly overlay: MapLibreOverlay;
  private fov = DEFAULT_FOV;
  ready = false;

  constructor(container: HTMLElement, style: StyleSpecification, center: [number, number]) {
    this.map = new MlMap({
      container,
      style,
      center,
      zoom: 16,
      interactive: false,
      attributionControl: false,
      maxPitch: 89.5,
      centerClampedToGround: false,
      fadeDuration: 0,
      canvasContextAttributes: { antialias: true },
    });
    this.overlay = new MapLibreOverlay({ interleaved: true, layers: [] });
    this.map.addControl(this.overlay);
    this.map.once('load', () => (this.ready = true));
  }

  setCam(cam: CamState): void {
    if (Math.abs(cam.fov - this.fov) > 0.005) {
      this.fov = cam.fov;
      this.map.setVerticalFieldOfView(cam.fov);
      this.overlay.setProps({ views: new MapView({ id: 'maplibre', fovy: cam.fov }) as never });
    }
    this.map.jumpTo(this.map.calculateCameraOptionsFromCameraLngLatAltRotation([cam.lng, cam.lat], cam.alt, cam.bearing, cam.pitch));
  }

  setLayers(layers: Layer[]): void {
    this.overlay.setProps({ layers });
  }

  setStyle(style: StyleSpecification): void {
    this.map.setStyle(style);
  }

  resize(): void {
    this.map.resize();
  }

  destroy(): void {
    this.overlay.finalize();
    this.map.remove();
  }
}
