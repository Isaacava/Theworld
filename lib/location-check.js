/**
 * Shared geographical checks for the prototype's presence-proximity gate.
 * This is a coarse presence signal, not anti-spoofing proof.
 */

/**
 * @param {unknown} longitude
 * @param {unknown} latitude
 * @returns {boolean}
 */
export function validCoordinates(longitude, latitude) {
  return typeof longitude === "number" &&
    typeof latitude === "number" &&
    Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 &&
    Number.isFinite(latitude) && latitude >= -90 && latitude <= 90;
}

/**
 * Calculate the great-circle distance between two [longitude, latitude] pairs.
 * @param {[number, number]} a
 * @param {[number, number]} b
 * @returns {number}
 */
export function haversineMeters(a, b) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const [longitudeA, latitudeA] = a;
  const [longitudeB, latitudeB] = b;
  const deltaLatitude = radians(latitudeB - latitudeA);
  const deltaLongitude = radians(longitudeB - longitudeA);
  const first = radians(latitudeA);
  const second = radians(latitudeB);
  const chord = Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(first) * Math.cos(second) * Math.sin(deltaLongitude / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(chord), Math.sqrt(Math.max(0, 1 - chord)));
}

/**
 * Coarse prototype radius chosen from the type supplied for a mapped place.
 * @param {string} kind
 * @returns {number}
 */
export function allowedRadius(kind) {
  const normalized = kind.toLowerCase();
  if (/street|road|path|highway/.test(normalized)) return 250;
  if (/building|restaurant|shop|amenity|venue|point of interest/.test(normalized)) return 180;
  if (/neighbourhood|neighborhood|suburb|village|district/.test(normalized)) return 1500;
  if (/city|town|municipality/.test(normalized)) return 8000;
  return 300;
}
