import { AirframeClass } from '../../core/domain/vehicle';

/** Top-down silhouettes (nose up), white on transparent, drawn once into an atlas for IconLayer (mask mode). */
const CELL = 96;
const ORDER: AirframeClass[] = ['QUAD', 'HEXA', 'VTOL', 'RELAY'];
/** Status glyphs: shape-coded so state never relies on colour alone. */
const GLYPHS = ['S_WARNING', 'S_OFFLINE', 'S_HOLD', 'S_RETURNING'] as const;

export interface IconAtlas {
  canvas: HTMLCanvasElement;
  mapping: Record<string, { x: number; y: number; width: number; height: number; mask: boolean; anchorY: number }>;
}

let atlas: IconAtlas | null = null;

export function iconAtlas(): IconAtlas {
  if (atlas) return atlas;
  const canvas = document.createElement('canvas');
  canvas.width = CELL * (ORDER.length + GLYPHS.length);
  canvas.height = CELL;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  const mapping: IconAtlas['mapping'] = {};
  ORDER.forEach((cls, i) => {
    g.save();
    g.translate(i * CELL + CELL / 2, CELL / 2);
    draw(g, cls);
    g.restore();
    mapping[cls] = { x: i * CELL, y: 0, width: CELL, height: CELL, mask: true, anchorY: CELL / 2 };
  });
  GLYPHS.forEach((id, k) => {
    const i = ORDER.length + k;
    g.save();
    g.translate(i * CELL + CELL / 2, CELL / 2);
    glyph(g, id);
    g.restore();
    mapping[id] = { x: i * CELL, y: 0, width: CELL, height: CELL, mask: true, anchorY: CELL / 2 };
  });
  atlas = { canvas, mapping };
  return atlas;
}

function rotorRing(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.lineWidth = 4;
  g.stroke();
}

function draw(g: CanvasRenderingContext2D, cls: AirframeClass): void {
  switch (cls) {
    case 'QUAD': {
      g.lineWidth = 7;
      for (const [x, y] of [[-24, -24], [24, -24], [24, 24], [-24, 24]]) {
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(x, y);
        g.stroke();
        rotorRing(g, x, y, 13);
      }
      body(g, 12, 16);
      break;
    }
    case 'HEXA':
    case 'RELAY': {
      g.lineWidth = 6;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const x = Math.sin(a) * 33, y = -Math.cos(a) * 33;
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(x, y);
        g.stroke();
        rotorRing(g, x, y, 10);
      }
      body(g, 14, 16);
      if (cls === 'RELAY') {
        g.beginPath();
        g.arc(0, 0, 5, 0, Math.PI * 2);
        g.fillStyle = '#000';
        g.globalCompositeOperation = 'destination-out';
        g.fill();
        g.globalCompositeOperation = 'source-over';
        g.fillStyle = '#fff';
      }
      break;
    }
    case 'VTOL': {
      // fuselage
      g.beginPath();
      g.moveTo(0, -40);
      g.quadraticCurveTo(7, -30, 6, -10);
      g.lineTo(5, 30);
      g.lineTo(-5, 30);
      g.lineTo(-6, -10);
      g.quadraticCurveTo(-7, -30, 0, -40);
      g.fill();
      // wing
      g.beginPath();
      g.moveTo(-44, -6);
      g.lineTo(44, -6);
      g.lineTo(42, 4);
      g.lineTo(-42, 4);
      g.closePath();
      g.fill();
      // booms + tail
      g.lineWidth = 3;
      for (const x of [-16, 16]) {
        g.beginPath();
        g.moveTo(x, -22);
        g.lineTo(x, 34);
        g.stroke();
      }
      g.fillRect(-20, 32, 40, 5);
      break;
    }
  }
}

function body(g: CanvasRenderingContext2D, w: number, h: number): void {
  g.beginPath();
  g.moveTo(0, -h - 6); // nose point → heading cue
  g.lineTo(w, -h + 6);
  g.lineTo(w, h);
  g.lineTo(-w, h);
  g.lineTo(-w, -h + 6);
  g.closePath();
  g.fill();
}

function glyph(g: CanvasRenderingContext2D, id: (typeof GLYPHS)[number]): void {
  // Dark plate behind every glyph keeps it legible over imagery.
  g.fillStyle = '#fff';
  switch (id) {
    case 'S_WARNING':
      g.beginPath();
      g.moveTo(0, -36);
      g.lineTo(38, 30);
      g.lineTo(-38, 30);
      g.closePath();
      g.fill();
      g.globalCompositeOperation = 'destination-out';
      g.fillRect(-5, -14, 10, 26);
      g.fillRect(-5, 17, 10, 8);
      g.globalCompositeOperation = 'source-over';
      break;
    case 'S_OFFLINE':
      g.lineWidth = 16;
      g.strokeStyle = '#fff';
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-26, -26);
      g.lineTo(26, 26);
      g.moveTo(26, -26);
      g.lineTo(-26, 26);
      g.stroke();
      break;
    case 'S_HOLD':
      g.fillRect(-26, -30, 18, 60);
      g.fillRect(8, -30, 18, 60);
      break;
    case 'S_RETURNING':
      g.beginPath();
      g.moveTo(-34, -6);
      g.lineTo(0, -38);
      g.lineTo(34, -6);
      g.lineTo(14, -6);
      g.lineTo(14, 32);
      g.lineTo(-14, 32);
      g.lineTo(-14, -6);
      g.closePath();
      g.fill();
      break;
  }
}
