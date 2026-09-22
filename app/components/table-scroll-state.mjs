// @ts-check

const MIN_THUMB_WIDTH = 32;

/** @param {number} value */
function finiteNonNegative(value) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * @typedef {{ max: number, position: number, thumb: number }} TableScrollState
 * @typedef {{ scrollLeft: number, scrollWidth: number, clientWidth: number }} ScrollMeasurements
 */

/** @param {ScrollMeasurements} measurements @returns {TableScrollState} */
export function measureTableScroll({ scrollLeft, scrollWidth, clientWidth }) {
  const width = finiteNonNegative(clientWidth);
  const contentWidth = finiteNonNegative(scrollWidth);
  const max = width > 0 ? Math.max(0, contentWidth - width) : 0;
  const position = Math.min(finiteNonNegative(scrollLeft), max);
  const trackWidth = Math.max(0, width - MIN_THUMB_WIDTH);
  const proportionalThumb = contentWidth > 0 ? Math.round(trackWidth * width / contentWidth) : trackWidth;
  const thumb = Math.min(trackWidth, Math.max(Math.min(MIN_THUMB_WIDTH, trackWidth), proportionalThumb));

  return { max, position, thumb };
}

/** @param {TableScrollState} current @param {number} requestedPosition @returns {TableScrollState} */
export function updateTableScrollPosition(current, requestedPosition) {
  const position = Math.min(finiteNonNegative(requestedPosition), current.max);
  return position === current.position ? current : { ...current, position };
}

/** @param {ScrollMeasurements} viewport @param {number} requestedPosition */
export function setTableScrollPosition(viewport, requestedPosition) {
  const { position } = measureTableScroll({
    scrollLeft: requestedPosition,
    scrollWidth: viewport.scrollWidth,
    clientWidth: viewport.clientWidth,
  });

  if (viewport.scrollLeft !== position) viewport.scrollLeft = position;
  return position;
}
