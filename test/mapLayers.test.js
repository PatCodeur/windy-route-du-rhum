import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapLayers } from '../src/mapLayers.js';

class Evented {
    events = new Map();
    on(type, listener) {
        if (!this.events.has(type)) this.events.set(type, new Set());
        this.events.get(type).add(listener);
        return this;
    }
    off(type, listener) { this.events.get(type)?.delete(listener); return this; }
    fire(type, data = {}) {
        for (const listener of this.events.get(type) || []) listener({ ...data, target: this });
        return this;
    }
    listenerCount(type) { return this.events.get(type)?.size || 0; }
}

function setup(onSelect = () => {}) {
    const created = { markers: [], lines: [], popups: [] };
    class Map extends Evented {
        layers = new Set();
        addLayer(layer) { this.layers.add(layer); layer.map = this; return this; }
        removeLayer(layer) {
            if (this.layers.delete(layer)) {
                layer.fire('remove');
                if (layer instanceof Popup) this.fire('popupclose', { popup: layer });
            }
            return this;
        }
    }
    class Marker extends Evented {
        constructor(position, options) {
            super(); this.position = position; this.options = options;
            this.iconUpdates = 0; created.markers.push(this);
        }
        addTo(map) { map.addLayer(this); return this; }
        setLatLng(position) { this.position = position; return this; }
        setIcon(icon) { this.options.icon = icon; ++this.iconUpdates; return this; }
        setZIndexOffset(value) { this.zIndexOffset = value; return this; }
    }
    class Polyline extends Evented {
        constructor(points, options) { super(); this.points = points; this.options = options; created.lines.push(this); }
        addTo(map) { map.addLayer(this); return this; }
        setLatLngs(points) { this.points = points; return this; }
        setStyle(options) { this.options = options; return this; }
        bringToBack() { this.atBack = true; return this; }
    }
    class Popup extends Evented {
        constructor(options) { super(); this.options = options; this.openings = 0; created.popups.push(this); }
        setLatLng(position) { this.position = position; return this; }
        setContent(content) { this.content = content; return this; }
        openOn(map) {
            if (this.removeBeforeOpen && map.layers.has(this)) map.removeLayer(this);
            if (map.currentPopup && map.currentPopup !== this) map.removeLayer(map.currentPopup);
            map.currentPopup = this;
            map.addLayer(this); ++this.openings;
            return this;
        }
        remove() { this.map?.removeLayer(this); return this; }
    }
    const map = new Map();
    const layers = createMapLayers({ map, L: { Marker, Polyline, Popup }, onSelect });
    const boat = (id = 5, extra = {}) => ({ id, lat: 47, lon: -20, time: '2026-11-02T12:00:00Z', name: `Bateau ${id}`, ...extra });
    const frame = (boats, extra = {}) => ({
        boats, selectedId: 5, traceMode: 'all',
        iconFor: (item, selected) => ({ options: { html: `${item.id}:${selected}`, className: 'boat' } }),
        popupFor: item => `${item.name}:${item.time}`,
        traceFor: item => [[48, -19], [item.lat, item.lon]],
        lineStyleFor: (item, selected) => ({ color: selected ? 'red' : 'blue', interactive: true }),
        ...extra
    });
    return { layers, map, created, boat, frame };
}

test('Le rejeu conserve les marqueurs et les clics consultent la dernière position', () => {
    const selected = [];
    const { layers, created, boat, frame } = setup(item => selected.push(item));
    layers.update(frame([boat()]));
    const marker = created.markers[0];
    layers.update(frame([boat(5, { lat: 45, lon: -23, time: '2026-11-02T13:00:00Z' })]));
    marker.fire('click');
    assert.equal(created.markers.length, 1);
    assert.equal(marker.iconUpdates, 0, 'Une icône identique conserve son élément');
    assert.deepEqual(marker.position, [45, -23]);
    assert.deepEqual(created.popups[0].position, [45, -23]);
    assert.match(created.popups[0].content, /13:00:00/);
    assert.equal(selected[0].lat, 45);
    assert.equal(marker.listenerCount('click'), 1);
});

test('Une fiche fermée reste fermée pendant les mises à jour et se rouvre au clic', () => {
    const { layers, map, created, boat, frame } = setup();
    layers.update(frame([boat()]));
    for (let i = 0; i < 4; ++i) {
        created.markers[0].fire('click');
        const popup = created.popups[0];
        assert.ok(map.layers.has(popup));
        map.removeLayer(popup); // fermeture par la croix ou clic sur le fond de carte
        layers.update(frame([boat(5, { lat: 47 - i })]));
        assert.ok(!map.layers.has(popup));
    }
    assert.equal(created.popups.length, 1);
    assert.equal(created.popups[0].openings, 4);
});

test('La suppression directe de la fiche réinitialise aussi son état', () => {
    const { layers, created, boat, frame } = setup();
    layers.update(frame([boat()]));
    layers.openBoat(5);
    const popup = created.popups[0];
    popup.remove();
    const content = popup.content;
    layers.update(frame([boat(5, { time: '2026-11-02T14:00:00Z' })]));
    assert.equal(popup.content, content, 'La fiche fermée ne reçoit plus de mises à jour');
    assert.equal(layers.openBoat(5), true);
    assert.match(popup.content, /14:00:00/);
});

test('La fiche suit le bateau pendant le rejeu et permet de changer de sélection', () => {
    const { layers, created, boat, frame } = setup();
    layers.update(frame([boat(), boat(6)]));
    layers.openBoat(5);
    layers.update(frame([boat(5, { lat: 42 }), boat(6)], { selectedId: 6 }));
    assert.deepEqual(created.popups[0].position, [42, -20]);
    assert.equal(created.markers[0].zIndexOffset, 0);
    assert.equal(created.markers[1].zIndexOffset, 1000);
    created.markers[1].fire('click');
    assert.match(created.popups[0].content, /Bateau 6/);
    assert.equal(created.popups.length, 1);
});

test('Les traces restent derrière les bateaux et ne capturent pas les clics', () => {
    const { layers, map, created, boat, frame } = setup();
    layers.update(frame([boat(), boat(6)]));
    assert.ok(created.lines.every(line => !line.options.interactive && line.atBack));
    layers.update(frame([boat(5, { lat: 40 }), boat(6)], { traceMode: 'selected' }));
    assert.equal(created.lines.length, 2, 'La trace est mise à jour sans être recréée');
    assert.deepEqual(created.lines[0].points.at(-1), [40, -20]);
    assert.ok(!map.layers.has(created.lines[1]));
    layers.update(frame([boat(), boat(6)], { traceMode: 'none' }));
    assert.ok(created.lines.every(line => !map.layers.has(line)));
});

test('Filtrer le bateau ferme sa fiche et retire son unique gestionnaire de clic', () => {
    const { layers, map, created, boat, frame } = setup();
    layers.update(frame([boat(), boat(6)]));
    layers.openBoat(5);
    layers.update(frame([boat(6)]));
    assert.ok(!map.layers.has(created.popups[0]));
    assert.ok(!map.layers.has(created.markers[0]));
    assert.equal(created.markers[0].listenerCount('click'), 0);
    assert.equal(layers.openBoat(5), false);
    layers.update(frame([boat(), boat(6)]));
    layers.openBoat(5);
    assert.ok(map.layers.has(created.popups[0]));
});

test('La fermeture d’une autre fiche Windy ne ferme pas celle de la course', () => {
    const { layers, map, created, boat, frame } = setup();
    layers.update(frame([boat()]));
    layers.openBoat(5);
    map.fire('popupclose', { popup: {} });
    map.fire('popupclose'); // Événement sans référence à notre fiche : aucune fermeture supposée.
    layers.update(frame([boat(5, { lat: 43 })]));
    assert.deepEqual(created.popups[0].position, [43, -20]);
});

test('La fiche reste liée au bateau si Leaflet la retire pendant openOn', () => {
    const { layers, map, created, boat, frame } = setup();
    layers.update(frame([boat(), boat(6)]));
    layers.openBoat(5);
    const popup = created.popups[0];
    popup.removeBeforeOpen = true;
    layers.openBoat(6);
    layers.update(frame([boat(), boat(6, { lat: 41, time: '2026-11-02T15:00:00Z' })]));
    assert.ok(map.layers.has(popup));
    assert.deepEqual(popup.position, [41, -20]);
    assert.match(popup.content, /Bateau 6:2026-11-02T15:00:00Z/);
    assert.equal(popup.options.closeOnClick, false);
    assert.equal(popup.options.autoClose, false);
});

test('Détruire le plugin retire toutes ses couches et tous ses écouteurs', () => {
    const { layers, map, created, boat, frame } = setup();
    layers.update(frame([boat(), boat(6)]));
    layers.openBoat(5);
    layers.destroy();
    layers.destroy();
    assert.equal(map.layers.size, 0);
    assert.equal(map.listenerCount('popupclose'), 0);
    assert.equal(created.popups[0].listenerCount('remove'), 0);
    assert.ok(created.markers.every(marker => marker.listenerCount('click') === 0));
    assert.equal(layers.openBoat(5), false);
    layers.update(frame([boat()]));
    assert.equal(map.layers.size, 0);
});
