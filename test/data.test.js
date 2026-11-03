import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIdentities, parsePositions, normalizeFleet, stats } from '../src/data.js';

const row = '1;5;47.5442N;21.0763W;11/02/26 13:00:00;248/31.1';
const report = value => `POSREPORT\r\n${value}\r\n`;
const identities = parseIdentities('\uFEFF\r\nID\r\n5\tLAPERCHE Tom\t\tSVR LAZARTIGUE\r\n', 'Ultim');

test('Conserve les noms et accents des annuaires avec tabulations répétées', () => {
    assert.deepEqual(identities[5], { skipper: 'LAPERCHE Tom', name: 'SVR LAZARTIGUE', className: 'Ultim' });
    assert.equal(parseIdentities('ID\n24\tÉlodie DUPONT\tBateau été', 'IMOCA')[24].name, 'Bateau été');
});

test('Rejette un annuaire absent, vide, incomplet ou avec ID dupliqué', () => {
    for (const input of ['', '5\tNom\tBateau', 'ID', 'ID\n5\tNom', 'ID\n0\tNom\tBateau',
        'ID\n5\tNom\tBateau\n5\tAutre\tAutre']) {
        assert.throws(() => parseIdentities(input, 'Ultim'), undefined, input);
    }
});

test('Convertit précisément les minutes et associe ID 5 à Tom Laperche', () => {
    const [boat] = parsePositions(report(row), identities);
    assert.equal(boat.lat, 47.907);
    assert.ok(Math.abs(boat.lon + 21.1271666666667) < 1e-11);
    assert.equal(boat.time, '2026-11-02T13:00:00.000Z');
    assert.equal(boat.speed, 31.1);
    assert.equal(boat.heading, 248);
    assert.equal(boat.name, 'SVR LAZARTIGUE');
    assert.equal(boat.known, true);
});

test('Traite les hémisphères et les limites exactes', () => {
    const [south] = parsePositions(report(row.replace('47.5442N', '45.3000S').replace('21.0763W', '180.0000E')));
    assert.equal(south.lat, -45.5);
    assert.equal(south.lon, 180);
    assert.equal(parsePositions(report(row.replace('47.5442N', '90.0000N')))[0].lat, 90);
});

test('Conserve une position sans annuaire et accepte les rangs égaux entre classes', () => {
    const boats = parsePositions(report(`${row}\n${row.replace(';5;', ';9;')}`), identities);
    assert.equal(boats.length, 2);
    assert.deepEqual({ name: boats[1].name, className: boats[1].className, known: boats[1].known },
        { name: 'Bateau #9', className: 'Non renseignée', known: false });
});

test('Conserve le rang source 0 sans perdre le bateau ni lui inventer un classement', () => {
    const boats = parsePositions(report(`${row}\n${row.replace(/^1;5;/, '0;9;')}`), identities);
    assert.equal(boats.length, 2);
    assert.equal(boats[0].rank, 1);
    assert.equal(boats[1].rank, 0);
    assert.equal(boats[1].id, 9);
    assert.equal(boats[1].time, boats[0].time);
    assert.throws(() => parsePositions(report(row.replace(/^1;/, '9007199254740992;'))), /Rang/);
});

test('Un rang source absent ou un statut conserve les positions sans inventer de classement', () => {
    for (const value of ['', 'DNF', '-', 'NC', 'aucun', '-1', '1.5', 'NaN', 'Infinity', '1e2']) {
        const boats = parsePositions(report(`${row}\n${row.replace(/^1;5;/, `${value};9;`)}`), identities);
        assert.equal(boats.length, 2, value);
        assert.equal(boats[0].rank, 1, value);
        assert.equal(boats[1].rank, 0, value);
        assert.equal(boats[1].id, 9, value);
        assert.equal(boats[1].lat, boats[0].lat, value);
        assert.equal(boats[1].time, boats[0].time, value);
    }
    const noRank = row.replace(/^1;/, 'NC;');
    assert.throws(() => parsePositions(report(noRank.replace('47.5442N', '91.0000N'))), /Coordonnée/);
    assert.throws(() => parsePositions(report(noRank.replace(';5;', ';0;'))), /ID/);
    assert.throws(() => parsePositions(report(noRank.replace('248/31.1', '248/-1'))), /Vitesse/);
});

test('Rejette les coordonnées erronées au lieu de les interpréter comme degrés décimaux', () => {
    for (const invalid of ['47.6000N', '91.0000N', '90.0001N', '47.5442W', 'NaNN', '-47.5442N']) {
        assert.throws(() => parsePositions(report(row.replace('47.5442N', invalid))), undefined, invalid);
    }
    assert.throws(() => parsePositions(report(row.replace('21.0763W', '180.0100W'))));
});

test('Valide les calendriers et heures UTC, indépendamment du fuseau de la machine', () => {
    for (const invalid of ['02/30/26 13:00:00', '02/29/26 13:00:00', '13/02/26 13:00:00',
        '11/02/26 24:00:00', '11/02/26 13:60:00', '11/02/26 13:00:60', '11/02/26 13:00']) {
        assert.throws(() => parsePositions(report(row.replace('11/02/26 13:00:00', invalid))), undefined, invalid);
    }
    assert.equal(parsePositions(report(row.replace('11/02/26', '02/29/28')))[0].time, '2028-02-29T13:00:00.000Z');
});

test('Refuse relevés vides, champs manquants, ID dupliqué et mouvement invalide', () => {
    for (const invalid of ['', 'POSREPORT', report(row).replace('POSREPORT', 'AUTRE'),
        report(`${row}\n${row}`), report(row.replace(';5;', ';0;')),
        report(row.replace('248/31.1', '360/31.1')), report(row.replace('248/31.1', '-1/31.1')),
        report(row.replace('248/31.1', 'NaN/31.1')), report(row.replace('248/31.1', '248/-1')),
        report(row.replace('248/31.1', '248/Infinity')), report(row.replace('248/31.1', '248/')),
        report(`${row};extra`)]) {
        assert.throws(() => parsePositions(invalid), undefined, invalid);
    }
});

test('Ne publie pas un relevé partiel quand une ligne ultérieure est invalide', () => {
    assert.throws(() => parsePositions(report(`${row}\n2;9;INVALIDE`), identities), /ligne 3/);
});

function feature(overrides = {}) {
    return { type: 'Feature', id: 5, geometry: { type: 'Point', coordinates: [-21.127166666666668, 47.907] },
        properties: { id: 5, rang_source: 1, horodatage: '2026-11-02T13:00:00Z', direction_source: 248,
            vitesse_source: 31.1, classe: 'Ultim', skipper: 'LAPERCHE Tom', bateau: 'SVR LAZARTIGUE',
            identite_connue: true, ...overrides } };
}
const collection = (...features) => ({ type: 'FeatureCollection', features });

test('Le GeoJSON Python et le flux texte produisent exactement la même flotte', () => {
    assert.deepEqual(normalizeFleet(collection(feature())), parsePositions(report(row), identities));
});

test('Accepte le rang 0 dans les propriétés GeoJSON Python et JS en conservant les validations', () => {
    const [boat] = parsePositions(report(row.replace(/^1;/, '0;')), identities);
    assert.deepEqual(normalizeFleet(collection(feature({ rang_source: 0 }))), [boat]);
    assert.deepEqual(normalizeFleet(collection(feature({ rank: 0 }))), [boat]);
    for (const invalid of [-1, 1.5, '0', 'NC', '', null, NaN, Infinity, 9007199254740992]) {
        assert.throws(() => normalizeFleet(collection(feature({ rang_source: invalid }))), /Rang/);
    }
    assert.throws(() => normalizeFleet(collection(feature({ id: 0 }))), /ID/);
});

test('Accepte les propriétés JS, calcule les bornes UTC et les identités manquantes', () => {
    const boat = parsePositions(report(row), identities)[0];
    const canonical = { type: 'Feature', id: boat.id, properties: boat,
        geometry: { type: 'Point', coordinates: [boat.lon, boat.lat] } };
    assert.deepEqual(normalizeFleet(collection(canonical)), [boat]);
    assert.deepEqual(stats([boat, { ...boat, id: 9, time: '2026-11-02T12:45:00Z', known: false }]),
        { oldest: '2026-11-02T12:45:00.000Z', newest: '2026-11-02T13:00:00.000Z', unknownCount: 1 });
    assert.deepEqual(stats([]), { oldest: null, newest: null, unknownCount: 0 });
});

test('Rejette un GeoJSON partiel, dupliqué, incohérent ou aux valeurs invalides', () => {
    const badGeometry = feature();
    badGeometry.geometry.coordinates = [181, 47];
    const badId = feature({ id: 6 });
    for (const invalid of [null, collection(), collection(feature(), feature()), collection(badGeometry),
        collection(badId), collection(feature({ horodatage: '2026-02-30T13:00:00Z' })),
        collection(feature({ horodatage: '2026-11-02T13:00:00' })),
        collection(feature({ vitesse_source: NaN })), collection(feature({ direction_source: 360 })),
        collection(feature({ identite_connue: 'oui' })), collection(feature({ skipper: '' }))]) {
        assert.throws(() => normalizeFleet(invalid));
    }
});
