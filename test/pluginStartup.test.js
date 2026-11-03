import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import suppliedReports from '../src/historySnapshot.js';

const pluginUrl = new URL('../src/plugin.svelte', import.meta.url);

function mapEnvironment({ failingDecoration = null, failBoats = false,
    normalizeWeather = timestamp => timestamp,
    weatherCalendar = { start: Date.parse('2026-10-01T00:00:00Z'), end: Date.parse('2026-12-01T00:00:00Z') },
    fetch: fetchFeed = async () => {
    throw new Error('Aucun chargement réseau prévu dans ce test');
} } = {}) {
    const created = [];
    const mounts = [];
    const destroys = [];
    const warnings = [];
    const errors = [];
    const intervals = new Map();
    let nextTimer = 0;
    let tooltipCalls = 0;
    let clock = Date.now();
    class ClockDate extends Date {
        constructor(...args) { super(...(args.length ? args : [clock])); }
        static now() { return clock; }
    }
    class Evented {
        events = new Map();
        on(type, listener) {
            if (!this.events.has(type)) this.events.set(type, new Set());
            this.events.get(type).add(listener);
            return this;
        }
        off(type, listener) { this.events.get(type)?.delete(listener); return this; }
        emit(type, value) { for (const listener of this.events.get(type) || []) listener(value); }
        addEventListener(type, listener) { this.on(type, listener); }
        removeEventListener(type, listener) { this.off(type, listener); }
    }
    class FakeMap extends Evented {
        layers = new Set();
        addLayer(layer) { this.layers.add(layer); return this; }
        removeLayer(layer) { this.layers.delete(layer); return this; }
    }
    const map = new FakeMap();
    class Layer extends Evented {
        constructor(kind, position, options) {
            super();
            this.kind = kind;
            this.position = position;
            this.options = options;
            created.push(this);
        }
        bindTooltip() { ++tooltipCalls; this.tooltip = true; return this; }
        addTo(map) {
            map.addLayer(this);
            // Reproduit l'erreur LeafletGL à l'ajout d'une couche dont la méthode
            // bindTooltip existe, mais dont les tooltips ne sont pas supportés.
            if (this.tooltip) throw new Error('This layer type does not support tooltips.');
            if (this.kind === failingDecoration) throw new Error('Repère d’arrivée indisponible');
            return this;
        }
        setLatLng(position) { this.position = position; return this; }
        setLatLngs(position) { this.position = position; return this; }
        setIcon(icon) { this.options.icon = icon; return this; }
        setStyle(options) { this.options = options; return this; }
        setZIndexOffset() { return this; }
        bringToBack() { return this; }
    }
    class Polyline extends Layer {
        constructor(position, options) {
            super(options.color === '#ffffff' ? 'finish-line' : 'trace', position, options);
        }
    }
    class Marker extends Layer {
        constructor(position, options) {
            const kind = options.icon.options.className === 'rhum-boat-icon' ? 'boat' : 'finish-flag';
            if (kind === 'boat' && failBoats) throw new Error('Marqueurs indisponibles');
            super(kind, position, options);
        }
    }
    class DivIcon {
        constructor(options) { this.options = options; }
    }
    const store = new Evented();
    store.calendar = weatherCalendar;
    store.writes = [];
    store.get = key => store[key];
    store.set = (key, value) => {
        assert.equal(key, 'timestamp');
        store.writes.push(value);
        store.timestamp = normalizeWeather(value);
        store.emit('timestamp', store.timestamp);
        return true;
    };
    const document = Object.assign(new Evented(), {
        createElement: () => ({ innerHTML: '' }),
        visibilityState: 'visible',
    });
    const window = new Evented();
    return {
        map, L: { Polyline, Marker, DivIcon }, store, mounts, destroys, created,
        warnings, errors, intervals, document, window, tooltipCalls: () => tooltipCalls,
        advanceTime(milliseconds) { clock += milliseconds; },
        emitWeather(timestamp) { store.timestamp = timestamp; store.emit('timestamp', timestamp); },
        emitWindow(type) { window.emit(type); },
        emitDocument(type) { document.emit(type); },
        svelte: {
            onMount(callback) { mounts.push(callback); },
            onDestroy(callback) { destroys.push(callback); },
        },
        globals: {
            document, window,
            Date: ClockDate, URL, AbortController, fetch: fetchFeed,
            setTimeout() { return ++nextTimer; },
            clearTimeout() {},
            console: {
                warn: (...args) => warnings.push(args),
                error: (...args) => errors.push(args),
            },
            setInterval(callback) { const id = ++nextTimer; intervals.set(id, callback); return id; },
            clearInterval(id) { intervals.delete(id); },
        },
    };
}

/**
 * Exécute le véritable script de plugin.svelte et ses modules métier. Seules
 * l'interface Windy/Leaflet et les fonctions de cycle de vie Svelte sont simulées.
 * Les labels réactifs $: exécutent ici leur calcul initial, dans l'ordre du source.
 */
async function prepareStartup(options) {
    const env = mapEnvironment(options);
    const source = await readFile(pluginUrl, 'utf8');
    const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];
    const imports = [...script.matchAll(/^\s*import\s+([^;]+?)\s+from\s+['"]([^'"]+)['"];\s*$/gm)];
    const modules = {
        svelte: env.svelte,
        '@windy/broadcast': { default: { emit() {} } },
        '@windy/map': { map: env.map },
        '@windy/store': { default: env.store },
        ...(options?.runtimeConfig ? { './runtimeConfig.js': { default: options.runtimeConfig } } : {}),
        ...(options?.historySnapshot ? { './historySnapshot.js': { default: options.historySnapshot } } : {}),
    };
    const bindings = {};
    for (const match of imports) {
        const [, clause, specifier] = match;
        const module = modules[specifier] ?? await import(new URL(specifier, pluginUrl));
        if (clause.trim().startsWith('{')) {
            for (const name of clause.replace(/[{}]/g, '').split(',')) {
                const [exported, local = exported] = name.trim().split(/\s+as\s+/);
                bindings[local] = module[exported];
            }
        } else bindings[clause.trim()] = module.default;
    }
    const body = script.replace(/^\s*import\s+([^;]+?)\s+from\s+['"]([^'"]+)['"];\s*$/gm, '');
    assert.doesNotMatch(body, /^\s*import\s/m, 'Tous les imports du script doivent être résolus');
    env.store.timestamp = Date.parse(bindings.buildHistory(bindings.historySnapshot).newest) || Date.now();
    const context = vm.createContext({ ...bindings, ...env.globals, L: env.L });
    vm.runInContext(body, context, { filename: 'plugin.svelte<script>' });
    assert.equal(env.mounts.length, 1);
    const reactive = body.slice(body.indexOf('$: navigation'), body.indexOf('    function showBoat'));
    const reactiveInputs = '([history, activeTimestamp, syncWeather, now, selectedClass, query, selectedId, traceMode, colorMode, typeof followLatest === "undefined" ? undefined : followLatest])';
    let previousInputs = vm.runInContext(reactiveInputs, context);
    const state = () => {
        const inputs = vm.runInContext(reactiveInputs, context);
        if (inputs.some((value, index) => value !== previousInputs[index])) {
            vm.runInContext(reactive, context);
            previousInputs = inputs;
        }
        return vm.runInContext(
            '({ mapNotice, finishNotice, mounted, boatCount: boats.length, standingsCount: standings.size, activeTimestamp, weatherTimestamp, atLatest, followLatest: typeof followLatest === "undefined" ? undefined : followLatest, cursorTime, cursorIndex, source, error, busy, fetchedAt, lastAttemptAt, liveUrl, newest: history.newest, reportCount: history.times.length, classes, displayOldest: formatDate(history.oldest) })', context);
    };
    const active = kind => [...env.map.layers].filter(layer => layer.kind === kind);
    return {
        ...env, state, active,
        evaluate: code => vm.runInContext(code, context),
        mount: () => env.mounts[0](),
        destroy: () => env.destroys.forEach(callback => callback()),
    };
}

function assertFleetStarted(env) {
    assert.equal(env.state().boatCount, 115);
    assert.equal(env.state().standingsCount, 115);
    assert.equal(env.active('boat').length, 115);
    assert.equal(env.active('trace').length, 115);
    assert.equal(env.state().mapNotice, '');
    assert.equal(env.state().mounted, true);
    assert.equal(env.tooltipCalls(), 0);
}

test('Le montage réel affiche 115 bateaux et leurs traces malgré les tooltips LeafletGL refusés', async () => {
    const env = await prepareStartup();
    try {
        assert.doesNotThrow(env.mount);
        assertFleetStarted(env);
        assert.equal(env.active('finish-line').length, 1);
        assert.equal(env.active('finish-flag').length, 1);
        assert.equal(env.state().finishNotice, '');
        assert.equal(env.warnings.length, 0);
        assert.equal(env.errors.length, 0);
    } finally { env.destroy(); }
    assert.equal(env.map.layers.size, 0);
    assert.equal(env.intervals.size, 0);
});

for (const failingDecoration of ['finish-line', 'finish-flag']) {
    test(`Un ajout partiel de ${failingDecoration} n'empêche pas le montage des 115 bateaux`, async () => {
        const env = await prepareStartup({ failingDecoration });
        try {
            assert.doesNotThrow(env.mount);
            assertFleetStarted(env);
            assert.equal(env.active('finish-line').length, 0);
            assert.equal(env.active('finish-flag').length, 0);
            assert.match(env.state().finishNotice, /repère d’arrivée/);
            assert.equal(env.warnings.length, 1);
            assert.equal(env.errors.length, 0);
        } finally { env.destroy(); }
        assert.equal(env.map.layers.size, 0);
        assert.equal(env.intervals.size, 0);
    });
}

test('Une erreur des marqueurs devient un diagnostic visible dans le panneau', async () => {
    const env = await prepareStartup({ failBoats: true });
    try {
        assert.doesNotThrow(env.mount);
        assert.match(env.state().mapNotice, /Affichage des bateaux impossible.*Marqueurs indisponibles/);
        assert.equal(env.state().finishNotice, '');
        assert.equal(env.active('boat').length, 0);
        assert.equal(env.errors.length, 1);
    } finally { env.destroy(); }
    assert.equal(env.map.layers.size, 0);
});

const publicFeedUrl = 'https://positions.example.org/historique.json';
const publicOptions = { runtimeConfig: { publicMode: true, feedUrl: publicFeedUrl } };
const feedResponse = (fleets = suppliedReports) => ({
    ok: true,
    text: async () => JSON.stringify({ type: 'RhumHistory', schema: 'rhum-history/v1', fleets }),
});
const settle = () => new Promise(resolve => setImmediate(resolve));

test('Le paquet public démarre sans exposer les anciennes positions intégrées', async () => {
    const requests = [];
    const env = await prepareStartup({ ...publicOptions, fetch: (url, options) => {
        requests.push({ url, options });
        return new Promise(() => {});
    } });
    try {
        const initial = env.state();
        assert.equal(initial.boatCount, 0);
        assert.equal(initial.reportCount, 0);
        assert.equal(initial.cursorTime, null);
        assert.equal(initial.cursorIndex, 0);
        assert.equal(initial.displayOldest, '—');
        assert.equal(initial.classes.length, 0);
        assert.ok(Number.isFinite(initial.activeTimestamp));
        assert.doesNotThrow(() => env.evaluate('seek(-1); play(); setRaceTime(NaN);'));
        assert.ok(Number.isFinite(env.state().activeTimestamp));
        env.mount();
        assert.equal(env.active('boat').length, 0);
        assert.equal(requests.length, 1);
        assert.equal(requests[0].url, publicFeedUrl);
        assert.equal(requests[0].options.credentials, 'omit');
        assert.equal(requests[0].options.cache, 'no-cache');
        assert.equal(env.state().busy, true);
        assert.equal(env.state().mapNotice, '');
    } finally { env.destroy(); }
});

test('Le premier chargement public affiche la flotte et sélectionne le relevé le plus récent', async () => {
    const env = await prepareStartup({ ...publicOptions, historySnapshot: [], fetch: async () => feedResponse() });
    try {
        env.mount();
        await settle();
        const state = env.state();
        assert.equal(state.error, '');
        assert.equal(state.busy, false);
        assert.equal(state.boatCount, 115);
        assert.equal(env.active('boat').length, 115);
        assert.equal(state.activeTimestamp, Date.parse(state.newest));
        assert.equal(state.liveUrl, publicFeedUrl);
        assert.ok(state.fetchedAt);
    } finally { env.destroy(); }
});

test('Un premier relevé public conserve les 115 positions même sans rangs communiqués', async () => {
    const fleet = suppliedReports.at(-1).map(boat => ({ ...boat, rank: 0 }));
    const env = await prepareStartup({ ...publicOptions, historySnapshot: [], fetch: async () => feedResponse([fleet]) });
    try {
        env.mount();
        await settle();
        assert.equal(env.state().boatCount, 115);
        assert.equal(env.state().standingsCount, 115);
        assert.equal(env.active('boat').length, 115);
        assert.equal(env.state().mapNotice, '');
        assert.equal(env.state().error, '');
        assert.equal(env.evaluate('boats.every(boat => boat.rank === 0)'), true);
        assert.equal(env.evaluate('[...standings.values()].every(standing => standing.rank === null && !standing.isLeader)'), true);
        assert.equal(env.evaluate('rankLabel(0)'), '—');
        assert.equal(env.evaluate('rankLabel(null)'), '—');
        assert.equal(env.evaluate('rankLabel(1)'), '1er');
        assert.equal(env.evaluate('rankLabel(2)'), '2e');
        const card = env.evaluate('boatCardHtml(boats[0], { fleet: boats, history })');
        assert.match(card, /aria-label="Rang transmis : Non communiqué"/);
        assert.match(card, /<strong>—<\/strong>/);
        assert.doesNotMatch(card, /0<small>e<\/small>/);
    } finally { env.destroy(); }
});

test('Un rang 0 ne bloque pas le relevé suivant et se place après les classés de sa classe', async () => {
    let attempts = 0;
    const earlier = suppliedReports.slice(0, -1);
    const unrankedId = suppliedReports.at(-1)[0].id;
    const later = suppliedReports.map((fleet, index) => index === suppliedReports.length - 1 ?
        fleet.map(boat => boat.id === unrankedId ? { ...boat, rank: 0 } : boat) : fleet);
    const env = await prepareStartup({ ...publicOptions, historySnapshot: [],
        fetch: async () => feedResponse(++attempts === 1 ? earlier : later),
    });
    try {
        env.mount();
        await settle();
        const previous = env.state();
        env.advanceTime(300000);
        for (const tick of env.intervals.values()) tick();
        await settle();
        const current = env.state();
        assert.equal(attempts, 2);
        assertFleetStarted(env);
        assert.equal(current.error, '');
        assert.ok(Date.parse(current.newest) > Date.parse(previous.newest));
        assert.equal(current.activeTimestamp, Date.parse(current.newest));
        assert.equal(env.evaluate(`boats.find(boat => boat.id === ${unrankedId}).rank`), 0);
        const classIds = Array.from(env.evaluate(`filtered.filter(boat => boat.className ===
            boats.find(boat => boat.id === ${unrankedId}).className).map(boat => boat.id)`));
        assert.ok(classIds.length > 1);
        assert.equal(classIds.at(-1), unrankedId);
        const ranked = Array.from(env.evaluate(`filtered.filter(boat => boat.className ===
            boats.find(boat => boat.id === ${unrankedId}).className && boat.rank > 0).map(boat => boat.rank)`));
        assert.deepEqual(ranked, [...ranked].sort((a, b) => a - b));
    } finally { env.destroy(); }
});

test('Un premier échec public est retenté après cinq minutes même sans relevé reçu', async () => {
    let attempts = 0;
    const env = await prepareStartup({ ...publicOptions, historySnapshot: [], fetch: async () => {
        if (++attempts === 1) throw new Error('Réseau indisponible');
        return feedResponse();
    } });
    try {
        env.mount();
        await settle();
        const failed = env.state();
        assert.equal(attempts, 1);
        assert.equal(failed.boatCount, 0);
        assert.equal(failed.fetchedAt, '');
        assert.match(failed.error, /Nouvelle tentative automatique/);
        assert.doesNotMatch(failed.error, /précédent reste affiché/);
        env.advanceTime(299999);
        for (const tick of env.intervals.values()) tick();
        await settle();
        assert.equal(attempts, 1);
        env.advanceTime(1);
        for (const tick of env.intervals.values()) tick();
        await settle();
        const recovered = env.state();
        assert.equal(attempts, 2);
        assert.equal(recovered.boatCount, 115);
        assert.equal(recovered.error, '');
        assert.equal(recovered.activeTimestamp, Date.parse(recovered.newest));
    } finally { env.destroy(); }
});

test('Une coupure ultérieure conserve les positions publiques et espace les nouvelles tentatives', async () => {
    let attempts = 0;
    const env = await prepareStartup({ ...publicOptions, historySnapshot: [], fetch: async () => {
        if (++attempts > 1) throw new Error('Réseau indisponible');
        return feedResponse();
    } });
    try {
        env.mount();
        await settle();
        const previous = env.state();
        env.advanceTime(300000);
        for (const tick of env.intervals.values()) tick();
        await settle();
        const failed = env.state();
        assert.equal(failed.boatCount, 115);
        assert.equal(failed.newest, previous.newest);
        assert.equal(failed.fetchedAt, previous.fetchedAt);
        assert.match(failed.error, /dernier relevé reçu reste affiché/);
        env.advanceTime(60000);
        for (const tick of env.intervals.values()) tick();
        await settle();
        assert.equal(attempts, 2);
    } finally { env.destroy(); }
});

test('Le paquet local conserve sa flotte intégrée sans connexion automatique', async () => {
    let attempts = 0;
    const env = await prepareStartup({ fetch: async () => { ++attempts; return feedResponse(); } });
    try {
        env.mount();
        await settle();
        assertFleetStarted(env);
        assert.equal(attempts, 0);
        assert.equal(env.state().liveUrl, '');
    } finally { env.destroy(); }
});

for (const publicMode of [true, false]) {
    for (const futureWeather of [false, true]) {
        test(`${publicMode ? 'Public' : 'Local'} : une actualisation ${futureWeather ? 'préserve l’heure météo future' : 'avance depuis le dernier point avec la météo liée'}`, async () => {
            let attempts = 0;
            const earlier = suppliedReports.slice(0, -1);
            const env = await prepareStartup({
                runtimeConfig: { publicMode, feedUrl: publicFeedUrl },
                historySnapshot: earlier,
                fetch: async () => feedResponse(++attempts === 1 ? earlier : suppliedReports),
            });
            try {
                env.mount();
                if (!publicMode) await env.evaluate(`loadUrl(${JSON.stringify(publicFeedUrl)})`);
                await settle();
                const first = env.state();
                assert.equal(first.activeTimestamp, Date.parse(first.newest));
                const requested = first.activeTimestamp + 12 * 3600000;
                if (futureWeather) env.evaluate(`receiveWeatherTime(${requested}, { programmatic: false })`);
                env.state();
                env.advanceTime(300000);
                for (const tick of env.intervals.values()) tick();
                await settle();
                const second = env.state();
                assert.equal(attempts, 2);
                assert.ok(Date.parse(second.newest) > Date.parse(first.newest));
                assert.equal(second.activeTimestamp, futureWeather ? requested : Date.parse(second.newest));
                assert.equal(second.error, '');
            } finally { env.destroy(); }
        });
    }
}

test('Une actualisation publique conserve un instant de rejeu météo antérieur', async () => {
    let attempts = 0;
    const earlier = suppliedReports.slice(0, -1);
    const env = await prepareStartup({ ...publicOptions,
        fetch: async () => feedResponse(++attempts === 1 ? earlier : suppliedReports),
    });
    try {
        env.mount();
        await settle();
        const first = env.state();
        const requested = first.activeTimestamp - 2 * 3600000;
        env.evaluate(`receiveWeatherTime(${requested}, { programmatic: false })`);
        env.state();
        env.advanceTime(300000);
        for (const tick of env.intervals.values()) tick();
        await settle();
        const second = env.state();
        assert.ok(Date.parse(second.newest) > Date.parse(first.newest));
        assert.equal(second.activeTimestamp, requested);
    } finally { env.destroy(); }
});

async function pollAfter(env, milliseconds = 300000) {
    env.advanceTime(milliseconds);
    for (const tick of [...env.intervals.values()]) tick();
    await settle();
    return env.state();
}

const floorMinute = timestamp => Math.floor(timestamp / 60000) * 60000;
const ceilMinute = timestamp => Math.ceil(timestamp / 60000) * 60000;

for (const [rounding, normalizeWeather] of [['inférieure', floorMinute], ['supérieure', ceilMinute]]) {
    test(`Le direct avance sur deux nouveaux relevés malgré l’arrondi météo à la minute ${rounding}`, async () => {
        const firstReports = suppliedReports.slice(0, -2);
        const secondReports = suppliedReports.slice(0, -1);
        const responses = [firstReports, firstReports, secondReports, suppliedReports];
        let attempts = 0;
        const env = await prepareStartup({ ...publicOptions, historySnapshot: [], normalizeWeather,
            fetch: async () => feedResponse(responses[attempts++]),
        });
        try {
            env.mount();
            await settle();
            let previous = env.state();
            assert.ok(env.store.writes.length > 0, 'Le véritable aller-retour via le store météo doit être exercé');
            for (const expected of [firstReports, secondReports, suppliedReports]) {
                const current = await pollAfter(env);
                assert.equal(current.error, '');
                assert.equal(current.activeTimestamp, Date.parse(current.newest), 'Le curseur de course reste sur le relevé exact');
                assert.equal(current.weatherTimestamp, normalizeWeather(current.activeTimestamp));
                assert.equal(current.followLatest, true);
                assert.equal(current.atLatest, true);
                assert.ok(Date.parse(current.fetchedAt) > Date.parse(previous.fetchedAt));
                const expectedNewest = Math.max(...expected.flat().map(boat => Date.parse(boat.time)));
                assert.equal(Date.parse(current.newest), expectedNewest);
                assert.equal(env.evaluate('boats.every(boat => !boat.interpolated)'), true);
                assertFleetStarted(env);
                previous = current;
            }
            assert.equal(attempts, 4);
            assert.equal(env.store.writes.length, 4);
        } finally { env.destroy(); }
    });
}

test('Une coupure réseau puis deux nouveaux relevés conservent le suivi du direct malgré l’arrondi météo', async () => {
    let attempts = 0;
    const firstReports = suppliedReports.slice(0, -2);
    const secondReports = suppliedReports.slice(0, -1);
    const env = await prepareStartup({ ...publicOptions, historySnapshot: [], normalizeWeather: floorMinute,
        fetch: async () => {
            ++attempts;
            if (attempts === 2) throw new Error('Coupure temporaire');
            return feedResponse(attempts === 1 ? firstReports : attempts === 3 ? secondReports : suppliedReports);
        },
    });
    try {
        env.mount();
        await settle();
        const first = env.state();
        const interrupted = await pollAfter(env);
        assert.match(interrupted.error, /dernier relevé reçu reste affiché/);
        assert.equal(interrupted.activeTimestamp, Date.parse(first.newest));
        assert.equal(interrupted.followLatest, true);
        for (let index = 0; index < 2; index++) {
            const recovered = await pollAfter(env);
            assert.equal(recovered.error, '');
            assert.ok(Date.parse(recovered.newest) > Date.parse(first.newest));
            assert.equal(recovered.activeTimestamp, Date.parse(recovered.newest));
            assert.equal(recovered.followLatest, true);
            assert.equal(recovered.weatherTimestamp, floorMinute(recovered.activeTimestamp));
        }
        assert.equal(attempts, 4);
    } finally { env.destroy(); }
});

test('Un vrai rejeu reste sélectionné puis Dernier relevé réactive le suivi automatique', async () => {
    let attempts = 0;
    const firstReports = suppliedReports.slice(0, -2);
    const secondReports = suppliedReports.slice(0, -1);
    const env = await prepareStartup({ ...publicOptions, historySnapshot: [], normalizeWeather: floorMinute,
        fetch: async () => feedResponse(++attempts === 1 ? firstReports : attempts === 2 ? secondReports : suppliedReports),
    });
    try {
        env.mount();
        await settle();
        env.state();
        env.evaluate('seek(2)');
        await settle();
        const replay = env.state();
        assert.equal(replay.followLatest, false);
        assert.equal(replay.atLatest, false);
        assert.equal(replay.activeTimestamp, env.evaluate('Date.parse(history.times[2])'));
        const updatedReplay = await pollAfter(env);
        assert.ok(Date.parse(updatedReplay.newest) > Date.parse(replay.newest));
        assert.equal(updatedReplay.activeTimestamp, replay.activeTimestamp);
        assert.equal(updatedReplay.followLatest, false);
        env.evaluate('seek(history.times.length - 1)');
        await settle();
        const resumed = env.state();
        assert.equal(resumed.activeTimestamp, Date.parse(resumed.newest));
        assert.equal(resumed.followLatest, true);
        const next = await pollAfter(env);
        assert.ok(Date.parse(next.newest) > Date.parse(resumed.newest));
        assert.equal(next.activeTimestamp, Date.parse(next.newest));
        assert.equal(next.followLatest, true);
    } finally { env.destroy(); }
});

for (const offset of [-2, 12]) {
    test(`Un vrai déplacement du curseur météo de ${offset} h garde son heure pendant les actualisations`, async () => {
        let attempts = 0;
        const firstReports = suppliedReports.slice(0, -2);
        const env = await prepareStartup({ ...publicOptions, historySnapshot: [], normalizeWeather: floorMinute,
            fetch: async () => feedResponse(++attempts === 1 ? firstReports : suppliedReports),
        });
        try {
            env.mount();
            await settle();
            const first = env.state();
            const requested = first.activeTimestamp + offset * 3600000;
            env.emitWeather(requested);
            const selected = env.state();
            assert.equal(selected.activeTimestamp, requested);
            assert.equal(selected.followLatest, false);
            const updated = await pollAfter(env);
            assert.ok(Date.parse(updated.newest) > Date.parse(first.newest));
            assert.equal(updated.activeTimestamp, requested);
            assert.equal(updated.weatherTimestamp, requested);
            assert.equal(updated.followLatest, false);
        } finally { env.destroy(); }
    });
}

for (const weatherCalendar of [null, {
    start: Date.parse('2026-11-10T00:00:00Z'), end: Date.parse('2026-11-30T00:00:00Z'),
}]) {
    test(`Le direct continue lorsque le calendrier météo est ${weatherCalendar ? 'hors de la course' : 'absent'}`, async () => {
        let attempts = 0;
        const env = await prepareStartup({ ...publicOptions, historySnapshot: [], weatherCalendar,
            fetch: async () => feedResponse(++attempts === 1 ? suppliedReports.slice(0, -1) : suppliedReports),
        });
        try {
            env.mount();
            await settle();
            const first = env.state();
            const next = await pollAfter(env);
            assert.equal(next.error, '');
            assert.ok(Date.parse(next.newest) > Date.parse(first.newest));
            assert.equal(next.activeTimestamp, Date.parse(next.newest));
            assert.equal(next.followLatest, true);
            assert.equal(env.store.writes.length, 0);
        } finally { env.destroy(); }
    });
}

test('Réactiver la liaison météo au direct conserve le dernier relevé et les actualisations suivantes', async () => {
    let attempts = 0;
    const env = await prepareStartup({ ...publicOptions, historySnapshot: [], normalizeWeather: floorMinute,
        fetch: async () => feedResponse(++attempts === 1 ? suppliedReports.slice(0, -2) :
            attempts === 2 ? suppliedReports.slice(0, -1) : suppliedReports),
    });
    try {
        env.mount();
        await settle();
        const first = env.state();
        env.evaluate('changeSync({ currentTarget: { checked: false } })');
        env.state();
        const independent = await pollAfter(env);
        assert.ok(Date.parse(independent.newest) > Date.parse(first.newest));
        assert.equal(independent.activeTimestamp, Date.parse(independent.newest));
        assert.equal(independent.weatherTimestamp, first.weatherTimestamp);
        assert.equal(independent.followLatest, true);
        env.evaluate('changeSync({ currentTarget: { checked: true } })');
        await settle();
        const linked = env.state();
        assert.equal(linked.activeTimestamp, Date.parse(linked.newest));
        assert.equal(linked.weatherTimestamp, floorMinute(linked.activeTimestamp));
        assert.equal(linked.followLatest, true);
        const next = await pollAfter(env);
        assert.ok(Date.parse(next.newest) > Date.parse(linked.newest));
        assert.equal(next.activeTimestamp, Date.parse(next.newest));
        assert.equal(next.followLatest, true);
    } finally { env.destroy(); }
});

test('Réactiver la liaison pendant un rejeu respecte la véritable heure météo choisie', async () => {
    let attempts = 0;
    const env = await prepareStartup({ ...publicOptions, historySnapshot: [], normalizeWeather: floorMinute,
        fetch: async () => feedResponse(++attempts === 1 ? suppliedReports.slice(0, -1) : suppliedReports),
    });
    try {
        env.mount();
        await settle();
        env.state();
        env.evaluate('seek(2)');
        await settle();
        const replay = env.state();
        env.evaluate('changeSync({ currentTarget: { checked: false } })');
        const requested = replay.activeTimestamp + 3600000;
        env.emitWeather(requested);
        assert.equal(env.state().activeTimestamp, replay.activeTimestamp);
        env.evaluate('changeSync({ currentTarget: { checked: true } })');
        const linked = env.state();
        assert.equal(linked.activeTimestamp, requested);
        assert.equal(linked.followLatest, false);
        const next = await pollAfter(env);
        assert.ok(Date.parse(next.newest) > Date.parse(linked.newest));
        assert.equal(next.activeTimestamp, requested);
        assert.equal(next.followLatest, false);
    } finally { env.destroy(); }
});

test('Le retour sur un onglet visible actualise immédiatement une vérification échue et retire ses écouteurs à la fermeture', async () => {
    let attempts = 0;
    const env = await prepareStartup({ ...publicOptions, historySnapshot: [], normalizeWeather: floorMinute,
        fetch: async () => feedResponse(++attempts === 1 ? suppliedReports.slice(0, -1) : suppliedReports),
    });
    try {
        env.mount();
        await settle();
        const first = env.state();
        env.advanceTime(299999);
        env.emitWindow('focus');
        env.emitWindow('online');
        env.emitDocument('visibilitychange');
        await settle();
        assert.equal(attempts, 1, 'Les événements ne doivent pas contourner le délai de vérification');
        env.advanceTime(1);
        env.document.visibilityState = 'hidden';
        env.emitDocument('visibilitychange');
        await settle();
        assert.equal(attempts, 1);
        env.document.visibilityState = 'visible';
        env.emitDocument('visibilitychange');
        env.emitWindow('focus');
        env.emitWindow('online');
        await settle();
        assert.equal(attempts, 2, 'Les événements rapprochés doivent partager un seul chargement');
        const updated = env.state();
        assert.ok(Date.parse(updated.newest) > Date.parse(first.newest));
        assert.equal(updated.activeTimestamp, Date.parse(updated.newest));
        assert.equal(updated.followLatest, true);
    } finally { env.destroy(); }
    assert.equal(env.window.events.get('focus')?.size || 0, 0);
    assert.equal(env.window.events.get('online')?.size || 0, 0);
    assert.equal(env.document.events.get('visibilitychange')?.size || 0, 0);
    assert.equal(env.store.events.get('timestamp')?.size || 0, 0);
    env.advanceTime(300000);
    env.emitWindow('focus');
    env.emitWindow('online');
    env.emitDocument('visibilitychange');
    await settle();
    assert.equal(attempts, 2);
});
