// Stands in for three/webgpu, which three-render-objects imports for a WebGPU renderer this plugin never asks for (it uses
// WebGL). Bundling the real module would add about 0.6 MB to main.js.
export class WebGPURenderer {
  constructor() { throw new Error('The WebGPU renderer is not bundled with Tag Ontology.'); }
}
