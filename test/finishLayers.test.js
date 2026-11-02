import test from 'node:test';
import assert from 'node:assert/strict';
import { createFinishLayers } from '../src/finishLayers.js';
import { FINISH_LINE } from '../src/finishLine.js';

function setup({ failingLayer = null, failingConstructor = null } = {}) {
    const expectedError = new Error('LeafletGL refuse la couche');
    const created = [];
    const removals = [];
    let tooltipCalls = 0;
    const map = {
        layers: new Set(),
        removeLayer(layer) { removals.push(layer); this.layers.delete(layer); },
    };
    class Layer {
        constructor(kind, position, options) {
            if (kind === failingConstructor) throw expectedError;
            this.kind = kind;
            this.position = position;
            this.options = options;
            created.push(this);
        }
        addTo(map) {
            map.layers.add(this);
            if (this.kind === failingLayer) throw expectedError;
            return this;
        }
        bindTooltip() {
            ++tooltipCalls;
            throw new Error('This layer type does not support tooltips.');
        }
    }
    class Polyline extends Layer {
        constructor(position, options) { super('line', position, options); }
    }
    class Marker extends Layer {
        constructor(position, options) { super('flag', position, options); }
    }
    class DivIcon {
        constructor(options) { this.options = options; }
    }
    return {
        map, L: { Polyline, Marker, DivIcon }, created, removals, expectedError,
        tooltipCalls: () => tooltipCalls,
    };
}

test('Les repères utilisent la ligne officielle sans tooltip LeafletGL', () => {
    const env = setup();
    const errors = [];
    const layers = createFinishLayers({ ...env, onError: error => errors.push(error) });
    assert.equal(layers.available, true);
    assert.equal(env.map.layers.size, 2);
    const [line, flag] = env.created;
    assert.deepEqual(line.position, [
        [FINISH_LINE.east.lat, FINISH_LINE.east.lon],
        [FINISH_LINE.west.lat, FINISH_LINE.west.lon],
    ]);
    assert.equal(line.options.interactive, false);
    assert.equal(flag.position[0], FINISH_LINE.east.lat);
    assert.equal(flag.position[1], (FINISH_LINE.east.lon + FINISH_LINE.west.lon) / 2);
    assert.match(flag.options.title, /Arrivée Route du Rhum/);
    assert.match(flag.options.icon.options.html, /aria-label="Ligne d’arrivée"/);
    assert.equal(env.tooltipCalls(), 0);
    assert.deepEqual(errors, []);
    layers.destroy();
});

test('Le retrait est complet et peut être répété sans effet', () => {
    const env = setup();
    const layers = createFinishLayers(env);
    layers.destroy();
    assert.equal(layers.available, false);
    assert.equal(env.map.layers.size, 0);
    assert.deepEqual(env.removals, env.created);
    layers.destroy();
    assert.equal(env.removals.length, 2);
});

for (const failingLayer of ['line', 'flag']) {
    test(`Un échec après ajout partiel de ${failingLayer} nettoie tous les repères`, () => {
        const env = setup({ failingLayer });
        const errors = [];
        let layers;
        assert.doesNotThrow(() => {
            layers = createFinishLayers({ ...env, onError: error => errors.push(error) });
        });
        assert.equal(layers.available, false);
        assert.equal(env.map.layers.size, 0);
        assert.deepEqual(env.removals, env.created);
        assert.deepEqual(errors, [env.expectedError]);
        assert.equal(env.tooltipCalls(), 0);
        layers.destroy();
        layers.destroy();
        assert.equal(env.removals.length, env.created.length);
    });
}

test('Un constructeur refusé retire aussi les couches déjà affichées', () => {
    const env = setup({ failingConstructor: 'flag' });
    const errors = [];
    const layers = createFinishLayers({ ...env, onError: error => errors.push(error) });
    assert.equal(layers.available, false);
    assert.equal(env.map.layers.size, 0);
    assert.deepEqual(env.removals, env.created);
    assert.deepEqual(errors, [env.expectedError]);
});

test('Un diagnostic défaillant ne transforme pas l’arrivée facultative en erreur fatale', () => {
    const env = setup({ failingLayer: 'flag' });
    let layers;
    assert.doesNotThrow(() => {
        layers = createFinishLayers({ ...env, onError: () => { throw new Error('Diagnostic refusé'); } });
    });
    assert.equal(layers.available, false);
    assert.equal(env.map.layers.size, 0);
});
