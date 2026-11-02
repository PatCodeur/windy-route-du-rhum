import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePositions } from '../src/data.js';
import { parseFeed } from '../src/liveFeed.js';
import identities from '../src/identities.js';

const row = '1;5;47.5442N;21.0763W;11/02/26 13:00:00;248/31.1';
const report = `POSREPORT\n${row}\n`;
const boat = parsePositions(report, identities)[0];
const feature = value => ({ type: 'Feature', id: value.id, properties: value,
    geometry: { type: 'Point', coordinates: [value.lon, value.lat] } });
const history = fleets => JSON.stringify({ type: 'RhumHistory', schema: 'rhum-history/v1', fleets });

test('Lit les trois formats de flux et restitue les mêmes observations normalisées', () => {
    assert.deepEqual(parseFeed(`\uFEFF${report}`, identities), [[boat]]);
    assert.deepEqual(parseFeed(JSON.stringify({ type: 'FeatureCollection', features: [feature(boat)] }), identities), [[boat]]);
    assert.deepEqual(parseFeed(history([[boat]]), identities), [[boat]]);
});

test('Recharge les identités locales d’un flux normalisé resté anonyme', () => {
    const unknown = { ...boat, known: false, name: 'Bateau #5', skipper: '', className: 'Non renseignée' };
    assert.deepEqual(parseFeed(history([[unknown]]), identities), [[boat]]);
    assert.equal(parseFeed(history([[unknown]]))[0][0].known, false);
    assert.throws(() => parseFeed(history([[unknown]]), { 5: { name: 'Incomplet' } }), /Identité invalide/);
});

test('Refuse historiques vides, schéma inconnu, champs invalides et bateaux répétés', () => {
    const invalid = ['', 'quelconque', '{}', 'null', '[]', history([]), history([[]]), history([null]),
        history([[boat, boat]]), history([[{ ...boat, lat: 91 }]]),
        history([[{ ...boat, speed: -1 }]]), history([[{ ...boat, time: '2026-02-30T13:00:00Z' }]]),
        history([[{ ...boat, known: 'oui' }]]), history([[null]]),
        JSON.stringify({ type: 'RhumHistory', schema: 'autre', fleets: [[boat]] })];
    for (const source of invalid) assert.throws(() => parseFeed(source), undefined, source);
    assert.throws(() => parseFeed({}));
    assert.throws(() => parseFeed(report, null));
});

test('Valide tous les relevés avant de rendre le résultat, même si le dernier est corrompu', () => {
    assert.throws(() => parseFeed(history([[boat], [{ ...boat, heading: 360 }]])), /cap/);
    assert.equal(parseFeed(history([[boat], [{ ...boat, time: '2026-11-03T13:00:00Z' }]])).length, 2);
});

test('Accepte un historique de course dépassant 3 Mo', () => {
    const source = history(Array.from({ length: 16000 }, () => [boat]));
    assert.ok(source.length > 3 * 1024 * 1024);
    assert.equal(parseFeed(source, identities).length, 16000);
});
