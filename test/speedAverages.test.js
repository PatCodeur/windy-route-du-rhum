import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHistory } from '../src/history.js';
import { distanceNm } from '../src/classMetrics.js';
import { sampleFleet } from '../src/timeNavigation.js';
import { averageSpeeds } from '../src/speedAverages.js';
import snapshot from '../src/historySnapshot.js';

const base = Date.parse('2026-11-01T00:00:00.000Z');
const time = hours => new Date(base + hours * 3600000).toISOString();
const point = (hours, overrides = {}) => ({ id: 1, time: time(hours), lat: 0, lon: hours,
    heading: 90, speed: 999, ...overrides });
const historyFrom = points => buildHistory(points.map(value => [value]));
const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance,
    `${actual} devrait être proche de ${expected}`);

test('Additionne les segments d’un parcours avec virage, sans utiliser déplacement net ni vitesse instantanée', () => {
    const points = [point(0, { lon: 0 }), point(2, { lat: 1, lon: 0 }), point(4, { lon: 0 })];
    const history = historyFrom(points);
    const before = JSON.stringify(history);
    const [average] = averageSpeeds(history, points.at(-1));
    const travelled = distanceNm(points[0], points[1]) + distanceNm(points[1], points[2]);
    close(average.distanceNm, travelled);
    close(average.speedKnots, travelled / 4);
    assert.ok(average.speedKnots > 0);
    assert.equal(distanceNm(points[0], points.at(-1)), 0);
    assert.equal(average.reason, null);
    assert.equal(average.from, time(0));
    assert.equal(average.to, time(4));
    assert.equal(average.interpolatedBoundary, false);
    assert.equal(JSON.stringify(history), before);
});

test('Respecte les heures irrégulières : somme des distances / durée complète', () => {
    const points = [point(0), point(0.5, { lon: 1 }), point(2, { lon: 2 }), point(4, { lon: 4 })];
    const history = historyFrom(points);
    const [average] = averageSpeeds(history, points.at(-1));
    close(average.speedKnots, distanceNm(points[0], points.at(-1)) / 4);
    // Une moyenne simple des vitesses des trois segments donnerait une autre valeur.
    const wrongMean = (distanceNm(points[0], points[1]) / 0.5 +
        distanceNm(points[1], points[2]) / 1.5 + distanceNm(points[2], points[3]) / 2) / 3;
    assert.ok(Math.abs(average.speedKnots - wrongMean) > 5);
});

test('Découpe précisément les deux bornes entre observations et suit positionTime en rejeu', () => {
    const history = historyFrom([point(0), point(2), point(4), point(6)]);
    const [boat] = sampleFleet(history, base + 5 * 3600000);
    assert.equal(boat.time, time(4));
    const [average] = averageSpeeds(history, boat);
    close(average.distanceNm, distanceNm(point(1), point(5)));
    close(average.speedKnots, distanceNm(point(0), point(1)));
    assert.equal(average.from, time(1));
    assert.equal(average.to, time(5));
    assert.equal(average.interpolatedBoundary, true);
});

test('Découpe le grand cercle à haute latitude et traverse correctement l’antiméridien', () => {
    const history = historyFrom([point(0, { lat: 60, lon: 179 }), point(2, { lat: 60, lon: -179 })]);
    const [boat] = sampleFleet(history, base + 1.5 * 3600000);
    const [average] = averageSpeeds(history, boat, { hours: [1] });
    close(average.distanceNm, distanceNm(history.tracks[1][0], history.tracks[1][1]) / 2, 1e-6);
    assert.equal(average.interpolatedBoundary, true);
});

test('Un bateau immobile a une moyenne nulle, distincte d’une valeur indisponible', () => {
    const points = [point(0, { lon: 5 }), point(2, { lon: 5 }), point(4, { lon: 5 })];
    const [average] = averageSpeeds(historyFrom(points), points.at(-1));
    assert.equal(average.speedKnots, 0);
    assert.equal(average.distanceNm, 0);
    assert.equal(average.reason, null);
});

test('Refuse les fenêtres incomplètes et produit 4, 24 et 48 heures dans cet ordre', () => {
    const points = Array.from({ length: 30 }, (_, hour) => point(hour));
    const result = averageSpeeds(historyFrom(points), points.at(-1));
    assert.deepEqual(result.map(value => value.hours), [4, 24, 48]);
    assert.deepEqual(result.map(value => value.reason), [null, null, 'insufficient-history']);
    assert.equal(result[2].speedKnots, null);
    assert.equal(result[2].distanceNm, null);
    assert.equal(result[2].from, time(-19));
    assert.equal(result[2].to, time(29));
});

test('Calcule aussi 48 heures dès que la fenêtre entière est couverte', () => {
    const points = Array.from({ length: 49 }, (_, hour) => point(hour));
    // Un relevé importé deux fois reste une observation unique dans l’historique.
    const history = historyFrom([...points, point(12)]);
    const expected = distanceNm(point(0), point(1));
    for (const average of averageSpeeds(history, points.at(-1))) {
        assert.equal(average.reason, null);
        close(average.speedKnots, expected);
        close(average.distanceNm, expected * average.hours);
        assert.equal(average.from, time(48 - average.hours));
        assert.equal(average.to, time(48));
    }
});

test('N’extrapole ni avant le premier point ni après le dernier et accepte la borne exacte', () => {
    const points = [point(0), point(2), point(4)];
    const history = historyFrom(points);
    assert.equal(averageSpeeds(history, { ...point(5) })[0].reason, 'insufficient-history');
    assert.equal(averageSpeeds(history, { ...point(1) })[0].reason, 'insufficient-history');
    assert.equal(averageSpeeds(history, points.at(-1))[0].reason, null);
    // La position figée sur le dernier point conserve la fenêtre de ce point.
    const [held] = sampleFleet(history, base + 10 * 3600000);
    assert.equal(held.historyBoundary, 'after');
    assert.equal(averageSpeeds(history, held)[0].to, time(4));
});

test('Refuse un grand trou qui intersecte la fenêtre, y compris une borne interpolée', () => {
    const points = [point(0), point(4), point(5), point(6), point(7)];
    const history = historyFrom(points);
    const [average] = averageSpeeds(history, points.at(-1));
    assert.equal(average.reason, 'data-gap');
    assert.equal(average.speedKnots, null);
    assert.equal(average.distanceNm, null);
    assert.equal(averageSpeeds(history, points.at(-1), { maxGapHours: 4 })[0].reason, null);
});

test('Un trou hors de la fenêtre ne la rend pas indisponible', () => {
    const points = [point(0), point(10), point(12), point(14), point(20)];
    const history = historyFrom(points);
    const [average] = averageSpeeds(history, point(14));
    assert.equal(average.reason, null);
    close(average.distanceNm, distanceNm(point(10), point(14)));
});

test('Accepte exactement 2,5 heures d’écart, refuse au-delà avec une limite configurable', () => {
    const points = [point(0), point(2.5), point(4)];
    const history = historyFrom(points);
    assert.equal(averageSpeeds(history, points.at(-1))[0].reason, null);
    assert.equal(averageSpeeds(history, points.at(-1), { maxGapHours: 2 })[0].reason, 'data-gap');
});

test('Gère les historiques ou identités absents sans faire échouer la fiche', () => {
    for (const history of [null, undefined, {}, { tracks: null }, { tracks: { 1: 'invalide' } }]) {
        assert.equal(averageSpeeds(history, point(4))[0].reason, 'insufficient-history');
    }
    assert.equal(averageSpeeds(historyFrom([point(0), point(4)]), { time: time(4) })[0].reason,
        'insufficient-history');
    assert.equal(averageSpeeds(null, null)[0].reason, 'invalid-time');
    assert.equal(averageSpeeds(null, { id: 1, time: time(4), positionTime: 'incorrecte' })[0].reason,
        'invalid-time');
});

test('Refuse les dates invalides, coordonnées corrompues et fenêtres non positives', () => {
    const history = historyFrom([point(0), point(2), point(4)]);
    for (const invalid of [undefined, NaN, '', '2026-11-31T10:00:00.000Z']) {
        assert.equal(averageSpeeds(history, { id: 1, time: invalid })[0].reason, 'invalid-time');
    }
    const invalidTime = { tracks: { 1: [point(0), { ...point(4), time: 'demain' }] } };
    assert.equal(averageSpeeds(invalidTime, point(4))[0].reason, 'invalid-time');
    const invalidCoordinates = { tracks: { 1: [point(0), point(2, { lon: NaN }), point(4)] } };
    assert.equal(averageSpeeds(invalidCoordinates, point(4))[0].reason, 'data-gap');
    assert.ok(averageSpeeds(history, point(4), { hours: [0, -1, NaN, Infinity, '4'] })
        .every(value => value.reason === 'invalid-time' && value.speedKnots === null));
});

test('Corpus réel : tous les derniers points ont 4h et 24h, aucun ne prétend avoir 48h', () => {
    const history = buildHistory(snapshot);
    for (const track of Object.values(history.tracks)) {
        const latest = track.at(-1);
        const [four, day, twoDays] = averageSpeeds(history, latest);
        assert.equal(four.reason, null, `4h bateau ${latest.id}`);
        assert.equal(day.reason, null, `24h bateau ${latest.id}`);
        assert.ok(Number.isFinite(four.speedKnots) && four.speedKnots >= 0);
        assert.ok(Number.isFinite(day.speedKnots) && day.speedKnots >= 0);
        assert.equal(twoDays.reason, 'insufficient-history');
        assert.equal(twoDays.speedKnots, null);
        assert.equal(four.to, latest.time);
    }
});

test('Rejeu ancien : ne remplit pas les heures d’historique avec les points futurs', () => {
    const history = buildHistory(snapshot);
    const earliest = history.tracks[5][0];
    const [four, day, twoDays] = averageSpeeds(history, earliest);
    assert.equal(four.reason, 'insufficient-history');
    assert.equal(day.reason, 'insufficient-history');
    assert.equal(twoDays.reason, 'insufficient-history');
});
