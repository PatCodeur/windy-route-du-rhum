import { EARTH_RADIUS_NM, distanceNm, validPosition } from './geodesy.js';

/**
 * IC Route du Rhum – Destination Guadeloupe 2026, avenants 1 et 2 intégrés,
 * article 10.1, page 12/38. Coordonnées WGS84 publiées en degrés et minutes.
 * Les points du couloir d'arrivée de l'annexe 3C ne sont pas les bornes de la ligne.
 */
export const FINISH_LINE = Object.freeze({
    east: Object.freeze({ lat: 16 + 12 / 60, lon: -(61 + 30.800 / 60) }),
    west: Object.freeze({ lat: 16 + 12 / 60, lon: -(61 + 31.050 / 60) }),
    sourceUrl: 'https://drive.google.com/drive/folders/1w-ta8Ft2qhS-0ptSh9nnhgYFcZa63Aj5',
    sourceReference: 'IC 2026, article 10.1, page 12/38 (avenants 1 et 2 intégrés)',
});

const RADIANS = Math.PI / 180;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const magnitude = vector => Math.hypot(...vector);
const scale = (vector, factor) => vector.map(component => component * factor);
const angle = (a, b) => Math.atan2(magnitude(cross(a, b)), dot(a, b));

function unitVector(point) {
    const latitude = point.lat * RADIANS;
    const longitude = point.lon * RADIANS;
    return [Math.cos(latitude) * Math.cos(longitude),
        Math.cos(latitude) * Math.sin(longitude), Math.sin(latitude)];
}

/**
 * Plus courte distance orthodromique au segment fini du petit arc start–end.
 * Hors du segment, la borne la plus proche est retenue, jamais son prolongement.
 * Aucune route imposée, terre, marque de parcours ou arrivée n'est déduite ici.
 */
export function distanceToLineSegmentNm(point, start, end) {
    if (![point, start, end].every(validPosition)) return null;
    const endpointDistance = Math.min(distanceNm(point, start), distanceNm(point, end));
    if (endpointDistance === 0) return 0;
    const p = unitVector(point);
    const a = unitVector(start);
    const b = unitVector(end);
    const normal = cross(a, b);
    const normalLength = magnitude(normal);
    // Des bornes confondues ou antipodales ne définissent pas un petit arc unique.
    if (normalLength < 1e-15) return endpointDistance;
    const n = scale(normal, 1 / normalLength);
    const projection = p.map((component, index) => component - dot(p, n) * n[index]);
    const projectionLength = magnitude(projection);
    if (projectionLength < 1e-15) return endpointDistance;
    const foot = scale(projection, 1 / projectionLength);
    const arcLength = angle(a, b);
    let distance = endpointDistance;
    for (const candidate of [foot, scale(foot, -1)]) {
        // Tolérance angulaire pour les seuls arrondis des produits vectoriels.
        if (angle(a, candidate) + angle(candidate, b) <= arcLength + 1e-10) {
            distance = Math.min(distance, angle(p, candidate) * EARTH_RADIUS_NM);
        }
    }
    return distance < 1e-10 ? 0 : distance;
}

/** Distance géométrique à la ligne officielle ; ce n'est pas une DTF officielle de course. */
export function distanceToFinishNm(point) {
    return distanceToLineSegmentNm(point, FINISH_LINE.east, FINISH_LINE.west);
}
