/** Indicateurs de classe calculés à partir des positions et de la ligne d'arrivée. */
import { distanceNm } from './geodesy.js';
import { distanceToFinishNm } from './finishLine.js';

// Export conservé pour les calculs de moyennes et les consommateurs existants.
export { distanceNm } from './geodesy.js';

function validRank(rank) {
    return Number.isSafeInteger(rank) && rank > 0 ? rank : null;
}

function className(boat) {
    const name = typeof boat?.className === 'string' ? boat.className.trim() : '';
    // Des bateaux d’identité inconnue ne constituent pas une classe sportive commune.
    return name && name !== 'Non renseignée' ? name : null;
}

function observedMilliseconds(boat) {
    // En rejeu, positionTime peut désigner une position interpolée. Le décalage doit
    // continuer à signaler l’âge réel des observations ayant servi au calcul.
    const value = boat?.observationTime ?? boat?.sourceTime ?? boat?.time;
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) {
        return null;
    }
    const milliseconds = Date.parse(value);
    if (!Number.isFinite(milliseconds)) return null;
    const canonical = value.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction) =>
        `.${(fraction || '').padEnd(3, '0')}Z`);
    return new Date(milliseconds).toISOString() === canonical ? milliseconds : null;
}

/**
 * fleet doit être la flotte complète à l’instant affiché, avant recherche ou filtre.
 * classSize compte les bateaux présents de cette classe, pas les inscrits absents.
 * Un leader absent ou ambigu laisse les métriques de comparaison à null.
 */
export function classStanding(boat, fleet) {
    const name = className(boat);
    const sameClass = name && Array.isArray(fleet) ?
        fleet.filter(candidate => className(candidate) === name) : [];
    const leaders = sameClass.filter(candidate => validRank(candidate.rank) === 1);
    const leader = leaders.length === 1 ? leaders[0] : null;
    const boatTime = observedMilliseconds(boat);
    const leaderTime = observedMilliseconds(leader);
    const distanceToFinish = distanceToFinishNm(boat);
    const leaderDistanceToFinish = leader ? distanceToFinishNm(leader) : null;
    return {
        rank: validRank(boat?.rank),
        classSize: sameClass.length,
        leader,
        distanceToFinishNm: distanceToFinish,
        leaderDistanceToFinishNm: leaderDistanceToFinish,
        // Signé : le rang source reste la référence, même si la distance géométrique
        // placerait ponctuellement un autre bateau plus près de la ligne.
        gapToLeaderNm: distanceToFinish !== null && leaderDistanceToFinish !== null ?
            distanceToFinish - leaderDistanceToFinish : null,
        leaderDistanceNm: leader ? distanceNm(boat, leader) : null,
        measurementSkewMinutes: boatTime !== null && leaderTime !== null ?
            Math.abs(boatTime - leaderTime) / 60000 : null,
        isLeader: Boolean(leader && (leader === boat ||
            (Number.isSafeInteger(boat?.id) && boat.id > 0 && boat.id === leader.id))),
        officialGapAvailable: false,
    };
}
