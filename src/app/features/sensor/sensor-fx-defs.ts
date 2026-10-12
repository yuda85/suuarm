import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * SVG filter library for simulated sensor imagery (applied to WebGL canvases via CSS `filter:url()`).
 * Visual simulations only — luminance-driven LUTs, not radiometry.
 */
@Component({
  selector: 'app-sensor-fx-defs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        <filter id="fx-thermal-white" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%">
          <feColorMatrix type="matrix" values="0.36 0.52 0.12 0 0  0.36 0.52 0.12 0 0  0.36 0.52 0.12 0 0  0 0 0 1 0" />
          <feComponentTransfer>
            <feFuncR type="table" tableValues="0.02 0.08 0.24 0.55 0.84 1" />
            <feFuncG type="table" tableValues="0.02 0.08 0.24 0.55 0.84 1" />
            <feFuncB type="table" tableValues="0.02 0.08 0.24 0.55 0.84 1" />
          </feComponentTransfer>
          <feGaussianBlur stdDeviation="0.6" />
        </filter>
        <filter id="fx-thermal-black" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%">
          <feColorMatrix type="matrix" values="0.36 0.52 0.12 0 0  0.36 0.52 0.12 0 0  0.36 0.52 0.12 0 0  0 0 0 1 0" />
          <feComponentTransfer>
            <feFuncR type="table" tableValues="0.98 0.9 0.7 0.42 0.14 0.03" />
            <feFuncG type="table" tableValues="0.98 0.9 0.7 0.42 0.14 0.03" />
            <feFuncB type="table" tableValues="0.98 0.9 0.7 0.42 0.14 0.03" />
          </feComponentTransfer>
          <feGaussianBlur stdDeviation="0.6" />
        </filter>
        <filter id="fx-thermal-ironbow" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%">
          <feColorMatrix type="matrix" values="0.36 0.52 0.12 0 0  0.36 0.52 0.12 0 0  0.36 0.52 0.12 0 0  0 0 0 1 0" />
          <feComponentTransfer>
            <feFuncR type="table" tableValues="0.02 0.16 0.48 0.8 0.96 1 1" />
            <feFuncG type="table" tableValues="0 0 0.04 0.22 0.5 0.8 0.98" />
            <feFuncB type="table" tableValues="0.06 0.32 0.5 0.32 0.06 0.12 0.82" />
          </feComponentTransfer>
          <feGaussianBlur stdDeviation="0.6" />
        </filter>
        <filter id="fx-nir" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%">
          <!-- Vegetation reflects strongly in NIR: weight green over red, then mono. -->
          <feColorMatrix type="matrix" values="-0.25 1.15 0.1 0 0.02  -0.25 1.15 0.1 0 0.02  -0.25 1.15 0.1 0 0.02  0 0 0 1 0" />
          <feComponentTransfer>
            <feFuncR type="table" tableValues="0.04 0.2 0.5 0.8 0.96" />
            <feFuncG type="table" tableValues="0.04 0.2 0.5 0.8 0.96" />
            <feFuncB type="table" tableValues="0.04 0.2 0.5 0.8 0.96" />
          </feComponentTransfer>
        </filter>
      </defs>
    </svg>
  `,
  styles: `
    :host {
      position: absolute;
      width: 0;
      height: 0;
      overflow: hidden;
    }
  `,
})
export class SensorFxDefs {}
