import { afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, input, viewChild } from '@angular/core';
import { angleDiff, DEG } from '../../core/domain/geometry';
import { Rng, hashString } from '../../core/sim/rng';
import { MapService } from '../../map/map.service';
import { FrameListener } from '../../map/render-loop';
import { RenderFrame } from '../../map/render-frame';

interface Blip {
  az: number; // relative deg
  r: number; // meters
  life: number; // 0..1 persistence
  moving: boolean;
  label?: string;
}

/**
 * Simplified radar presentation (B-scope: azimuth × range). Not video: returns are plotted from
 * geometry — moving aircraft (MTI) plus seeded static clutter from structures.
 */
@Component({
  selector: 'app-radar-scope',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<canvas #cv></canvas><span class="tag caps">Ku-SAR / GMTI · B-SCOPE · SIMULATED</span>`,
  styles: `
    :host {
      position: absolute;
      inset: 0;
      display: block;
      background: #040a0b;
      container-type: size;
    }
    @container (max-width: 280px) {
      .tag {
        display: none;
      }
    }
    canvas {
      width: 100%;
      height: 100%;
      display: block;
    }
    .tag {
      position: absolute;
      right: 0.5rem;
      top: 0.35rem;
      color: rgba(120, 220, 200, 0.75);
      font-size: 0.5625rem;
    }
  `,
})
export class RadarScope implements FrameListener {
  readonly vehicleId = input.required<string>();
  private readonly cv = viewChild.required<ElementRef<HTMLCanvasElement>>('cv');
  private readonly svc = inject(MapService);
  private blips: Blip[] = [];
  private clutterFor = '';
  private clutter: Blip[] = [];
  private last = 0;
  private sweep = -1;
  private dir = 1;

  constructor() {
    afterNextRender(() => this.svc.loop?.listeners.add(this));
    inject(DestroyRef).onDestroy(() => this.svc.loop?.listeners.delete(this));
  }

  render(frame: RenderFrame, now: number): void {
    if (now - this.last < 40) return;
    const dt = (now - this.last) / 1000;
    this.last = now;
    const id = this.vehicleId();
    const sol = this.svc.loop?.solutions.get(id);
    const self = frame.vehicles.find((v) => v.id === id);
    const canvas = this.cv().nativeElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = 'rgba(4,10,11,0.35)';
    g.fillRect(0, 0, w, h);
    if (!sol || !self) return;

    const half = sol.hfov / 2;
    const range = sol.range;
    const small = w < 280;
    const pad = small ? { l: 22, r: 6, t: 26, b: 14 } : { l: 34, r: 16, t: 22, b: 24 };
    g.font = small ? '9px IBM Plex Mono, monospace' : '10px IBM Plex Mono, monospace';
    const pw = w - pad.l - pad.r;
    const ph = h - pad.t - pad.b;
    const x = (az: number) => pad.l + ((az + half) / sol.hfov) * pw;
    const y = (r: number) => pad.t + ph - (r / range) * ph;

    if (this.clutterFor !== id) {
      this.clutterFor = id;
      const rng = new Rng(hashString(id));
      this.clutter = Array.from({ length: 60 }, () => ({ az: rng.range(-half, half), r: rng.range(300, range), life: rng.range(0.2, 0.6), moving: false }));
    }

    // Sweep (back-and-forth across sector)
    this.sweep += this.dir * dt * 0.8;
    if (this.sweep > 1 || this.sweep < -1) {
      this.dir *= -1;
      this.sweep = Math.max(-1, Math.min(1, this.sweep));
    }
    const sweepAz = this.sweep * half;

    // Paint new returns near the sweep line
    for (const v of frame.vehicles) {
      if (v.id === id || !v.airborne) continue;
      const dx = v.local[0] - self.local[0];
      const dy = v.local[1] - self.local[1];
      const r = Math.hypot(dx, dy);
      if (r > range) continue;
      const az = angleDiff(sol.azimuth, Math.atan2(dx, dy) / DEG);
      if (Math.abs(az) > half || Math.abs(az - sweepAz) > 6) continue;
      this.blips.push({ az, r, life: 1, moving: true, label: v.id.replace('UAV-', '') });
    }
    for (const c of this.clutter) if (Math.abs(c.az - sweepAz) < 3) this.blips.push({ ...c, life: c.life });
    this.blips = this.blips.filter((b) => (b.life -= dt * 0.35) > 0).slice(-400);

    // Grid
    g.strokeStyle = 'rgba(110,220,200,0.12)';
    g.lineWidth = 1;
    g.fillStyle = 'rgba(110,220,200,0.55)';
    for (let i = 0; i <= 4; i++) {
      const r = (range / 4) * i;
      g.beginPath();
      g.moveTo(pad.l, y(r));
      g.lineTo(w - pad.r, y(r));
      g.stroke();
      g.fillText(`${(r / 1000).toFixed(1)}`, 4, y(r) + 3);
      if (i === 4) g.fillText('km', 4, y(r) + 14);
    }
    for (let a = -60; a <= 60; a += 30) {
      if (Math.abs(a) > half || (small && a % 60 !== 0)) continue;
      g.beginPath();
      g.moveTo(x(a), pad.t);
      g.lineTo(x(a), pad.t + ph);
      g.stroke();
      g.textAlign = 'center';
      g.fillText(`${a > 0 ? '+' : ''}${a}°`, x(a), h - 7);
      g.textAlign = 'left';
    }
    // Sweep line
    g.strokeStyle = 'rgba(110,220,200,0.55)';
    g.beginPath();
    g.moveTo(x(sweepAz), pad.t);
    g.lineTo(x(sweepAz), pad.t + ph);
    g.stroke();
    // Returns
    for (const b of this.blips) {
      g.fillStyle = b.moving ? `rgba(225,245,240,${b.life})` : `rgba(110,220,200,${b.life * 0.7})`;
      const s = b.moving ? 4 : 2.5;
      g.fillRect(x(b.az) - s / 2, y(b.r) - s / 2, s, s);
      if (b.moving && b.label && b.life > 0.85) {
        g.fillStyle = 'rgba(225,245,240,0.85)';
        g.fillText(b.label, x(b.az) + 5, y(b.r) - 4);
      }
    }
  }
}
