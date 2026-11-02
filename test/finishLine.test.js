import test from 'node:test';
import assert from 'node:assert/strict';
import { FINISH_LINE, distanceToFinishNm, distanceToLineSegmentNm } from '../src/finishLine.js';
import { distanceNm } from '../src/geodesy.js';

const near = (value, expected, tolerance = 1e-7) => assert.ok(
    Math.abs(value - expected) <= tolerance, `${value} doit être proche de ${expected}`);

test('La ligne reprend les deux bornes de l’article 10.1 et non celles du couloir', () => {
    assert.equal(FINISH_LINE.east.lat, 16.2);
    near(FINISH_LINE.east.lon, -61.513333333333335);
    assert.equal(FINISH_LINE.west.lat, 16.2);
    near(FINISH_LINE.west.lon, -61.5175);
    assert.match(FINISH_LINE.sourceReference, /10\.1/);
    assert.ok(distanceNm(FINISH_LINE.east, FINISH_LINE.west) > 0.24);
    assert.ok(distanceNm(FINISH_LINE.east, FINISH_LINE.west) < 0.241);
    assert.equal(distanceToFinishNm(FINISH_LINE.east), 0);
    assert.equal(distanceToFinishNm(FINISH_LINE.west), 0);
});

test('La distance est nulle sur le segment et perpendiculaire dans son intérieur', () => {
    const start = { lat: 0, lon: -1 };
    const end = { lat: 0, lon: 1 };
    assert.equal(distanceToLineSegmentNm({ lat: 0, lon: 0 }, start, end), 0);
    near(distanceToLineSegmentNm({ lat: 1, lon: 0 }, start, end), 60.04054008290114);
    near(distanceToLineSegmentNm({ lat: -1, lon: 0 }, end, start), 60.04054008290114);
});

test('Le prolongement de la ligne ne donne pas une fausse distance nulle', () => {
    const start = { lat: 0, lon: -1 };
    const end = { lat: 0, lon: 1 };
    near(distanceToLineSegmentNm({ lat: 0, lon: 2 }, start, end), 60.04054008290114);
    near(distanceToLineSegmentNm({ lat: 1, lon: 2 }, start, end),
        distanceNm({ lat: 1, lon: 2 }, end));
    near(distanceToLineSegmentNm({ lat: 0, lon: -2 }, start, end), 60.04054008290114);
});

test('La ligne officielle prend sa borne Est comme référence pour un bateau au nord-est', () => {
    const point = { lat: FINISH_LINE.east.lat + 1, lon: FINISH_LINE.east.lon + 1 };
    near(distanceToFinishNm(point), distanceNm(point, FINISH_LINE.east));
});

test('Un segment traversant le méridien 180° reste fini et prend le petit arc', () => {
    const start = { lat: 0, lon: 179 };
    const end = { lat: 0, lon: -179 };
    assert.equal(distanceToLineSegmentNm({ lat: 0, lon: 180 }, start, end), 0);
    near(distanceToLineSegmentNm({ lat: 1, lon: -180 }, start, end), 60.04054008290114);
    assert.ok(distanceToLineSegmentNm({ lat: 0, lon: 0 }, start, end) > 10700);
});

test('Les cas dégénérés et la projection au pôle restent définis', () => {
    const point = { lat: 1, lon: 0 };
    const endpoint = { lat: 0, lon: 0 };
    near(distanceToLineSegmentNm(point, endpoint, endpoint), distanceNm(point, endpoint));
    near(distanceToLineSegmentNm({ lat: 90, lon: 0 }, { lat: 0, lon: -1 },
        { lat: 0, lon: 1 }), 5403.6486074611025);
    assert.ok(Number.isFinite(distanceToLineSegmentNm(point, endpoint, { lat: 0, lon: 180 })));
});

test('Les coordonnées invalides ne produisent pas de distance', () => {
    for (const point of [null, {}, { lat: 91, lon: 0 }, { lat: 0, lon: -181 },
        { lat: '16.2', lon: -61.5 }, { lat: NaN, lon: 0 }]) {
        assert.equal(distanceToFinishNm(point), null);
        assert.equal(distanceToLineSegmentNm(FINISH_LINE.east, point, FINISH_LINE.west), null);
    }
});
