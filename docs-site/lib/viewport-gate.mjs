/** @typedef {{ x: number, y: number, zoom: number }} DiagramViewport */

/** @param {DiagramViewport} actual @param {DiagramViewport} expected */
export function viewportMatches(actual, expected) {
  return Math.abs(actual.x - expected.x) <= 0.5
    && Math.abs(actual.y - expected.y) <= 0.5
    && Math.abs(actual.zoom - expected.zoom) <= 0.0005;
}

/** @param {DiagramViewport | null} previous @param {DiagramViewport} next */
export function viewportTargetChanged(previous, next) {
  return previous === null || !viewportMatches(previous, next);
}

/**
 * @param {{ width: number, height: number }} canvas
 * @param {{ x: number, y: number, width: number, height: number }} content
 * @param {number} [padding]
 * @returns {DiagramViewport}
 */
export function fitViewport(canvas, content, padding = 0.055) {
  const zoom = Math.min(
    1.2,
    Math.max(
      0.08,
      Math.min(
        canvas.width * (1 - padding * 2) / content.width,
        canvas.height * (1 - padding * 2) / content.height,
      ),
    ),
  );
  return {
    x: canvas.width / 2 - (content.x + content.width / 2) * zoom,
    y: canvas.height / 2 - (content.y + content.height / 2) * zoom,
    zoom,
  };
}

/**
 * @param {{ width: number, height: number }} canvas
 * @param {{ x: number, y: number, width: number, height: number }} target
 * @param {number} minimumZoom
 * @returns {DiagramViewport}
 */
export function focusViewport(canvas, target, minimumZoom) {
  const zoom = Math.min(
    1.15,
    Math.max(
      minimumZoom + 0.14,
      Math.min(canvas.width * 0.78 / target.width, canvas.height * 0.7 / target.height),
    ),
  );
  return {
    x: canvas.width / 2 - (target.x + target.width / 2) * zoom,
    y: canvas.height / 2 - (target.y + target.height / 2) * zoom,
    zoom,
  };
}

/**
 * @param {DiagramViewport} reported
 * @param {DiagramViewport} applied
 * @param {DiagramViewport} target
 */
export function edgePathsMatch(renderedEdges, expectedEdgeIds) {
  if (expectedEdgeIds.length === 0 || renderedEdges.length !== expectedEdgeIds.length) return false;
  const renderedById = new Map(renderedEdges.map((edge) => [edge.id, edge.path]));
  return renderedById.size === renderedEdges.length
    && expectedEdgeIds.every((edgeId) => Boolean(renderedById.get(edgeId)));
}

export function flowFrameReady(applied, target, renderedEdges, expectedEdgeIds) {
  return edgePathsMatch(renderedEdges, expectedEdgeIds)
    && viewportMatches(applied, target);
}

/**
 * @typedef {{ signature: string | null, count: number }} StableFrameState
 * @param {StableFrameState} previous
 * @param {string} signature
 * @param {boolean} ready
 * @returns {StableFrameState}
 */
export function advanceStableFrame(previous, signature, ready) {
  if (!ready) return { signature: null, count: 0 };
  return {
    signature,
    count: previous.signature === signature ? previous.count + 1 : 1,
  };
}
