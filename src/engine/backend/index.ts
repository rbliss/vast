/**
 * Backend factory — WebGPU only.
 */

import type { RendererBackend } from './types';

export type { RendererBackend };

export async function getBackend(): Promise<RendererBackend> {
  const { webgpuBackend } = await import('./webgpuBackend');
  return webgpuBackend;
}
