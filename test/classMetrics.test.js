import test from 'node:test';
import assert from 'node:assert/strict';
import { classStanding, distanceNm } from '../src/classMetrics.js';
import { FINISH_LINE, distanceToFinishNm } from '../src/finishLine.js';

const boat = (id, rank, overrides = {}) => ({ id, rank, className: 'IMOCA', lat: 0, lon: 0,
    time: '2026-11-02T12:00:00.000Z', ...overrides });
const near = (value, expected, tolerance = 1e-7) => assert.ok(
    Math.abs(value - expected) <= tolerance, `${value} doit être proche de ${expected}`);

test('Utilise le rang source et le leader de la même classe dans la flotte entière', () => {
    const leader = boat(5, 1);
    const selected = boat(6, 3, { lon: 1 });
    const fleet = [boat(30, 1, { className: 'Class40', lon: 1 }), selected, leader,
        boat(7, 2, { lon: 0.5 })];
    const standing = classStanding(selected, fleet);
    assert.equal(standing.rank, 3);
    assert.equal(standing.classSize, 3);
    assert.equal(standing.leader, leader);
    near(standing.distanceToFinishNm, distanceToFinishNm(selected));
    near(standing.leaderDistanceToFinishNm, distanceToFinishNm(leader));
    near(standing.gapToLeaderNm, distanceToFinishNm(selected) - distanceToFinishNm(leader));
    near(standing.leaderDistanceNm, 60.04054008290114);
    assert.equal(standing.measurementSkewMinutes, 0);
    assert.equal(standing.isLeader, false);
    assert.equal(standing.officialGapAvailable, false);
    assert.equal(Object.hasOwn(standing, 'timeGap'), false);
});

test('Le leader lui-même a une distance nulle et ne dépend pas de l’ordre des bateaux', () => {
    const leader = boat(5, 1, { lat: 48, lon: -5 });
    const result = classStanding(leader, [boat(7, 2), leader]);
    assert.equal(result.isLeader, true);
    assert.equal(result.leaderDistanceNm, 0);
    assert.equal(result.gapToLeaderNm, 0);
    assert.equal(result.distanceToFinishNm, result.leaderDistanceToFinishNm);
    assert.equal(result.measurementSkewMinutes, 0);
    assert.equal(classStanding({ ...leader }, [leader]).isLeader, true);
});

test('Ne devine aucun leader si le rang 1 est absent, même si un autre bateau est proche', () => {
    const selected = boat(6, 2);
    const result = classStanding(selected, [selected, boat(7, 3),
        boat(30, 1, { className: 'Class40' })]);
    assert.equal(result.classSize, 2);
    assert.equal(result.leader, null);
    assert.equal(result.leaderDistanceNm, null);
    assert.ok(Number.isFinite(result.distanceToFinishNm));
    assert.equal(result.leaderDistanceToFinishNm, null);
    assert.equal(result.gapToLeaderNm, null);
    assert.equal(result.measurementSkewMinutes, null);
    assert.equal(result.isLeader, false);
});

test('Deux rangs 1 dans la classe rendent le leader ambigu', () => {
    const selected = boat(6, 2);
    const result = classStanding(selected, [boat(5, 1), selected, boat(7, 1)]);
    assert.equal(result.leader, null);
    assert.equal(result.leaderDistanceNm, null);
    assert.equal(result.leaderDistanceToFinishNm, null);
    assert.equal(result.gapToLeaderNm, null);
    assert.equal(result.measurementSkewMinutes, null);
});

test('Une identité de classe absente ne groupe pas les bateaux non identifiés', () => {
    for (const className of [null, '', ' ', 'Non renseignée']) {
        const selected = boat(6, 2, { className });
        const result = classStanding(selected, [selected, boat(5, 1, { className })]);
        assert.equal(result.classSize, 0);
        assert.equal(result.leader, null);
        assert.equal(result.leaderDistanceNm, null);
        assert.ok(Number.isFinite(result.distanceToFinishNm));
        assert.equal(result.gapToLeaderNm, null);
    }
    assert.equal(classStanding(boat(6, 2), null).classSize, 0);
    assert.equal(classStanding(null, []).rank, null);
});

test('Un rang invalide ne devient pas un rang 1 par conversion de texte', () => {
    for (const rank of [0, -1, 1.5, '1', undefined, NaN]) {
        const selected = boat(5, rank);
        const result = classStanding(selected, [selected]);
        assert.equal(result.rank, null);
        assert.equal(result.leader, null);
        assert.equal(result.isLeader, false);
    }
});

test('La distance la plus courte traverse le méridien 180°', () => {
    const west = { lat: 0, lon: -179.5 };
    const east = { lat: 0, lon: 179.5 };
    near(distanceNm(west, east), 60.04054008290114);
    near(distanceNm(east, west), distanceNm(west, east));
    assert.equal(distanceNm({ lat: 0, lon: -180 }, { lat: 0, lon: 180 }), 0);
});

test('Le calcul reste fini aux pôles et aux antipodes', () => {
    near(distanceNm({ lat: 90, lon: 0 }, { lat: 90, lon: 180 }), 0);
    near(distanceNm({ lat: 89.5, lon: 0 }, { lat: 89.5, lon: 180 }), 60.04054008290114);
    near(distanceNm({ lat: 90, lon: 0 }, { lat: -90, lon: 180 }), 10807.297214922205);
    assert.ok(Number.isFinite(distanceNm({ lat: 48.123, lon: -5.12 }, { lat: -48.123, lon: 174.88 })));
});

test('Une coordonnée absente ou hors limites ne produit aucune distance', () => {
    for (const overrides of [{ lat: null }, { lat: NaN }, { lat: 91 }, { lon: -181 },
        { lon: Infinity }, { lat: '48' }, { lon: undefined }]) {
        const selected = boat(6, 2, overrides);
        const leader = boat(5, 1);
        const result = classStanding(selected, [selected, leader]);
        assert.equal(result.leader, leader);
        assert.equal(result.leaderDistanceNm, null);
        assert.equal(result.distanceToFinishNm, null);
        assert.equal(result.gapToLeaderNm, null);
        assert.equal(distanceNm(leader, selected), null);
    }
    assert.equal(distanceNm(null, boat(5, 1)), null);
});

test('L’écart compare les distances à la ligne et non la séparation entre les deux bateaux', () => {
    const leader = boat(5, 1, { lat: FINISH_LINE.east.lat, lon: FINISH_LINE.east.lon + 1 });
    const selected = boat(6, 2, { lat: FINISH_LINE.east.lat + 1, lon: FINISH_LINE.east.lon });
    const result = classStanding(selected, [leader, selected]);
    assert.ok(result.gapToLeaderNm > 0 && result.gapToLeaderNm < 5);
    assert.ok(result.leaderDistanceNm > 80);
    near(result.gapToLeaderNm, result.distanceToFinishNm - result.leaderDistanceToFinishNm);
});

test('L’écart reste signé sans remplacer le rang source par un classement géométrique', () => {
    const leader = boat(5, 1, { lat: FINISH_LINE.east.lat + 2, lon: FINISH_LINE.east.lon });
    const selected = boat(6, 2, { lat: FINISH_LINE.east.lat + 1, lon: FINISH_LINE.east.lon });
    const result = classStanding(selected, [selected, leader]);
    assert.equal(result.rank, 2);
    assert.equal(result.leader, leader);
    near(result.gapToLeaderNm, -60.04054008290114);
});

test('Une position invalide du leader conserve la distance propre et rend l’écart indisponible', () => {
    const leader = boat(5, 1, { lat: null });
    const selected = boat(6, 2);
    const result = classStanding(selected, [leader, selected]);
    assert.equal(result.leader, leader);
    assert.ok(Number.isFinite(result.distanceToFinishNm));
    assert.equal(result.leaderDistanceToFinishNm, null);
    assert.equal(result.gapToLeaderNm, null);
});

test('Signale le décalage réel des observations malgré une position interpolée à la même heure', () => {
    const selected = boat(6, 2, { time: '2026-11-02T11:30:00Z', positionTime: '2026-11-02T12:00:00Z' });
    const leader = boat(5, 1, { positionTime: '2026-11-02T12:00:00Z' });
    assert.equal(classStanding(selected, [selected, leader]).measurementSkewMinutes, 30);
    assert.equal(classStanding(leader, [selected, leader]).measurementSkewMinutes, 0);
    const explicit = { ...selected, observationTime: '2026-11-02T11:45:30Z', time: leader.time };
    assert.equal(classStanding(explicit, [explicit, leader]).measurementSkewMinutes, 14.5);
});

test('Une heure manquante ou incorrecte ne devient pas un décalage nul', () => {
    const leader = boat(5, 1);
    for (const time of [null, 'demain', '2026-02-30T12:00:00Z', '2026-11-02T12:00:00+01:00']) {
        const selected = boat(6, 2, { time });
        assert.equal(classStanding(selected, [selected, leader]).measurementSkewMinutes, null);
    }
});
