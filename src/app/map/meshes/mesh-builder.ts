import { AirframeClass } from '../../core/domain/vehicle';

/**
 * Procedural low-poly airframes (meters; nose +x, left +y, up +z), flat-shaded triangle lists.
 * Two parts per airframe: `body` (neutral) and `accent` (rotors/nav bands, tinted by status).
 */
export interface MeshData {
  attributes: {
    positions: { value: Float32Array; size: 3 };
    normals: { value: Float32Array; size: 3 };
  };
}

class Builder {
  private p: number[] = [];
  private n: number[] = [];

  tri(a: number[], b: number[], c: number[]): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    this.p.push(...a, ...b, ...c);
    this.n.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  }

  quad(a: number[], b: number[], c: number[], d: number[]): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  /** Axis-aligned box centred at (cx,cy,cz), optionally yawed by `yaw` rad around z. */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, yaw = 0, taperNose = 1): void {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const cw = Math.cos(yaw), sw = Math.sin(yaw);
    const v = (x: number, y: number, z: number): number[] => {
      const t = x > 0 ? taperNose : 1;
      const yy = y * t, zz = z * (x > 0 ? (1 + taperNose) / 2 : 1);
      return [cx + x * cw - yy * sw, cy + x * sw + yy * cw, cz + zz];
    };
    const p000 = v(-hx, -hy, -hz), p100 = v(hx, -hy, -hz), p110 = v(hx, hy, -hz), p010 = v(-hx, hy, -hz);
    const p001 = v(-hx, -hy, hz), p101 = v(hx, -hy, hz), p111 = v(hx, hy, hz), p011 = v(-hx, hy, hz);
    this.quad(p001, p101, p111, p011); // top
    this.quad(p010, p110, p100, p000); // bottom
    this.quad(p000, p100, p101, p001); // -y side
    this.quad(p110, p010, p011, p111); // +y side
    this.quad(p100, p110, p111, p101); // +x nose
    this.quad(p010, p000, p001, p011); // -x tail
  }

  /** Vertical-axis cylinder / disc. */
  cyl(cx: number, cy: number, cz: number, r: number, h: number, seg = 14): void {
    const z0 = cz - h / 2, z1 = cz + h / 2;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const x0 = cx + Math.cos(a0) * r, y0 = cy + Math.sin(a0) * r;
      const x1 = cx + Math.cos(a1) * r, y1 = cy + Math.sin(a1) * r;
      this.tri([cx, cy, z1], [x0, y0, z1], [x1, y1, z1]);
      this.tri([cx, cy, z0], [x1, y1, z0], [x0, y0, z0]);
      this.quad([x0, y0, z0], [x1, y1, z0], [x1, y1, z1], [x0, y0, z1]);
    }
  }

  /** Ring (annulus) disc for rotor guards / spinning-blade discs. */
  annulus(cx: number, cy: number, cz: number, r0: number, r1: number, h: number, seg = 18): void {
    const z0 = cz - h / 2, z1 = cz + h / 2;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const i0 = [cx + c0 * r0, cy + s0 * r0], i1 = [cx + c1 * r0, cy + s1 * r0];
      const o0 = [cx + c0 * r1, cy + s0 * r1], o1 = [cx + c1 * r1, cy + s1 * r1];
      this.quad([i0[0], i0[1], z1], [o0[0], o0[1], z1], [o1[0], o1[1], z1], [i1[0], i1[1], z1]);
      this.quad([i1[0], i1[1], z0], [o1[0], o1[1], z0], [o0[0], o0[1], z0], [i0[0], i0[1], z0]);
      this.quad([o0[0], o0[1], z0], [o1[0], o1[1], z0], [o1[0], o1[1], z1], [o0[0], o0[1], z1]);
    }
  }

  /** Disc with axis along x (pusher prop). */
  discX(cx: number, cy: number, cz: number, r: number, seg = 14): void {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const p0 = [cx, cy + Math.cos(a0) * r, cz + Math.sin(a0) * r];
      const p1 = [cx, cy + Math.cos(a1) * r, cz + Math.sin(a1) * r];
      this.tri([cx, cy, cz], p0, p1);
      this.tri([cx, cy, cz], p1, p0);
    }
  }

  build(): MeshData {
    return {
      attributes: {
        positions: { value: new Float32Array(this.p), size: 3 },
        normals: { value: new Float32Array(this.n), size: 3 },
      },
    };
  }
}

function multirotor(arms: number, armLen: number, rotorR: number, bodyR: number, relay: boolean): { body: MeshData; accent: MeshData } {
  const b = new Builder();
  const a = new Builder();
  // Fuselage pod (slightly nose-forward) + battery top
  b.box(0.02, 0, 0, bodyR * 2.2, bodyR * 1.3, bodyR * 0.55, 0, 0.75);
  b.box(-0.02, 0, bodyR * 0.36, bodyR * 1.3, bodyR * 0.9, bodyR * 0.22);
  // Gimbal ball under nose
  b.box(bodyR * 0.95, 0, -bodyR * 0.48, bodyR * 0.45, bodyR * 0.45, bodyR * 0.45);
  const offset = arms === 4 ? Math.PI / 4 : 0;
  for (let i = 0; i < arms; i++) {
    const ang = offset + (i / arms) * Math.PI * 2;
    const ex = Math.cos(ang) * armLen, ey = Math.sin(ang) * armLen;
    b.box(ex / 2, ey / 2, 0.01, armLen, armLen * 0.07, armLen * 0.06, ang);
    b.cyl(ex, ey, 0.04, armLen * 0.08, armLen * 0.12, 10); // motor bell
    a.annulus(ex, ey, 0.085, rotorR * 0.18, rotorR, 0.008, 20); // blade disc
    // landing leg on alternate arms
    if (i % (arms / 2) === 0 || arms === 4) b.box(ex * 0.55, ey * 0.55, -bodyR * 0.55, 0.02, 0.02, bodyR * 0.75);
  }
  // Front nav band (accent) so heading reads at a glance
  a.box(bodyR * 1.18, 0, 0.0, bodyR * 0.08, bodyR * 1.0, bodyR * 0.2);
  if (relay) {
    b.cyl(0, 0, bodyR * 1.3, 0.018, bodyR * 3.4, 8); // antenna mast
    a.cyl(0, 0, bodyR * 3.0, 0.06, 0.05, 10); // beacon
  }
  return { body: b.build(), accent: a.build() };
}

function vtol(): { body: MeshData; accent: MeshData } {
  const b = new Builder();
  const a = new Builder();
  b.box(0.15, 0, 0, 1.55, 0.2, 0.2, 0, 0.45); // fuselage with tapered nose
  b.box(-0.75, 0, 0.02, 0.5, 0.12, 0.14); // tail cone
  b.box(0.12, 0, 0.09, 0.42, 3.0, 0.035); // main wing
  // Tail booms + horizontal stabiliser + twin fins
  for (const y of [-0.55, 0.55]) {
    b.box(-0.35, y, 0.06, 1.75, 0.045, 0.045);
    b.box(-1.15, y, 0.18, 0.22, 0.02, 0.24);
  }
  b.box(-1.15, 0, 0.28, 0.2, 1.2, 0.025);
  b.box(0.35, 0, -0.14, 0.14, 0.14, 0.12); // gimbal
  // Lift rotors (accent) at boom ends, pusher prop
  for (const y of [-0.55, 0.55]) {
    for (const x of [0.48, -1.0]) {
      b.cyl(x, y, 0.1, 0.035, 0.06, 8);
      a.annulus(x, y, 0.14, 0.05, 0.27, 0.006, 18);
    }
  }
  a.discX(-1.03, 0, 0.02, 0.2);
  // Wingtip nav markers
  a.box(0.12, 1.48, 0.09, 0.3, 0.05, 0.04);
  a.box(0.12, -1.48, 0.09, 0.3, 0.05, 0.04);
  return { body: b.build(), accent: a.build() };
}

const cache = new Map<AirframeClass, { body: MeshData; accent: MeshData }>();

export function airframeMesh(cls: AirframeClass): { body: MeshData; accent: MeshData } {
  let m = cache.get(cls);
  if (!m) {
    switch (cls) {
      case 'QUAD':
        m = multirotor(4, 0.42, 0.2, 0.13, false);
        break;
      case 'HEXA':
        m = multirotor(6, 0.62, 0.24, 0.18, false);
        break;
      case 'RELAY':
        m = multirotor(6, 0.55, 0.22, 0.17, true);
        break;
      case 'VTOL':
        m = vtol();
        break;
    }
    cache.set(cls, m);
  }
  return m;
}

/** Characteristic size (m) used to compute on-screen exaggeration. */
export const AIRFRAME_SPAN: Record<AirframeClass, number> = { QUAD: 1.0, HEXA: 1.5, RELAY: 1.4, VTOL: 3.0 };
