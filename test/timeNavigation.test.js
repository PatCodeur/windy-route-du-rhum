import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHistory } from '../src/history.js';
import { sampleFleet, timelineState, traceAtTime } from '../src/timeNavigation.js';
import snapshot from '../src/historySnapshot.js';

const time = hour => `2026-11-01T${String(hour).padStart(2, '0')}:00:00.000Z`;
const ms = hour => Date.parse(time(hour));
const point = (id, hour, overrides = {}) => ({ id, time: time(hour), lat: 0, lon: hour,
    rank: id, heading: 270, speed: 12, name: `Bateau ${id}`, className: 'IMOCA', ...overrides });
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance,
    `${actual} devrait être proche de ${expected}`);

test('À une observation exacte, conserve les valeurs et l’heure source sans interpolation', () => {
    const history = buildHistory([[point(1, 10)], [point(1, 12)]]);
    const before = JSON.stringify(history);
    const [boat] = sampleFleet(history, ms(10));
    assert.equal(boat.time, time(10));
    assert.equal(boat.positionTime, time(10));
    assert.equal(boat.lon, 10);
    assert.equal(boat.interpolated, false);
    assert.equal(boat.nextObservationTime, time(12));
    assert.equal(boat.historyBoundary, null);
    assert.notEqual(boat, history.tracks[1][0]);
    assert.equal(JSON.stringify(history), before);
});

test('Entre observations, interpole la géométrie, le cap et la vitesse, conserve rang et identité précédents', () => {
    const history = buildHistory([[point(1, 10, { heading: 350, speed: 10, rank: 2 })],
        [point(1, 12, { heading: 10, speed: 20, rank: 1, name: 'Nouveau nom' })]]);
    const [boat] = sampleFleet(history, ms(11));
    close(boat.lon, 11);
    close(boat.lat, 0);
    close(boat.heading, 0);
    close(boat.speed, 15);
    assert.equal(boat.time, time(10));
    assert.equal(boat.positionTime, time(11));
    assert.equal(boat.interpolated, true);
    assert.equal(boat.rank, 2);
    assert.equal(boat.name, 'Bateau 1');
    assert.equal(boat.nextObservationTime, time(12));
});

test('Peut désactiver l’interpolation et ne prévoit aucune position au-delà du dernier relevé', () => {
    const history = buildHistory([[point(1, 10)], [point(1, 12)]]);
    const [held] = sampleFleet(history, ms(11), { interpolate: false });
    assert.equal(held.positionTime, time(10));
    assert.equal(held.lon, 10);
    assert.equal(held.interpolated, false);
    const [ended] = sampleFleet(history, ms(13));
    assert.equal(ended.time, time(12));
    assert.equal(ended.positionTime, time(12));
    assert.equal(ended.lon, 12);
    assert.equal(ended.interpolated, false);
    assert.equal(ended.historyBoundary, 'after');
    assert.equal(ended.nextObservationTime, null);
    assert.equal(sampleFleet(history, ms(12))[0].historyBoundary, null);
});

test('N’affiche pas les bateaux avant leur propre première observation', () => {
    const history = buildHistory([[point(1, 10), point(2, 12)], [point(1, 14), point(2, 14)]]);
    assert.deepEqual(sampleFleet(history, ms(9)), []);
    assert.deepEqual(sampleFleet(history, ms(11)).map(boat => boat.id), [1]);
    assert.deepEqual(traceAtTime(history, 2, ms(11)), []);
    assert.deepEqual(traceAtTime(history, 999, ms(12)), []);
});

test('Les bornes globales sont explicites, indépendantes des heures de collecte des fichiers', () => {
    const history = buildHistory([[point(1, 10), point(2, 11)], [point(1, 12), point(2, 13)]]);
    assert.deepEqual(timelineState(history, ms(9)), {
        time: time(10), requestedTime: time(9), outside: 'before', index: -1,
    });
    assert.deepEqual(timelineState(history, ms(12)), {
        time: time(12), requestedTime: time(12), outside: null, index: 0,
    });
    assert.deepEqual(timelineState(history, ms(14)), {
        time: time(13), requestedTime: time(14), outside: 'after', index: 1,
    });
    assert.equal(timelineState(history, ms(10)).outside, null);
    assert.equal(timelineState(history, ms(13)).outside, null);
    assert.deepEqual(timelineState(buildHistory([]), ms(10)), {
        time: null, requestedTime: time(10), outside: null, index: -1,
    });
});

test('La trace s’arrête à l’instant choisi sans inclure les futurs sommets ni dupliquer un point exact', () => {
    const history = buildHistory([[point(1, 10)], [point(1, 12)], [point(1, 14)]]);
    const trace = traceAtTime(history, 1, ms(11));
    assert.equal(trace.length, 2);
    assert.deepEqual(trace.map(boat => boat.positionTime), [time(10), time(11)]);
    assert.deepEqual(trace.map(boat => boat.interpolated), [false, true]);
    assert.ok(trace.every(boat => Date.parse(boat.time) <= ms(11)));
    assert.equal(traceAtTime(history, 1, ms(12)).length, 2);
    assert.equal(traceAtTime(history, 1, ms(15)).length, 3);
    assert.equal(traceAtTime(history, 1, ms(11), { interpolate: false }).length, 1);
});

test('Interpole par le chemin court à l’antiméridien et dans les deux sens pour le cap', () => {
    const history = buildHistory([[point(1, 10, { lon: 179, heading: 10 })],
        [point(1, 12, { lon: -179, heading: 350 })]]);
    const [middle] = sampleFleet(history, ms(11));
    close(Math.abs(middle.lon), 180);
    close(middle.heading, 0);
    close(sampleFleet(history, ms(10) + 30 * 60_000)[0].lon, 179.5);
    close(sampleFleet(history, ms(11) + 30 * 60_000)[0].lon, -179.5);
});

test('Grand cercle : courbure vers le pôle et stabilité des points identiques ou antipodaux', () => {
    const history = buildHistory([[point(1, 10, { lat: 60, lon: -45 }), point(2, 10, { lon: 0 }),
        point(3, 10, { lon: 0 })], [point(1, 12, { lat: 60, lon: 45 }),
        point(2, 12, { lon: 0 }), point(3, 12, { lon: 180 })]]);
    const fleet = sampleFleet(history, ms(11));
    assert.ok(fleet[0].lat > 60);
    close(fleet[0].lon, 0);
    assert.ok(fleet.every(boat => Number.isFinite(boat.lat) && Number.isFinite(boat.lon)));
    close(fleet[1].lat, 0);
    close(fleet[1].lon, 0);
});

test('Refuse les heures invalides avant tout calcul', () => {
    const history = buildHistory([]);
    for (const invalid of [NaN, Infinity, 'demain', time(10), undefined, 9e15]) {
        assert.throws(() => sampleFleet(history, invalid));
        assert.throws(() => traceAtTime(history, 1, invalid));
        assert.throws(() => timelineState(history, invalid));
    }
});

test('Corpus réel : aucune source future et aucune trace future aux instants intermédiaires', () => {
    const history = buildHistory(snapshot);
    for (let index = 1; index < history.times.length; index++) {
        const requested = (Date.parse(history.times[index - 1]) + Date.parse(history.times[index])) / 2;
        const fleet = sampleFleet(history, requested);
        assert.equal(fleet.length, 115);
        assert.ok(fleet.some(boat => boat.interpolated));
        for (const boat of fleet) {
            assert.ok(Date.parse(boat.time) <= requested);
            assert.ok(Date.parse(boat.positionTime) <= requested);
            assert.ok(Math.abs(boat.lat) <= 90 && Math.abs(boat.lon) <= 180);
            const trace = traceAtTime(history, boat.id, requested);
            assert.ok(trace.every(vertex => Date.parse(vertex.positionTime) <= requested));
            assert.deepEqual(trace.at(-1), boat);
        }
    }
});
