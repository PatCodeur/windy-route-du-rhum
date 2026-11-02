/** Vitesses sur la trace enregistrée, rapportées à des fenêtres complètes. */
import { distanceNm } from './classMetrics.js';
import { sampleFleet, traceAtTime } from './timeNavigation.js';

const HOUR_MS = 3600000;
const DEFAULT_HOURS = [4, 24, 48];
const DEFAULT_MAX_GAP_HOURS = 2.5;

function utcMilliseconds(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) {
        return null;
    }
    const milliseconds = Date.parse(value);
    if (!Number.isFinite(milliseconds)) return null;
    const expanded = value.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction) =>
        `.${(fraction || '').padEnd(3, '0')}Z`);
    return new Date(milliseconds).toISOString() === expanded ? milliseconds : null;
}

function unavailable(hours, reason, from = null, to = null) {
    return { hours, speedKnots: null, distanceNm: null, reason, from, to, interpolatedBoundary: false };
}

/**
 * Somme des distances entre positions successives / durée de la fenêtre.
 * L'ancrage est l'heure de la position affichée, y compris pendant le rejeu.
 * Les bornes entre relevés utilisent le même grand cercle que les bateaux.
 * Aucun résultat partiel ni extrapolation ; un trou > maxGapHours invalide
 * seulement les fenêtres qu'il intersecte. Les vitesses instantanées du flux
 * n'interviennent pas dans ce calcul.
 */
export function averageSpeeds(history, boat, { hours = DEFAULT_HOURS, maxGapHours = DEFAULT_MAX_GAP_HOURS } = {}) {
    const windows = Array.isArray(hours) ? hours : DEFAULT_HOURS;
    const end = utcMilliseconds(boat?.positionTime ?? boat?.time);
    if (end === null) return windows.map(duration => unavailable(duration, 'invalid-time'));

    const to = new Date(end).toISOString();
    const source = Number.isSafeInteger(boat?.id) && boat.id > 0 ? history?.tracks?.[boat.id] : null;
    const track = Array.isArray(source) ? source : [];
    const times = track.map(point => utcMilliseconds(point?.time));
    const invalidTimes = times.some(time => time === null);
    const invalidTrack = track.some((point, index) => distanceNm(point, point) === null ||
        (index > 0 && times[index] <= times[index - 1]));
    const gapLimit = (typeof maxGapHours === 'number' && maxGapHours > 0 ?
        maxGapHours : DEFAULT_MAX_GAP_HOURS) * HOUR_MS;

    return windows.map(duration => {
        const start = end - duration * HOUR_MS;
        if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0 ||
            !Number.isFinite(start) || Math.abs(start) > 8.64e15) {
            return unavailable(duration, 'invalid-time');
        }
        const from = new Date(start).toISOString();
        if (invalidTimes) return unavailable(duration, 'invalid-time', from, to);
        if (track.length < 2 || start < times[0] || end > times.at(-1)) {
            return unavailable(duration, 'insufficient-history', from, to);
        }
        if (invalidTrack) return unavailable(duration, 'data-gap', from, to);
        for (let index = 1; index < times.length; index++) {
            // Un trou qui s'arrête au début ou commence à la fin reste hors fenêtre.
            if (times[index - 1] < end && times[index] > start &&
                times[index] - times[index - 1] > gapLimit) {
                return unavailable(duration, 'data-gap', from, to);
            }
        }

        // Limiter l'historique au bateau évite de recalculer toute la flotte.
        const ownHistory = { tracks: { [boat.id]: track } };
        const [first] = sampleFleet(ownHistory, start);
        const past = traceAtTime(ownHistory, boat.id, end);
        const vertices = [first, ...past.filter(point =>
            Date.parse(point.positionTime ?? point.time) > start)];
        let distance = 0;
        for (let index = 1; index < vertices.length; index++) {
            const segment = distanceNm(vertices[index - 1], vertices[index]);
            if (segment === null || !Number.isFinite(segment)) {
                return unavailable(duration, 'data-gap', from, to);
            }
            distance += segment;
        }
        return {
            hours: duration,
            speedKnots: distance / duration,
            distanceNm: distance,
            reason: null,
            from,
            to,
            interpolatedBoundary: Boolean(first.interpolated || vertices.at(-1).interpolated),
        };
    });
}
