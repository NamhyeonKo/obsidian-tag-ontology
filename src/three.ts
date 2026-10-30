// Everything the 3D view takes from three.js and 3d-force-graph. Only a 3D view opening imports this module, so the rest of
// the plugin loads without evaluating them (most of the bundle).
export { default as ForceGraph3D } from '3d-force-graph';
export { default as SpriteText } from 'three-spritetext';
export {
  BufferAttribute, BufferGeometry, Color, ConeGeometry, Fog, InstancedMesh, LineBasicMaterial, LineDashedMaterial, LineSegments, Mesh,
  MeshLambertMaterial, Object3D, SphereGeometry, Vector3,
} from 'three';
