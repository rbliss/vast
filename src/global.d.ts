import type { TerrainApp } from './engine/TerrainApp';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { PerspectiveCamera, Scene } from 'three';

declare global {
  interface Window {
    __app?: TerrainApp;
    __controls?: OrbitControls;
    __camera?: PerspectiveCamera;
    __scene?: Scene;
  }
}
