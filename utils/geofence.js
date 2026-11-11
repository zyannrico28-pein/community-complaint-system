
/**
 * Checks whether GPS coordinates are inside
 * the configured Poblacion service boundary.
 *
 * Coordinates use longitude first, latitude second.
 *
 * IMPORTANT:
 * Replace the example boundary with the actual
 * geographic boundary of Poblacion, Cajidiocan.
 */

const POBLACION_BOUNDARY = {
  minLatitude: 12.30,
  maxLatitude: 12.40,
  minLongitude: 122.55,
  maxLongitude: 122.70
};

function isInsidePoblacion(longitude, latitude) {
  return (
    Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    latitude >= POBLACION_BOUNDARY.minLatitude &&
    latitude <= POBLACION_BOUNDARY.maxLatitude &&
    longitude >= POBLACION_BOUNDARY.minLongitude &&
    longitude <= POBLACION_BOUNDARY.maxLongitude
  );
}

module.exports = { isInsidePoblacion };

