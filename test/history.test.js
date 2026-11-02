import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildHistory, mergeHistory, fleetAt, trackAt } from '../src/history.js';
import { normalizeFleet } from '../src/data.js';
import snapshot from '../src/historySnapshot.js';
import identities from '../src/identities.js';

const time = hour => `2026-11-01T${String(hour).padStart(2, '0')}:00:00.000Z`;
const point = (id, hour, overrides = {}) => ({ id, time: time(hour), lat: 48, lon: -hour,
    rank: id, heading: 270, speed: 12, name: `Bateau ${id}`, skipper: 'Nom', className: 'IMOCA', known: true,
    ...overrides });

test('Trie les relevés désordonnés et les observations de chaque bateau par heure réelle', () => {
    const history = buildHistory([[point(1, 12), point(2, 11)], [point(1, 10), point(2, 9)]]);
    assert.deepEqual(history.times, [time(10), time(12)]);
    assert.equal(history.oldest, time(9));
    assert.equal(history.newest, time(12));
    assert.deepEqual(history.tracks[1].map(b => b.time), [time(10), time(12)]);
    assert.deepEqual(history.tracks[2].map(b => b.time), [time(9), time(11)]);
});

test('Avant la première observation, la flotte et les traces sont vides', () => {
    const history = buildHistory([[point(1, 10)]]);
    assert.deepEqual(fleetAt(history, time(9)), []);
    assert.deepEqual(trackAt(history, 1, time(9)), []);
    assert.deepEqual(trackAt(history, 999, time(12)), []);
});

test('À l’heure exacte, inclut le point ; après la fin, conserve le dernier relevé', () => {
    const history = buildHistory([[point(1, 10)], [point(1, 12)]]);
    assert.equal(fleetAt(history, time(10))[0].time, time(10));
    assert.equal(fleetAt(history, time(13))[0].time, time(12));
    assert.equal(trackAt(history, 1, time(13)).length, 2);
});

test('Ne révèle ni les positions ni les traces futures quand les heures diffèrent dans un relevé', () => {
    const history = buildHistory([[point(1, 10), point(2, 11)], [point(1, 12), point(2, 13)]]);
    assert.deepEqual(fleetAt(history, time(10)).map(b => b.id), [1]);
    assert.deepEqual(fleetAt(history, time(12)).map(b => [b.id, b.time]), [[1, time(12)], [2, time(11)]]);
    assert.deepEqual(trackAt(history, 2, time(12)).map(b => b.time), [time(11)]);
});

test('Fichiers répétés : un point par ID et heure, métadonnées de la dernière entrée', () => {
    const initial = point(1, 10);
    const history = buildHistory([[initial], [initial], [{ ...initial, rank: 2 }]]);
    assert.equal(history.tracks[1].length, 1);
    assert.deepEqual(history.times, [time(10)]);
    assert.equal(history.tracks[1][0].rank, 2);
    assert.equal(initial.rank, 1);
});

test('Un même ID et la même heure avec des coordonnées différentes provoquent une erreur explicite', () => {
    assert.throws(() => buildHistory([[point(5, 10)], [point(5, 10, { lat: 47 })]]),
        /bateau #5 à 2026-11-01T10:00:00.000Z/);
});

test('Accepte les écarts d’arrondi Python/JS et refuse un véritable déplacement à la même heure', () => {
    const initial = point(5, 10);
    const rounded = { ...initial, lat: initial.lat + 5e-10, lon: initial.lon - 1e-14 };
    assert.equal(buildHistory([[initial], [rounded]]).tracks[5].length, 1);
    assert.throws(() => buildHistory([[initial], [{ ...initial, lon: initial.lon + 1e-8 }]]),
        /Positions contradictoires/);
});

test('Fusionne le GeoJSON Python initial et les 29 fichiers texte malgré les arrondis binaires', () => {
    const geojson = JSON.parse(readFileSync(new URL('../data/releve.geojson', import.meta.url), 'utf8'));
    const initialFleet = normalizeFleet(geojson);
    const history = buildHistory(snapshot);
    const merged = mergeHistory(history, [initialFleet]);
    assert.equal(Object.keys(merged.tracks).length, 115);
    assert.ok(fleetAt(merged, merged.newest).every(boat => boat.time <= merged.newest));
    const initialMerged = mergeHistory(buildHistory([initialFleet]), snapshot);
    assert.equal(initialMerged.newest, history.newest);
    assert.equal(Object.keys(initialMerged.tracks).length, 115);
});

test('Fusionne plusieurs imports sans muter l’historique ou les tableaux reçus', () => {
    const oldFleet = [point(1, 10), point(2, 9)];
    const newFleet = [point(1, 12), point(2, 11)];
    const history = buildHistory([oldFleet]);
    const before = JSON.stringify(history);
    const merged = mergeHistory(history, [newFleet]);
    assert.equal(JSON.stringify(history), before);
    assert.equal(history.tracks[1].length, 1);
    assert.equal(merged.tracks[1].length, 2);
    assert.deepEqual(merged.times, [time(10), time(12)]);
    assert.notEqual(merged.tracks[1][0], history.tracks[1][0]);
    assert.equal(newFleet[0].time, time(12));
    const repeated = mergeHistory(merged, [oldFleet, newFleet]);
    assert.deepEqual(repeated, merged);
});

test('Une fusion refusée ne modifie aucune partie du dernier historique valide', () => {
    const history = buildHistory([[point(1, 10)]]);
    const before = JSON.stringify(history);
    assert.throws(() => mergeHistory(history, [[point(2, 11)], [point(1, 10, { lon: 3 })]]));
    assert.equal(JSON.stringify(history), before);
});

test('Valide les heures UTC, les coordonnées et les ID avant de créer un historique', () => {
    for (const override of [{ time: '2026-11-01T10:00:00+01:00' }, { time: '2026-02-30T10:00:00Z' },
        { lat: 91 }, { lon: Infinity }, { id: 0 }]) {
        assert.throws(() => buildHistory([[point(1, 10, override)]]));
    }
    assert.throws(() => buildHistory([[point(1, 10), point(1, 10)]]));
    const history = buildHistory([]);
    assert.deepEqual(history.times, []);
    assert.equal(history.oldest, null);
    assert.equal(history.newest, null);
    assert.deepEqual(fleetAt(history, time(10)), []);
    assert.throws(() => fleetAt(history, 'demain'));
});

test('Corpus réel : 29 relevés, 115 bateaux identifiés et 3331 observations distinctes', () => {
    assert.equal(snapshot.length, 29);
    assert.ok(snapshot.every(fleet => fleet.length === 115));
    assert.equal(snapshot.flat().length, 3335);
    assert.ok(snapshot.flat().every(boat => boat.known));
    assert.equal(Object.keys(identities).length, 117);
    assert.equal(Object.values(identities).filter(identity => identity.className === 'Ocean Fifty').length, 11);
    const history = buildHistory(snapshot);
    assert.equal(Object.keys(history.tracks).length, 115);
    assert.equal(Object.values(history.tracks).flat().length, 3331);
    assert.equal(history.times.length, 29);
    assert.equal(history.oldest, '2026-11-01T09:00:00.000Z');
    assert.equal(history.newest, '2026-11-02T14:00:18.000Z');
    assert.equal(history.times[0], '2026-11-01T10:00:22.000Z');
    assert.equal(fleetAt(history, history.times[0]).length, 115);
    assert.equal(fleetAt(history, history.newest).length, 115);
    assert.deepEqual(Object.keys(identities).filter(id => !history.tracks[id]), ['15', '100']);
    assert.equal(fleetAt(history, history.newest).filter(boat => boat.className === 'Ocean Fifty').length, 10);
});

test('Corpus réel : aucune observation future dans les 29 étapes de lecture', () => {
    const history = buildHistory(snapshot);
    for (const cutoff of history.times) {
        const fleet = fleetAt(history, cutoff);
        assert.ok(fleet.every(boat => boat.time <= cutoff));
        for (const boat of fleet) assert.ok(trackAt(history, boat.id, cutoff).every(point => point.time <= cutoff));
    }
    // Le rang peut changer dans les fichiers répétant un point, mais jamais la géométrie.
    const geometry = value => Object.fromEntries(Object.entries(value.tracks).map(([id, points]) =>
        [id, points.map(({ time, lat, lon }) => ({ time, lat, lon }))]));
    const reversed = buildHistory([...snapshot].reverse());
    assert.deepEqual(reversed.times, history.times);
    assert.deepEqual(geometry(reversed), geometry(history));
});
