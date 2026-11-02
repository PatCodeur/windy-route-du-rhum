/** Lecture des relevés isolés et de l’historique conservé par le relais FTP. */
import { normalizeFleet, parsePositions } from './data.js';

export const HISTORY_SCHEMA = 'rhum-history/v1';

function enrich(fleet, identities) {
    return fleet.map(boat => {
        if (!Object.hasOwn(identities, boat.id)) return boat;
        const identity = identities[boat.id];
        if (!identity || typeof identity.skipper !== 'string' || !identity.skipper.trim() ||
            typeof identity.name !== 'string' || !identity.name.trim() ||
            typeof identity.className !== 'string' || !identity.className.trim()) {
            throw new Error(`Identité invalide pour le bateau ${boat.id}.`);
        }
        return { ...boat, skipper: identity.skipper, name: identity.name,
            className: identity.className, known: true };
    });
}

/** Conversion par le validateur GeoJSON existant, sans faire confiance aux objets reçus. */
function normalizedArray(fleet) {
    if (!Array.isArray(fleet) || !fleet.length) throw new Error('Chaque relevé doit contenir des bateaux.');
    return normalizeFleet({ type: 'FeatureCollection', features: fleet.map(boat => ({
        type: 'Feature', id: boat?.id, properties: boat,
        geometry: { type: 'Point', coordinates: [boat?.lon, boat?.lat] }
    })) });
}

/** Retourne toujours une liste de flottes normalisées : POSREPORT, GeoJSON ou RhumHistory. */
export function parseFeed(text, identities = {}) {
    if (typeof text !== 'string') throw new Error('Le flux doit contenir du texte.');
    if (!identities || typeof identities !== 'object' || Array.isArray(identities)) {
        throw new Error('Annuaire des concurrents invalide.');
    }
    const source = text.replace(/^\uFEFF/, '').trim();
    if (/^POSREPORT(?:\r?\n|\r|$)/.test(source)) return [parsePositions(source, identities)];
    let feed;
    try {
        feed = JSON.parse(source);
    } catch {
        throw new Error('Le flux doit être un relevé POSREPORT ou un document JSON valide.');
    }
    if (feed?.type === 'FeatureCollection') return [enrich(normalizeFleet(feed), identities)];
    if (feed?.type !== 'RhumHistory' || feed.schema !== HISTORY_SCHEMA ||
        !Array.isArray(feed.fleets) || !feed.fleets.length) {
        throw new Error('Historique non reconnu : format rhum-history/v1 attendu.');
    }
    // Aucun plafond arbitraire à 3 Mo : un historique de course complet le dépasse.
    return feed.fleets.map(fleet => enrich(normalizedArray(fleet), identities));
}
