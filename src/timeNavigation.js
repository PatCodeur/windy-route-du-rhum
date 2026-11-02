/** Navigation temporelle : interpolation entre relevés, sans extrapolation. */

const radians = Math.PI / 180;
const degrees = 180 / Math.PI;

function timestamp(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 8.64e15) {
        throw new Error('Une heure UTC valide, en millisecondes, est attendue.');
    }
    return value;
}

function iso(value) {
    return new Date(value).toISOString();
}

// Première observation strictement après l’heure demandée.
function after(track, time) {
    let low = 0;
    let high = track.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (Date.parse(track[middle].time) <= time) low = middle + 1;
        else high = middle;
    }
    return low;
}

function vector(point) {
    const latitude = point.lat * radians;
    const longitude = point.lon * radians;
    return [Math.cos(latitude) * Math.cos(longitude), Math.cos(latitude) * Math.sin(longitude), Math.sin(latitude)];
}

function dot(a, b) {
    return a.reduce((total, value, index) => total + value * b[index], 0);
}

function normalize(values) {
    const length = Math.hypot(...values);
    return values.map(value => value / length);
}

/** Arc de grand cercle le plus court, y compris au passage de l’antiméridien. */
function interpolateCoordinates(previous, next, fraction) {
    const start = vector(previous);
    const end = vector(next);
    const cosine = Math.max(-1, Math.min(1, dot(start, end)));
    let result;
    if (cosine > 1 - 1e-12) {
        result = normalize(start.map((value, index) => value + fraction * (end[index] - value)));
    } else {
        // La tangente conserve la direction de l’arc, même très près d’un antipode.
        let tangent = end.map((value, index) => value - cosine * start[index]);
        if (Math.hypot(...tangent) < 1e-12) {
            // Pour deux antipodes exacts, plusieurs arcs équivalents existent.
            // Ce choix déterministe évite toute division par zéro.
            const axis = start.map(Math.abs).indexOf(Math.min(...start.map(Math.abs)));
            const basis = start.map((_, index) => index === axis ? 1 : 0);
            const projection = dot(basis, start);
            tangent = basis.map((value, index) => value - projection * start[index]);
        }
        tangent = normalize(tangent);
        const angle = Math.acos(cosine) * fraction;
        result = start.map((value, index) => value * Math.cos(angle) + tangent[index] * Math.sin(angle));
    }
    return {
        lat: Math.atan2(result[2], Math.hypot(result[0], result[1])) * degrees,
        lon: Math.atan2(result[1], result[0]) * degrees,
    };
}

function observed(point, next, time) {
    return {
        ...point,
        positionTime: point.time,
        interpolated: false,
        nextObservationTime: next?.time ?? null,
        historyBoundary: !next && time > Date.parse(point.time) ? 'after' : null,
    };
}

function sampleTrack(track, time, interpolate) {
    const end = after(track, time);
    if (end === 0) return null;
    const previous = track[end - 1];
    const next = track[end];
    const position = observed(previous, next, time);
    const previousTime = Date.parse(previous.time);
    if (!interpolate || !next || time === previousTime) return position;
    const fraction = (time - previousTime) / (Date.parse(next.time) - previousTime);
    Object.assign(position, interpolateCoordinates(previous, next, fraction));
    if (Number.isFinite(previous.heading) && Number.isFinite(next.heading)) {
        const difference = ((next.heading - previous.heading + 540) % 360) - 180;
        position.heading = ((previous.heading + difference * fraction) % 360 + 360) % 360;
    }
    if (Number.isFinite(previous.speed) && Number.isFinite(next.speed)) {
        position.speed = previous.speed + (next.speed - previous.speed) * fraction;
    }
    position.positionTime = iso(time);
    position.interpolated = true;
    return position;
}

/**
 * Heure bornée par l’historique et index du dernier relevé global antérieur.
 * Un historique vide donne time:null et index:-1.
 */
export function timelineState(history, timestampMs) {
    const requested = timestamp(timestampMs);
    const requestedTime = iso(requested);
    if (!history.oldest || !history.newest) {
        return { time: null, outside: null, index: -1, requestedTime };
    }
    const oldest = Date.parse(history.oldest);
    const newest = Date.parse(history.newest);
    const bounded = Math.max(oldest, Math.min(newest, requested));
    const outside = requested < oldest ? 'before' : requested > newest ? 'after' : null;
    const index = after(history.times.map(time => ({ time })), bounded) - 1;
    return { time: iso(bounded), outside, index, requestedTime };
}

/**
 * Flotte à une heure précise : aucun bateau avant son premier relevé.
 * `time` reste l’heure de la source; `positionTime` désigne la position calculée.
 * Après le dernier point, conserve celui-ci avec historyBoundary:'after'.
 */
export function sampleFleet(history, timestampMs, { interpolate = true } = {}) {
    const time = timestamp(timestampMs);
    return Object.values(history.tracks).map(track => sampleTrack(track, time, interpolate)).filter(Boolean);
}

/** Trace limitée au passé, avec au plus un point interpolé à son extrémité. */
export function traceAtTime(history, id, timestampMs, { interpolate = true } = {}) {
    const time = timestamp(timestampMs);
    const track = history.tracks[id] || [];
    const end = after(track, time);
    const trace = track.slice(0, end).map((point, index) => observed(point, track[index + 1], time));
    const current = sampleTrack(track, time, interpolate);
    if (current?.interpolated) trace.push(current);
    return trace;
}
