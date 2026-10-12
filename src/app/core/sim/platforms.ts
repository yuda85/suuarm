import { FovMode, Payload, SensorType } from '../domain/sensor';
import { PlatformSpec, VehicleCapability } from '../domain/vehicle';

export const PLATFORMS = {
  SR4: {
    id: 'SR4',
    name: 'SR-4 Kestrel',
    airframe: 'QUAD',
    cruiseSpeed: 12,
    maxSpeed: 18,
    minSpeed: 0,
    maxTurnRate: 110,
    maxAccel: 4,
    maxClimb: 5,
    enduranceMin: 38,
    lengthM: 0.9,
  },
  SR6: {
    id: 'SR6',
    name: 'SR-6 Atlas',
    airframe: 'HEXA',
    cruiseSpeed: 11,
    maxSpeed: 16,
    minSpeed: 0,
    maxTurnRate: 85,
    maxAccel: 3,
    maxClimb: 4,
    enduranceMin: 46,
    lengthM: 1.4,
  },
  SV2: {
    id: 'SV2',
    name: 'SV-2 Shrike VTOL',
    airframe: 'VTOL',
    cruiseSpeed: 24,
    maxSpeed: 32,
    minSpeed: 17,
    maxTurnRate: 16,
    maxAccel: 2.5,
    maxClimb: 4,
    enduranceMin: 150,
    lengthM: 2.2,
  },
  SR8: {
    id: 'SR8',
    name: 'SR-8 Sentinel',
    airframe: 'HEXA',
    cruiseSpeed: 20,
    maxSpeed: 27,
    minSpeed: 0,
    maxTurnRate: 90,
    maxAccel: 5,
    maxClimb: 6,
    enduranceMin: 32,
    lengthM: 1.5,
  },
  SL1: {
    id: 'SL1',
    name: 'SL-1 Beacon Relay',
    airframe: 'RELAY',
    cruiseSpeed: 10,
    maxSpeed: 14,
    minSpeed: 0,
    maxTurnRate: 80,
    maxAccel: 3,
    maxClimb: 4,
    enduranceMin: 55,
    lengthM: 1.2,
  },
} as const satisfies Record<string, PlatformSpec>;

export type PlatformId = keyof typeof PLATFORMS;

/** Capability → platform + payload suite. */
export const CAPABILITY_LOADOUT: Record<VehicleCapability, { platform: PlatformId; sensors: SensorType[] }> = {
  ISR: { platform: 'SR4', sensors: ['EO', 'THERMAL'] },
  THERMAL: { platform: 'SR4', sensors: ['THERMAL', 'EO'] },
  INSPECTION: { platform: 'SR4', sensors: ['EO', 'IR'] },
  MAPPING: { platform: 'SR6', sensors: ['EO', 'IR'] },
  RESPONSE: { platform: 'SR8', sensors: ['EO', 'THERMAL'] },
  SEARCH: { platform: 'SV2', sensors: ['EO', 'THERMAL', 'RADAR'] },
  RELAY: { platform: 'SL1', sensors: ['EO'] },
};

const SENSOR_MODELS: Record<SensorType, { model: string; hfov: Record<FovMode, number>; aspect: number; rangeM: number }> = {
  EO: { model: 'EOS-30X Gimbal', hfov: { WFOV: 62, MFOV: 24, NFOV: 6 }, aspect: 16 / 9, rangeM: 900 },
  THERMAL: { model: 'LWIR-640', hfov: { WFOV: 50, MFOV: 24, NFOV: 9 }, aspect: 4 / 3, rangeM: 700 },
  IR: { model: 'SWIR-NIR 1280', hfov: { WFOV: 48, MFOV: 20, NFOV: 8 }, aspect: 5 / 4, rangeM: 650 },
  RADAR: { model: 'Ku-SAR/GMTI', hfov: { WFOV: 120, MFOV: 60, NFOV: 30 }, aspect: 4, rangeM: 3500 },
};

export function makePayloads(vehicleId: string, sensors: SensorType[]): Payload[] {
  return sensors.map((type) => {
    const m = SENSOR_MODELS[type];
    return {
      id: `${vehicleId}/${type}`,
      type,
      model: m.model,
      status: 'ONLINE',
      hfov: { ...m.hfov },
      fovMode: 'WFOV',
      aspect: m.aspect,
      rangeM: m.rangeM,
    };
  });
}

export const CALLSIGNS = [
  'FALCON', 'KESTREL', 'HAWK', 'OSPREY', 'HARRIER', 'MERLIN', 'SHRIKE', 'SWIFT',
  'TALON', 'CONDOR', 'RAVEN', 'EAGLE', 'HERON', 'SAKER', 'PEREGRINE', 'KITE',
] as const;
