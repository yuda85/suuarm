import { addProtocol } from 'maplibre-gl';

export const DEM_PROTOCOL = 'seadem';

let registered = false;
/** Theatre elevation ceiling (m). Coastal DSMs include towers as spikes; flatten above this. */
let maxElev = 9000;

export function setDemCeiling(m: number): void {
  maxElev = m;
}

/**
 * Coastal theatres: public DEMs carry bathymetry, which renders the sea as a pit with cliff-like
 * shorelines. This protocol decodes each raster-dem tile and clamps elevations below sea level to 0
 * so water reads as a flat surface. Supports terrarium and mapbox (terrain-rgb) encodings.
 */
export function registerDemProtocol(): void {
  if (registered) return;
  registered = true;
  addProtocol(DEM_PROTOCOL, async (params, abort) => {
    const url = params.url.slice(DEM_PROTOCOL.length + 3);
    const terrarium = url.includes('terrarium');
    const res = await fetch(url, { signal: abort.signal });
    if (!res.ok) throw new Error(`DEM ${res.status}`);
    const bmp = await createImageBitmap(await res.blob());
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const g = canvas.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(bmp, 0, 0);
    const img = g.getImageData(0, 0, bmp.width, bmp.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (terrarium) {
        // elev = R*256 + G + B/256 - 32768 → negative iff R < 128
        const e = d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768;
        const c = Math.max(0, Math.min(maxElev, e));
        if (c !== e) {
          const v = c + 32768;
          d[i] = Math.floor(v / 256);
          d[i + 1] = Math.floor(v) % 256;
          d[i + 2] = Math.floor((v % 1) * 256);
        }
      } else {
        // elev = -10000 + (R*65536 + G*256 + B) * 0.1 → sea level = 100000
        const v = d[i] * 65536 + d[i + 1] * 256 + d[i + 2];
        const c = Math.max(100000, Math.min(100000 + maxElev * 10, v));
        if (c !== v) {
          d[i] = (c >> 16) & 255;
          d[i + 1] = (c >> 8) & 255;
          d[i + 2] = c & 255;
        }
      }
      d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const out = await canvas.convertToBlob({ type: 'image/png' });
    return { data: await out.arrayBuffer() };
  });
}
