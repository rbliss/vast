/**
 * Micro-benchmark suite for terrain/erosion feature isolation.
 *
 * Small deterministic test cases for proving individual features
 * before testing on the full reference benchmark. Each case has:
 *   - A simple terrain shape targeting one specific behavior
 *   - Fixed camera position
 *   - Cheap/fast computation (256² grid, ±200 extent)
 *
 * Cases:
 *   1. single-notch — headward incision + rim attack
 *   2. double-notch — tributary competition / branching
 *   3. bowl-outlet — channel initiation thresholding
 *   4. trunk-widen — lateral erosion isolation
 *   5. piedmont — low-slope sinuosity (future)
 */

import { EditableHeightfield } from './editableHeightfield';

export interface MicroBenchmark {
  name: string;
  description: string;
  heightfield: EditableHeightfield;
  camera: { camX: number; camZ: number; clearance: number; tgtX: number; tgtZ: number; tgtClearance: number };
}

const GRID = 256;
const EXTENT = 200;

function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/** 1. Single escarpment notch — test headward incision + rim attack */
function singleNotch(): MicroBenchmark {
  const hf = new EditableHeightfield(GRID, EXTENT);
  const cs = (EXTENT * 2) / (GRID - 1);

  for (let gz = 0; gz < GRID; gz++) {
    for (let gx = 0; gx < GRID; gx++) {
      const wx = -EXTENT + gx * cs;
      const wz = -EXTENT + gz * cs;

      // Flat plateau in the back (z < 0), escarpment at z=0, low piedmont in front
      let h = 0;
      if (wz < -20) {
        h = 40; // plateau
      } else if (wz < 20) {
        h = 40 * smoothstep(1 - (wz + 20) / 40); // escarpment transition
      } else {
        h = Math.max(1, 5 - wz * 0.02); // gentle piedmont
      }

      // Single reentrant notch at x=0
      const notchDist = Math.abs(wx);
      if (notchDist < 30 && wz < 0) {
        const notchDepth = (1 - notchDist / 30) * 8;
        h -= notchDepth * smoothstep(1 - (wz + 60) / 60);
      }

      hf.grid[gz * GRID + gx] = Math.max(1, h);
    }
  }

  return {
    name: 'single-notch',
    description: 'Headward incision + rim attack from a single escarpment hollow',
    heightfield: hf,
    camera: { camX: 80, camZ: -80, clearance: 60, tgtX: 0, tgtZ: 0, tgtClearance: 15 },
  };
}

/** 2. Double-notch competition — test tributary branching */
function doubleNotch(): MicroBenchmark {
  const hf = new EditableHeightfield(GRID, EXTENT);
  const cs = (EXTENT * 2) / (GRID - 1);

  for (let gz = 0; gz < GRID; gz++) {
    for (let gx = 0; gx < GRID; gx++) {
      const wx = -EXTENT + gx * cs;
      const wz = -EXTENT + gz * cs;

      let h = 0;
      if (wz < -20) h = 40;
      else if (wz < 20) h = 40 * smoothstep(1 - (wz + 20) / 40);
      else h = Math.max(1, 5 - wz * 0.02);

      // Two adjacent notches at x=-40 and x=+40
      for (const nx of [-40, 40]) {
        const notchDist = Math.abs(wx - nx);
        if (notchDist < 25 && wz < 0) {
          const notchDepth = (1 - notchDist / 25) * 7;
          h -= notchDepth * smoothstep(1 - (wz + 50) / 50);
        }
      }

      hf.grid[gz * GRID + gx] = Math.max(1, h);
    }
  }

  return {
    name: 'double-notch',
    description: 'Tributary competition from two adjacent escarpment hollows',
    heightfield: hf,
    camera: { camX: 100, camZ: -80, clearance: 70, tgtX: 0, tgtZ: -10, tgtClearance: 15 },
  };
}

/** 3. Convergent bowl → outlet — test channel initiation */
function bowlOutlet(): MicroBenchmark {
  const hf = new EditableHeightfield(GRID, EXTENT);
  const cs = (EXTENT * 2) / (GRID - 1);

  for (let gz = 0; gz < GRID; gz++) {
    for (let gx = 0; gx < GRID; gx++) {
      const wx = -EXTENT + gx * cs;
      const wz = -EXTENT + gz * cs;

      // Bowl shape: center is low, edges are high
      const dist = Math.sqrt(wx * wx + wz * wz);
      const bowl = Math.min(30, dist * 0.2);

      // Single outlet breach at +x edge
      let outletLowering = 0;
      if (wx > 100 && Math.abs(wz) < 30) {
        outletLowering = 15 * smoothstep((wx - 100) / 80) * (1 - Math.abs(wz) / 30);
      }

      hf.grid[gz * GRID + gx] = Math.max(1, bowl - outletLowering + 5);
    }
  }

  return {
    name: 'bowl-outlet',
    description: 'Convergent bowl with single outlet — channel initiation test',
    heightfield: hf,
    camera: { camX: 100, camZ: 100, clearance: 80, tgtX: 0, tgtZ: 0, tgtClearance: 10 },
  };
}

/** 4. Trunk corridor widening — isolate lateral erosion */
function trunkWiden(): MicroBenchmark {
  const hf = new EditableHeightfield(GRID, EXTENT);
  const cs = (EXTENT * 2) / (GRID - 1);

  for (let gz = 0; gz < GRID; gz++) {
    for (let gx = 0; gx < GRID; gx++) {
      const wx = -EXTENT + gx * cs;
      const wz = -EXTENT + gz * cs;

      // Tilted plane with a pre-carved narrow channel along x-axis
      let h = 20 + wz * 0.05; // gentle slope in z direction

      // Pre-carved narrow channel along x=0
      const channelDist = Math.abs(wx);
      if (channelDist < 8) {
        h -= 10 * (1 - channelDist / 8); // V-channel, 10 units deep
      }

      hf.grid[gz * GRID + gx] = Math.max(1, h);
    }
  }

  return {
    name: 'trunk-widen',
    description: 'Pre-carved narrow channel — test lateral erosion widening',
    heightfield: hf,
    camera: { camX: 80, camZ: -80, clearance: 50, tgtX: 0, tgtZ: 0, tgtClearance: 10 },
  };
}

/** 5. Low-slope piedmont — future sinuosity test */
function piedmont(): MicroBenchmark {
  const hf = new EditableHeightfield(GRID, EXTENT);
  const cs = (EXTENT * 2) / (GRID - 1);

  for (let gz = 0; gz < GRID; gz++) {
    for (let gx = 0; gx < GRID; gx++) {
      const wx = -EXTENT + gx * cs;
      const wz = -EXTENT + gz * cs;

      // Very gentle slope with slight sinusoidal cross-slope variation
      let h = 15 - wz * 0.04; // gentle downslope toward +z
      h += Math.sin(wx * 0.03) * 2; // gentle cross-slope undulation

      hf.grid[gz * GRID + gx] = Math.max(1, h);
    }
  }

  return {
    name: 'piedmont',
    description: 'Low-slope terrain — future sinuosity / lateral migration test',
    heightfield: hf,
    camera: { camX: 100, camZ: -100, clearance: 60, tgtX: 0, tgtZ: 0, tgtClearance: 8 },
  };
}

/** All micro-benchmark cases */
export const MICRO_BENCHMARKS: Record<string, () => MicroBenchmark> = {
  'single-notch': singleNotch,
  'double-notch': doubleNotch,
  'bowl-outlet': bowlOutlet,
  'trunk-widen': trunkWiden,
  'piedmont': piedmont,
};

export function getMicroBenchmark(name: string): MicroBenchmark | null {
  const factory = MICRO_BENCHMARKS[name];
  return factory ? factory() : null;
}
