// Stands in for ngraph.forcelayout, which three-forcegraph imports for its ngraph engine. This plugin runs the d3 engine only,
// and the real module builds its physics with new Function, which the community review flags.
export default function forcelayout(): never {
  throw new Error('The ngraph layout engine is not bundled with Tag Ontology.');
}
