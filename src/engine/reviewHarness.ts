/**
 * Clay-mode review harness.
 *
 * Fixed, named camera views for reproducible terrain shape evaluation.
 * Each view is terrain-aware (samples ground height for safe placement).
 * Used to establish baselines and judge shape improvements.
 */

import type { TerrainSource } from './terrain/terrainSource';

export interface ReviewView {
  /** Unique name for this view */
  name: string;
  /** What this view is meant to judge */
  judges: string;
  /** Camera world XZ position */
  camX: number;
  camZ: number;
  /** Height above terrain at camera position */
  clearance: number;
  /** Look-at target world XZ */
  tgtX: number;
  tgtZ: number;
  /** Target Y offset above terrain at target position */
  tgtClearance: number;
}

export interface ReviewPreset {
  preset: string;
  views: ReviewView[];
}

export const REVIEW_PRESETS: ReviewPreset[] = [
  {
    preset: 'chain',
    views: [
      {
        name: 'chain-wide',
        judges: 'Overall mountain composition, ridge/valley hierarchy, drainage organization',
        camX: 120, camZ: 120, clearance: 60,
        tgtX: 0, tgtZ: 0, tgtClearance: 5,
      },
      {
        name: 'chain-grazing',
        judges: 'Ridge definition, channel detail, slope character, erosion texture',
        camX: 80, camZ: 80, clearance: 15,
        tgtX: 0, tgtZ: 0, tgtClearance: 10,
      },
      {
        name: 'chain-channel-exit',
        judges: 'Fan/apron formation, channel-to-lowland transition, deposition readability',
        camX: 50, camZ: 70, clearance: 25,
        tgtX: -10, tgtZ: 30, tgtClearance: 5,
      },
    ],
  },
  {
    preset: 'basin',
    views: [
      {
        name: 'basin-wide',
        judges: 'Basin form, rim structure, interior drainage, depositional floor',
        camX: 110, camZ: 110, clearance: 70,
        tgtX: 0, tgtZ: 0, tgtClearance: 5,
      },
      {
        name: 'basin-rim',
        judges: 'Rim erosion, inner wall channels, mass-wasting signatures, rim-to-floor transition',
        camX: 50, camZ: 60, clearance: 30,
        tgtX: 0, tgtZ: 0, tgtClearance: 10,
      },
    ],
  },
  {
    preset: 'plateau',
    views: [
      {
        name: 'plateau-escarpment',
        judges: 'Escarpment realism, cliff definition, mesa-top flatness, butte isolation',
        camX: 70, camZ: 80, clearance: 25,
        tgtX: 10, tgtZ: 0, tgtClearance: 10,
      },
      {
        name: 'plateau-wide',
        judges: 'Mesa composition, lowland organization, escarpment-base debris/transition',
        camX: 130, camZ: 130, clearance: 50,
        tgtX: 20, tgtZ: 10, tgtClearance: 5,
      },
    ],
  },
];

/**
 * Compute safe camera position for a review view.
 * Samples terrain height at camera and target XZ positions.
 */
export function computeReviewCamera(
  view: ReviewView,
  terrain: TerrainSource,
): { camPos: [number, number, number]; tgtPos: [number, number, number] } {
  const camGroundH = terrain.sampleHeight(view.camX, view.camZ);
  const tgtGroundH = terrain.sampleHeight(view.tgtX, view.tgtZ);

  return {
    camPos: [view.camX, camGroundH + view.clearance, view.camZ],
    tgtPos: [view.tgtX, tgtGroundH + view.tgtClearance, view.tgtZ],
  };
}
