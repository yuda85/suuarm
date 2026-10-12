import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Logo } from '../../shared/ui/logo';
import { AutopilotService } from './autopilot.service';

/** Video-capture overlay: operator cursor + click ripples, lower-third captions, title and end cards. */
@Component({
  selector: 'app-autopilot-overlay',
  imports: [Logo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.on]': 'ap.running()', '(window:keydown.escape)': 'ap.running() && ap.stop()' },
  template: `
    @if (ap.cursor().visible) {
      <svg class="cursor" [class.down]="ap.cursor().down" [style.transform]="'translate(' + ap.cursor().x + 'px,' + ap.cursor().y + 'px)'" width="26" height="30" viewBox="0 0 26 30" aria-hidden="true">
        <path d="M2 2 L2 23 L8 17.5 L12.2 27 L16 25.3 L11.9 16 L20 16 Z" fill="#f4f7fb" stroke="#07090d" stroke-width="1.6" stroke-linejoin="round" />
      </svg>
    }
    @if (ap.ripple(); as r) {
      <span class="ripple" [style.left.px]="r.x" [style.top.px]="r.y"></span>
    }
    @if (ap.caption(); as c) {
      <div class="caption">
        <span class="kicker caps">{{ c.kicker }}</span>
        <span class="text">{{ c.text }}</span>
      </div>
    }
    @if (ap.timelapse(); as t) {
      <div class="tl caps mono">▸▸ time-lapse ×{{ t }}</div>
    }
    @if (ap.card() === 'title') {
      <div class="card title">
        <div class="brand"><ui-logo /><span class="product">Suuarm<b>OS</b></span></div>
        <h1>Command, control and fleet orchestration</h1>
        <p class="caps">for large-scale autonomous drone operations · SUUARM Systems</p>
      </div>
    }
    @if (ap.card() === 'end') {
      <div class="card end">
        <div class="brand"><ui-logo /><span class="product">Suuarm<b>OS</b></span></div>
        <h1>The operator controls the mission.<br />SuuarmOS controls the fleet.</h1>
        <p class="caps">SUUARM Systems · simulated demonstration</p>
      </div>
    }
  `,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      z-index: 200;
      pointer-events: none;
    }
    .cursor {
      position: fixed;
      left: 0;
      top: 0;
      margin: -2px 0 0 -2px;
      filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.6));
      transition: scale 120ms var(--ease);
      transform-origin: 2px 2px;
    }
    .cursor.down {
      scale: 0.86;
    }
    .ripple {
      position: fixed;
      width: 44px;
      height: 44px;
      margin: -22px 0 0 -22px;
      border: 2px solid var(--c-accent-strong);
      border-radius: 50%;
      animation: ripple 520ms var(--ease-out) forwards;
    }
    @keyframes ripple {
      from {
        transform: scale(0.25);
        opacity: 0.95;
      }
      to {
        transform: scale(1.25);
        opacity: 0;
      }
    }
    .caption {
      position: fixed;
      left: 50%;
      bottom: 4.2rem;
      transform: translateX(-50%);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.2rem;
      max-width: min(54rem, 70vw);
      padding: 0.65rem 1.3rem 0.75rem;
      border: 1px solid var(--c-line-strong);
      border-left: 3px solid var(--c-accent);
      border-radius: var(--r-3);
      background: rgba(10, 14, 20, 0.9);
      box-shadow: var(--shadow-pop);
      text-align: center;
      animation: cap-in 380ms var(--ease-out);
      .kicker {
        color: var(--c-accent-strong);
        font-size: 0.6875rem;
      }
      .text {
        color: var(--c-text-1);
        font-size: 1.15rem;
        font-weight: 500;
        letter-spacing: 0.005em;
      }
    }
    @keyframes cap-in {
      from {
        transform: translate(-50%, 8px);
        opacity: 0;
      }
    }
    .tl {
      position: fixed;
      right: 1.2rem;
      bottom: 4.4rem;
      padding: 0.3rem 0.6rem;
      border-radius: var(--r-2);
      background: rgba(10, 14, 20, 0.85);
      color: var(--s-warning);
      font-size: 0.75rem;
    }
    .card {
      position: fixed;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1.2rem;
      background: radial-gradient(ellipse at center, rgba(11, 22, 38, 0.92), rgba(7, 9, 13, 0.98));
      text-align: center;
      animation: card-in 700ms var(--ease-out);
      h1 {
        margin: 0;
        max-width: 46rem;
        color: var(--c-text-1);
        font-size: 2.4rem;
        font-weight: 400;
        line-height: 1.25;
        letter-spacing: -0.01em;
      }
      p {
        margin: 0;
        color: var(--c-text-3);
        letter-spacing: 0.18em;
      }
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 0.8rem;
      ::ng-deep svg {
        width: 3.2rem;
        height: 3.2rem;
      }
      .product {
        font-size: 2.6rem;
        font-weight: 500;
        b {
          font-weight: 600;
          color: var(--c-accent-strong);
        }
      }
    }
    @keyframes card-in {
      from {
        opacity: 0;
      }
    }
  `,
})
export class AutopilotOverlay {
  protected readonly ap = inject(AutopilotService);
}
