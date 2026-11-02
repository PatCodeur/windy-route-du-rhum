// Rayon terrestre moyen IUGG, converti en milles nautiques (1 M = 1 852 m).
export const EARTH_RADIUS_NM = 6371008.8 / 1852;
const RADIANS = Math.PI / 180;

export function validPosition(point) {
    return Boolean(point && Number.isFinite(point.lat) && Math.abs(point.lat) <= 90 &&
        Number.isFinite(point.lon) && Math.abs(point.lon) <= 180);
}

/** Distance orthodromique directe sur la sphère terrestre moyenne, en milles nautiques. */
export function distanceNm(first, second) {
    if (!validPosition(first) || !validPosition(second)) return null;
    const latitude1 = first.lat * RADIANS;
    const latitude2 = second.lat * RADIANS;
    const latitudeDifference = (second.lat - first.lat) * RADIANS;
    // Le trajet le plus court traverse normalement le méridien 180°.
    const longitudeDifference = (((second.lon - first.lon + 540) % 360) - 180) * RADIANS;
    const haversine = Math.sin(latitudeDifference / 2) ** 2 +
        Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDifference / 2) ** 2;
    // Les arrondis peuvent dépasser 1 aux antipodes.
    const bounded = Math.max(0, Math.min(1, haversine));
    return 2 * EARTH_RADIUS_NM * Math.atan2(Math.sqrt(bounded), Math.sqrt(1 - bounded));
}
