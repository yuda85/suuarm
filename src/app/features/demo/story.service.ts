import { inject, Injectable, signal } from '@angular/core';
import { AlertStore } from '../../core/state/alert.store';
import { MissionStore } from '../../core/state/mission.store';
import { OpsStore } from '../../core/state/ops-store';
import { RoleService } from '../../core/state/role.service';
import { SensorStore } from '../../core/state/sensor.store';
import { SimHost } from '../../core/state/sim-host.service';
import { MapService } from '../../map/map.service';

export interface StoryStep {
  title: string;
  say: string;
  run: () => void;
}

const CAMPUS: [number, number] = [54.4146, 24.4954];

/**
 * Presenter story director: the ideal 2–3 minute demo as one-click steps. Every step leaves the
 * system in a consistent state, so a presenter can jump, repeat or recover at any point.
 */
@Injectable({ providedIn: 'root' })
export class StoryService {
  private readonly sim = inject(SimHost);
  private readonly ops = inject(OpsStore);
  private readonly sensors = inject(SensorStore);
  private readonly missions = inject(MissionStore);
  private readonly alerts = inject(AlertStore);
  private readonly map = inject(MapService);
  private readonly roles = inject(RoleService);
  readonly index = signal(-1);

  private fly(center: [number, number], zoom: number, pitch: number, bearing: number, duration = 1800): void {
    this.map.engine?.map.flyTo({ center, zoom, pitch, bearing, duration, essential: true });
  }

  private onTask(id: string): boolean {
    const v = this.sim.engine.byId.get(id);
    return !!v && v.phase === 'ON_TASK';
  }

  readonly steps: StoryStep[] = [
    {
      title: 'Launch Building Scan',
      say: 'Swarm READY · 50 assets available',
      run: () => {
        this.roles.role.set('OPERATOR');
        this.sim.speed.set(1);
        this.sim.start('building-scan', 50);
        this.ops.viewDim.set('2D');
        this.ops.leftTab.set('FLEET');
        setTimeout(() => this.fly([54.4205, 24.4962], 14.9, 0, 0), 50);
      },
    },
    {
      title: 'Switch 2D → 3D',
      say: 'Terrain, campus and buildings in 3D',
      run: () => {
        this.ops.viewDim.set('3D');
        setTimeout(() => this.fly(CAMPUS, 16.6, 60, -38, 2200), 150);
      },
    },
    {
      title: 'Select mission area · plan',
      say: 'Operator states intent: scan Research Centre · EO + THERMAL',
      run: () => {
        this.ops.leftCollapsed.set(false);
        this.ops.leftTab.set('MISSIONS');
        this.missions.builderOpen.set(true);
        this.missions.patch({ type: 'BUILDING_SCAN', name: 'Building Scan', priority: 'HIGH', sensors: ['EO', 'THERMAL'], targetId: 'B1' });
        setTimeout(() => {
          this.missions.generate();
          this.missions.builderOpen.set(false);
        }, 900);
      },
    },
    {
      title: 'START MISSION',
      say: 'Swarm READY → ACTIVE · 12 assets launch',
      run: () => {
        if (!this.missions.current() || this.missions.current()!.mission.status !== 'PLANNED') this.missions.generate();
        setTimeout(() => this.missions.start(), 100);
        setTimeout(() => this.fly([54.4185, 24.4958], 15.6, 58, -55, 2000), 400);
      },
    },
    {
      title: 'Assets approach in 3D',
      say: 'Routes to roof, facades and perimeter',
      run: () => {
        this.sim.fastForward(900, (e) => e.vehicles.filter((v) => v.phase === 'ON_TASK').length >= 4);
        this.fly(CAMPUS, 16.9, 62, -60, 1600);
      },
    },
    {
      title: 'Follow UAV-021',
      say: 'Camera chases the aircraft from behind',
      run: () => {
        this.sim.fastForward(900, () => this.onTask('UAV-021'));
        this.ops.select('UAV-021');
        this.ops.cameraMode.set('FOLLOW_VEHICLE');
      },
    },
    {
      title: 'Sensor cone on the facade',
      say: 'Which aircraft, where, looking where, covering what',
      run: () => {
        const cam = this.map.camera;
        if (cam) {
          cam.follow.bearingOffset = 62;
          cam.follow.distance = 46;
          cam.follow.height = 16;
        }
        this.sensors.openSensor('UAV-021');
      },
    },
    {
      title: 'Enter SENSOR POV',
      say: 'The map becomes the payload view',
      run: () => this.sensors.enterPov('UAV-021'),
    },
    {
      title: 'EO → THERMAL',
      say: 'Same geometry, thermal rendering · hot rooftop plant',
      run: () => {
        const slot = this.sensors.pov();
        if (slot) {
          const v = this.sensors.vehicle(slot);
          const eo = v?.payloads.find((p) => p.type === 'EO');
          const th = v?.payloads.find((p) => p.type === 'THERMAL');
          const cur = this.sensors.payload(slot)?.type;
          this.sensors.switchType(slot, cur === 'THERMAL' && eo ? 'EO' : th ? 'THERMAL' : 'EO');
        }
      },
    },
    {
      title: 'Return to tactical map',
      say: 'Pull back out of the payload',
      run: () => {
        this.sensors.exitPov('TACTICAL');
        if (this.map.camera) {
          this.map.camera.follow.bearingOffset = 0;
          this.map.camera.follow.distance = 26;
          this.map.camera.follow.height = 9;
        }
      },
    },
    {
      title: 'Inject UAV-007 LINK LOST',
      say: 'Alert · task released · SuuarmOS evaluates the fleet',
      run: () => {
        if (!this.sim.engine.byId.get('UAV-007')?.taskId) this.sim.fastForward(600, () => !!this.sim.engine.byId.get('UAV-007')?.taskId);
        this.sim.dispatch({ type: 'LINK_LOST', vehicleId: 'UAV-007' });
        this.ops.select('UAV-007');
        this.ops.cameraMode.set('FREE_3D');
        setTimeout(() => this.fly(CAMPUS, 16.7, 58, -40, 1400), 300);
      },
    },
    {
      title: 'APPROVE recommendation',
      say: 'Supervised autonomy: operator approves UAV-031',
      run: () => {
        const r = this.alerts.pending()[0];
        if (r) this.alerts.approve(r);
        setTimeout(() => this.ops.select(r?.toIds[0] ?? 'UAV-031'), 300);
      },
    },
    {
      title: 'UAV-031 READY → ACTIVE',
      say: 'New route to the east facade · mission continues',
      run: () => {
        this.ops.select('UAV-031');
        this.ops.cameraMode.set('FOLLOW_VEHICLE');
      },
    },
    {
      title: 'Zoom out · fleet at scale',
      say: 'Clusters summarise state · progressive disclosure',
      run: () => {
        this.ops.cameraMode.set('FREE_3D');
        this.ops.select(null);
        setTimeout(() => this.fly([54.405, 24.47], 12.2, 45, -12, 2400), 1300);
      },
    },
    {
      title: 'Second scenario · Airspace Response',
      say: 'Same core, completely different mission',
      run: () => {
        this.sim.start('aerial-response', 50);
        this.sim.fastForward(205, (e) => e.response.tracks.some((t) => t.status === 'CLASSIFIED'));
        this.ops.selectTrack('T-0417');
        setTimeout(() => this.fly([54.383, 24.524], 14.6, 55, 30, 2000), 100);
      },
    },
    {
      title: 'Approve response group',
      say: 'Assets READY → ACTIVE · coordinated escort',
      run: () => {
        const r = this.alerts.pending().find((x) => x.kind === 'RESPONSE_GROUP');
        if (r) this.alerts.approve(r);
        this.sim.speed.set(2);
      },
    },
    {
      title: 'TRACK RESOLVED',
      say: 'Mission intent → coordinated fleet behaviour',
      run: () => {
        this.sim.fastForward(1500, (e) => e.response.tracks.every((t) => t.status === 'RESOLVED'));
        this.sim.speed.set(1);
      },
    },
  ];

  go(i: number): void {
    if (i < 0 || i >= this.steps.length) return;
    this.index.set(i);
    this.steps[i].run();
  }

  next(): void {
    this.go(this.index() + 1);
  }
}
