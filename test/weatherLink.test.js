import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeatherLink } from '../src/weatherLink.js';

const start = Date.parse('2026-11-01T00:00:00Z');
const hour = value => start + value * 3_600_000;

function fakeStore(setter) {
    const state = { timestamp: hour(10), calendar: { start, end: hour(48) } };
    const listeners = new Set();
    const calls = [];
    const subscriptions = [];
    const store = {
        get(key) { return state[key]; },
        on(key, callback) { subscriptions.push(['on', key, callback]); listeners.add(callback); },
        off(key, callback) { subscriptions.push(['off', key, callback]); listeners.delete(callback); },
        set(key, value) {
            calls.push([key, value]);
            if (setter) return setter(value, store);
            store.emit(value);
            return true;
        },
        emit(value) { state.timestamp = value; for (const callback of listeners) callback(value); },
        state, calls, subscriptions, listeners,
    };
    return store;
}

function connect(store) {
    const events = [];
    const statuses = [];
    const link = createWeatherLink(store, {
        onTime: (time, details) => events.push({ time, ...details }),
        onStatus: message => statuses.push(message),
    });
    link.start();
    return { link, events, statuses };
}

test('start lit l’heure courante, reste idempotent et ne modifie jamais les paramètres Windy', () => {
    const store = fakeStore();
    const { link, events } = connect(store);
    link.start();
    assert.deepEqual(events, [{ time: hour(10), programmatic: false }]);
    assert.equal(store.listeners.size, 1);
    assert.deepEqual(store.calls, []);
    // Un événement externe brut hors des relevés doit parvenir à l’interface.
    store.emit(hour(100));
    assert.deepEqual(events.at(-1), { time: hour(100), programmatic: false });
    assert.deepEqual(store.calls, []);
});

test('push synchrone distingue ses propres événements sans double appel ni boucle', async () => {
    const store = fakeStore();
    const { link, events, statuses } = connect(store);
    assert.equal(await link.push(hour(12)), true);
    assert.deepEqual(store.calls, [['timestamp', hour(12)]]);
    assert.deepEqual(events, [{ time: hour(10), programmatic: false }, { time: hour(12), programmatic: true }]);
    assert.equal(statuses.at(-1), '');
    store.emit(hour(14));
    assert.deepEqual(events.at(-1), { time: hour(14), programmatic: false });
});

test('push asynchrone attend la confirmation et fonctionne aussi sans événement timestamp', async () => {
    let confirm;
    const store = fakeStore((value, api) => new Promise(resolve => {
        confirm = () => { api.state.timestamp = value; resolve(true); };
    }));
    const { link, events } = connect(store);
    const operation = link.push(hour(12));
    assert.equal(events.length, 1);
    confirm();
    assert.equal(await operation, true);
    assert.deepEqual(events.at(-1), { time: hour(12), programmatic: true });
});

test('push asynchrone avec événement est reconnu comme programmatique', async () => {
    let confirm;
    const store = fakeStore((value, api) => new Promise(resolve => {
        confirm = () => { api.emit(value); resolve(true); };
    }));
    const { link, events } = connect(store);
    const operation = link.push(hour(12));
    confirm();
    assert.equal(await operation, true);
    assert.equal(events.length, 2);
    assert.deepEqual(events.at(-1), { time: hour(12), programmatic: true });
});

test('Une heure hors calendrier est refusée sans modifier Windy ni la sélection des bateaux', async () => {
    const store = fakeStore();
    const { link, events, statuses } = connect(store);
    assert.equal(await link.push(hour(-1)), false);
    assert.match(statuses.at(-1), /Météo non disponible pour cette heure/);
    assert.equal(await link.push(hour(49)), false);
    assert.equal(store.state.timestamp, hour(10));
    assert.equal(events.length, 1);
    assert.deepEqual(store.calls, []);
    // Vérification du calendrier courant, sans conserver une plage périmée.
    store.state.calendar.end = hour(60);
    assert.equal(await link.push(hour(49)), true);
});

test('Les limites inclusives sont acceptées, calendrier absent ou heure invalide sont refusés', async () => {
    const store = fakeStore();
    const { link, statuses } = connect(store);
    assert.equal(await link.push(start), true);
    assert.equal(await link.push(hour(48)), true);
    const writes = store.calls.length;
    for (const invalid of [NaN, Infinity, undefined, '2026-11-01T12:00:00Z', 9e15]) {
        assert.equal(await link.push(invalid), false);
        assert.match(statuses.at(-1), /Heure invalide/);
    }
    for (const calendar of [null, {}, { start: hour(48), end: start }, { start: NaN, end: hour(48) }]) {
        store.state.calendar = calendar;
        assert.equal(await link.push(hour(12)), false);
        assert.match(statuses.at(-1), /plage météo Windy/);
    }
    assert.equal(store.calls.length, writes);
});

test('Une heure adaptée par Windy est signalée et renvoyée une seule fois', async () => {
    const store = fakeStore((value, api) => { api.emit(value + 30 * 60_000); return true; });
    const { link, events, statuses } = connect(store);
    assert.equal(await link.push(hour(12)), true);
    assert.match(statuses.at(-1), /Windy a retenu/);
    assert.equal(events.length, 2);
    assert.deepEqual(events.at(-1), { time: hour(12.5), programmatic: true });
});

test('Un refus du store ne renvoie pas l’ancienne heure dans la sélection de course', async () => {
    for (const result of [false, undefined]) {
        const store = fakeStore(() => result);
        const { link, events, statuses } = connect(store);
        assert.equal(await link.push(hour(12)), false);
        assert.equal(events.length, 1);
        assert.equal(store.state.timestamp, hour(10));
        assert.match(statuses.at(-1), /pas accepté/);
    }
    const store = fakeStore((value, api) => { api.emit(api.get('timestamp')); return false; });
    const { link, events } = connect(store);
    assert.equal(await link.push(hour(12)), false);
    assert.equal(events.length, 1);
});

test('Une erreur synchrone ou un rejet asynchrone laisse la liaison utilisable', async () => {
    for (const fail of [() => { throw new Error('test synchrone'); }, () => Promise.reject(new Error('test asynchrone'))]) {
        let failed = false;
        const store = fakeStore((value, api) => {
            if (!failed) { failed = true; return fail(); }
            api.emit(value);
            return true;
        });
        const { link, events, statuses } = connect(store);
        assert.equal(await link.push(hour(12)), false);
        assert.match(statuses.at(-1), /synchronisation avec Windy a échoué/);
        assert.equal(events.length, 1);
        assert.equal(await link.push(hour(13)), true);
        assert.deepEqual(events.at(-1), { time: hour(13), programmatic: true });
    }
});

test('Des promesses résolues dans le désordre ignorent la demande ancienne et son événement', async () => {
    const confirmations = new Map();
    const store = fakeStore((value, api) => new Promise(resolve => {
        confirmations.set(value, () => { api.emit(value); resolve(true); });
    }));
    const { link, events, statuses } = connect(store);
    const older = link.push(hour(12));
    const newer = link.push(hour(14));
    confirmations.get(hour(14))();
    assert.equal(await newer, true);
    const count = events.length;
    const statusCount = statuses.length;
    confirmations.get(hour(12))();
    assert.equal(await older, false);
    assert.equal(events.length, count);
    assert.equal(statuses.length, statusCount);
    assert.deepEqual(events.at(-1), { time: hour(14), programmatic: true });
});

test('stop désinscrit exactement son écouteur et ignore les promesses, puis autorise un redémarrage', async () => {
    let confirm;
    const store = fakeStore((value, api) => new Promise(resolve => {
        confirm = () => { api.emit(value); resolve(true); };
    }));
    const { link, events, statuses } = connect(store);
    const operation = link.push(hour(12));
    link.stop();
    link.stop();
    assert.equal(store.listeners.size, 0);
    assert.equal(store.subscriptions[0][2], store.subscriptions[1][2]);
    confirm();
    assert.equal(await operation, false);
    assert.equal(events.length, 1);
    assert.equal(statuses.length, 0);
    assert.equal(await link.push(hour(14)), false);
    assert.equal(store.calls.length, 1);
    link.start();
    assert.equal(store.listeners.size, 1);
    assert.deepEqual(events.at(-1), { time: hour(12), programmatic: false });
    assert.equal(store.subscriptions[0][2], store.subscriptions[2][2]);
});

test('Une demande interrompue reste ignorée si son événement arrive après un redémarrage', async () => {
    let confirm;
    const store = fakeStore((value, api) => new Promise(resolve => {
        confirm = () => { api.emit(value); resolve(true); };
    }));
    const { link, events } = connect(store);
    const operation = link.push(hour(12));
    link.stop();
    link.start();
    const count = events.length;
    confirm();
    assert.equal(await operation, false);
    assert.equal(events.length, count);
});
