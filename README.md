# SuuarmOS — fleet C2 prototype (SUUARM Systems)

> The operator controls the mission. SuuarmOS controls the fleet.

Frontend-only Angular 22 demonstration of command, control and fleet orchestration for large autonomous drone operations. Everything (vehicles, telemetry, missions, sensors, alerts) is simulated locally and deterministically.

## Run

```bash
npm install
npm start          # http://localhost:4200  (ng serve)
npm test           # Vitest: simulation, mission engine, resilience, aerial response
npm run build      # production bundle in dist/
```

### Map data

MapTiler is used when a key is present, otherwise free no-key sources (OpenFreeMap vector + Esri imagery + AWS terrain), with an offline fallback.

1. Copy `public/config/runtime.example.json` to `public/config/runtime.json` (gitignored).
2. Put your MapTiler key in `maptilerKey`.

Imagery fallback (Esri World Imagery) is for internal demos only — check licensing before external use.

## Demo

Press **Ctrl + Shift + D** for the presenter panel. The **Story director** walks the full 2–3 minute demo in 17 one-click steps
(Ctrl + Shift + N = next step): Building Scan → 3D → plan → START → follow UAV-021 → sensor cone → Sensor POV → EO/THERMAL →
UAV-007 link lost → approve UAV-031 → fleet at scale → Airspace Response → approve group → TRACK RESOLVED.

Press **?** for keyboard shortcuts.

## Architecture

```
src/app/
  core/domain      domain types (Vehicle, Mission, Sector, Task, Sensor, Track, Alert, …)
  core/sim         deterministic engine (10 Hz, seeded RNG, command log), kinematics, fleet factory
  core/mission     planner (area / building), allocator, coverage, recommendations, aerial response
  core/sensor      gimbal pose → frustum → ray-cast footprint on terrain and structures
  core/world       local ENU frame, procedural campus
  core/scenarios   data-driven scenarios (Building Scan, Airspace Response)
  core/state       Angular signal stores (4 Hz UI views), roles
  map              MapLibre + deck.gl (MapLibreOverlay, interleaved), render loop (rAF), camera state machine,
                   layers, clustering, mini-maps (feeds / PIP), tools
  features         shell, fleet, missions, asset, sensor, POV HUD, alerts, track, demo
```

Rendering runs on requestAnimationFrame outside Angular change detection; the UI reads 4 Hz snapshots.
