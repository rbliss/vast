/**
 * Types for the analytical coarse fluvial prepass.
 *
 * AE1a: benchmark-only, single-scale, clean-room implementation
 * based on stream-power / upstream-ordered implicit elevation solve.
 */

export interface AnalyticalPrepassConfig {
  enabled: boolean;
  /** Coarse grid size (e.g. 256) */
  coarseGridSize: number;
  /** Number of fixed-point coupling iterations (drainage ↔ elevation) */
  fixedPointIterations: number;
  /** Normalized erosion age — higher = more dissection */
  age: number;
  /** Erosion coefficient for the analytical solve */
  erosionK: number;
  /** Area exponent m in E = K * A^m * S^n */
  areaExponent: number;
  /** Slope exponent n */
  slopeExponent: number;
  /** Blend factor: 0 = all original, 1 = all analytical */
  blendStrength: number;
  /** Number of post-solve smoothing passes */
  smoothingPasses: number;
}

export const DEFAULT_ANALYTICAL_PREPASS: AnalyticalPrepassConfig = {
  enabled: true,
  coarseGridSize: 384,       // AE1a tuning: higher res to reduce coarse-grid striping
  fixedPointIterations: 6,
  age: 1.0,
  erosionK: 0.0008,
  areaExponent: 0.4,
  slopeExponent: 1.0,
  blendStrength: 0.55,       // AE1a tuning: reduced to keep backbone without over-imprint
  smoothingPasses: 3,        // AE1a tuning: soften coarse artifacts
};
