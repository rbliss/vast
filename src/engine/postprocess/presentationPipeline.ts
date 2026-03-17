/**
 * Presentation rendering pipeline.
 *
 * Wraps the WebGPU renderer with RenderPipeline + TSL post-processing.
 * When enabled, replaces direct renderer.render() with a pass-based
 * pipeline that supports bloom, vignette, and other effects.
 *
 * Can be toggled at runtime — falls back to direct rendering when off.
 */

// @ts-nocheck — WebGPU/TSL types
import type { Scene, PerspectiveCamera } from 'three';

export interface PresentationConfig {
  bloom: {
    enabled: boolean;
    strength: number;
    radius: number;
    threshold: number;
  };
}

export const DEFAULT_PRESENTATION: PresentationConfig = {
  bloom: {
    enabled: true,
    strength: 0.35,
    radius: 0.4,
    threshold: 0.82,
  },
};

export interface PresentationPipeline {
  /** Render a frame through the post-processing pipeline */
  render(scene: Scene, camera: PerspectiveCamera): void;
  /** Update bloom parameters */
  setBloom(strength: number, radius: number, threshold: number): void;
  /** Whether the pipeline is active */
  active: boolean;
}

/**
 * Create the presentation pipeline.
 * Must be called after the WebGPU renderer is initialized.
 *
 * @param renderer The actual WebGPU renderer (not RendererLike — needs full API)
 * @param config Initial post-processing configuration
 */
export async function createPresentationPipeline(
  renderer: any,
  config: PresentationConfig = DEFAULT_PRESENTATION,
): Promise<PresentationPipeline> {
  // Dynamic imports for WebGPU-specific modules
  const { RenderPipeline, pass } = await import('three/webgpu');
  const { bloom } = await import('three/addons/tsl/display/BloomNode.js');

  let pipeline: any = null;
  let bloomStrength = config.bloom.strength;
  let bloomRadius = config.bloom.radius;
  let bloomThreshold = config.bloom.threshold;
  let bloomEnabled = config.bloom.enabled;
  let currentScene: Scene | null = null;
  let currentCamera: PerspectiveCamera | null = null;

  function buildPipeline(scene: Scene, camera: PerspectiveCamera) {
    pipeline = new RenderPipeline(renderer);

    const scenePass = pass(scene, camera);
    const sceneColor = scenePass.getTextureNode('output');

    if (bloomEnabled) {
      const bloomPass = bloom(sceneColor, bloomStrength, bloomRadius, bloomThreshold);
      pipeline.outputNode = sceneColor.add(bloomPass);
    } else {
      pipeline.outputNode = sceneColor;
    }

    currentScene = scene;
    currentCamera = camera;
    console.log(`[postprocess] pipeline built (bloom: ${bloomEnabled ? 'on' : 'off'})`);
  }

  return {
    active: true,

    render(scene: Scene, camera: PerspectiveCamera) {
      // Rebuild pipeline if scene/camera changed or not yet built
      if (!pipeline || scene !== currentScene || camera !== currentCamera) {
        buildPipeline(scene, camera);
      }

      try {
        pipeline.renderAsync();
      } catch (e) {
        // Fallback to direct rendering if pipeline fails
        console.warn('[postprocess] pipeline error, falling back to direct render:', e);
        renderer.render(scene, camera);
      }
    },

    setBloom(strength: number, radius: number, threshold: number) {
      bloomStrength = strength;
      bloomRadius = radius;
      bloomThreshold = threshold;
      // Force pipeline rebuild on next frame
      pipeline = null;
    },
  };
}
