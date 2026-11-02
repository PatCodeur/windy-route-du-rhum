import { FINISH_LINE } from './finishLine.js';

/**
 * L'arrivée est un repère facultatif : son affichage ne doit pas empêcher la
 * flotte de démarrer. Certaines couches LeafletGL refusent bindTooltip, même
 * lorsque la méthode existe ; le drapeau porte donc son propre libellé.
 */
export function createFinishLayers({ map, L, onError = () => {} }) {
    const layers = [];
    let destroyed = false;
    let available = false;

    function destroy() {
        if (destroyed) return;
        destroyed = true;
        available = false;
        // Chaque couche est enregistrée avant addTo : celui-ci peut l'ajouter
        // partiellement à la carte avant de lever une exception.
        for (const layer of layers.splice(0)) {
            try { map.removeLayer(layer); }
            catch {
                // Un retrait incomplet ne doit pas empêcher les autres retraits.
                try { layer.remove?.(); } catch { /* Carte déjà détruite. */ }
            }
        }
    }

    function add(createLayer) {
        const layer = createLayer();
        layers.push(layer);
        layer.addTo(map);
    }

    try {
        add(() => new L.Polyline([
            [FINISH_LINE.east.lat, FINISH_LINE.east.lon],
            [FINISH_LINE.west.lat, FINISH_LINE.west.lon],
        ], { color: '#ffffff', weight: 5, opacity: 0.95, interactive: false }));
        add(() => new L.Marker([
            FINISH_LINE.east.lat,
            (FINISH_LINE.east.lon + FINISH_LINE.west.lon) / 2,
        ], {
            title: 'Arrivée Route du Rhum · Pointe-à-Pitre · IC 2026, article 10.1',
            icon: new L.DivIcon({
                className: 'rhum-finish-icon',
                html: '<span role="img" aria-label="Ligne d’arrivée">🏁</span>',
                iconSize: [30, 34], iconAnchor: [3, 32],
            }),
        }));
        available = true;
    } catch (cause) {
        destroy();
        try { onError(cause); } catch { /* Un diagnostic ne bloque pas la flotte. */ }
    }

    return { destroy, get available() { return available; } };
}
