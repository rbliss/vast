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
  coarseGridSize: 512,         // AE1a.6: higher res — preserve rim hollows better
  fixedPointIterations: 10,
  age: 8.0,                  // AE1a.8: moderate — visible channels without cutting through
  erosionK: 0.012,           // AE1a.8: moderate K
  areaExponent: 0.4,
  slopeExponent: 1.3,        // AE1a.3: focusing slope exponent — concentrates channels
  blendStrength: 0.85,       // AE1a.3: strong direct blend
  smoothingPasses: 1,        // AE1a.3: minimal smoothing — keep the analytical structure
};
