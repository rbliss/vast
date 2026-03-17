/**
 * Backend factory — returns the appropriate renderer backend.
 */

import type { RendererBackend, RendererMode } from './types';
import { webglBackend } from './webglBackend';

export type { RendererBackend, RendererMode };

export async function getBackend(mode: RendererMode): Promise<RendererBackend> {
  if (mode === 'webgpu') {
    try {
      const { webgpuBackend } = await import('./webgpuBackend');
      return webgpuBackend;
    } catch (err) {
      console.warn('[backend] WebGPU not available, falling back to WebGL:', err);
      return webglBackend;
    }
  }
  return webglBackend;
}
