/** Liaison avec l’heure Windy, sans changement de modèle ou de calendrier. */

function validTime(value) {
    return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 8.64e15;
}

function label(time) {
    return new Date(time).toISOString().replace('T', ' ').replace(/\.000Z$/, ' UTC').replace(/Z$/, ' UTC');
}

/**
 * `store` expose get/set/on/off selon l’API Windy.
 * onTime reçoit l’heure brute Windy, y compris hors des relevés de course.
 * Aucune écriture n’est effectuée par l’écouteur, ce qui empêche les boucles.
 */
export function createWeatherLink(store, { onTime = () => {}, onStatus = () => {} } = {}) {
    let running = false;
    let lifecycle = 0;
    let sequence = 0;
    let setting = null;
    const pending = new Map();

    function current(request) {
        return running && request.lifecycle === lifecycle && request.sequence === sequence;
    }

    function notify(time, request = null) {
        if (request) {
            if (!current(request) || request.notified === time) return;
            request.notified = time;
        }
        onTime(time, { programmatic: Boolean(request) });
    }

    // Une seule fonction est conservée pour on/off, même après un redémarrage.
    function handleTimestamp(time) {
        if (!running) return;
        if (!validTime(time)) {
            onStatus('Windy a transmis une heure météo invalide.');
            return;
        }
        if (setting) {
            // Le résultat du set doit confirmer l’acceptation avant de faire
            // revenir cette heure dans la frise de course.
            setting.eventTime = time;
            return;
        }
        // Un ancien set asynchrone peut encore émettre son heure après un push récent.
        const matching = [...pending.values()].reverse().find(request => request.time === time);
        if (matching) {
            matching.eventTime = time;
            return;
        }
        // Une normalisation asynchrone par Windy peut émettre une heure différente.
        const latest = pending.get(sequence);
        if (latest && current(latest)) {
            latest.eventTime = time;
            return;
        }
        notify(time);
    }

    function start() {
        if (running) return;
        running = true;
        lifecycle++;
        try {
            store.on('timestamp', handleTimestamp);
            handleTimestamp(store.get('timestamp'));
        } catch (error) {
            running = false;
            // Retire aussi l’écouteur si seule la lecture initiale a échoué.
            try { store.off('timestamp', handleTimestamp); } catch { /* Écouteur déjà absent. */ }
            onStatus(`Impossible de lire l’heure Windy : ${error?.message || 'erreur inconnue'}.`);
        }
    }

    function stop() {
        if (!running) return;
        running = false;
        lifecycle++;
        sequence++;
        // Conserve les demandes non résolues : leurs éventuels événements
        // tardifs seront aussi ignorés si la liaison redémarre entre-temps.
        setting = null;
        store.off('timestamp', handleTimestamp);
    }

    async function push(timestampMs) {
        if (!running) return false;
        const request = { time: timestampMs, sequence: ++sequence, lifecycle, notified: null };
        if (!validTime(timestampMs)) {
            onStatus('Heure invalide : choisissez une heure UTC valide.');
            return false;
        }
        try {
            const calendar = store.get('calendar');
            if (!calendar || !validTime(calendar.start) || !validTime(calendar.end) || calendar.start > calendar.end) {
                onStatus('La plage météo Windy n’est pas encore disponible. Réessayez après son chargement.');
                return false;
            }
            if (timestampMs < calendar.start || timestampMs > calendar.end) {
                onStatus(`Météo non disponible pour cette heure (${label(timestampMs)}). ` +
                    'Le curseur météo Windy reste à son heure actuelle.');
                return false;
            }
            const before = store.get('timestamp');
            pending.set(request.sequence, request);
            setting = request;
            let operation;
            try {
                operation = store.set('timestamp', timestampMs);
            } finally {
                setting = null;
            }
            const result = await operation;
            if (!current(request)) return false;
            const actual = store.get('timestamp');
            if (!validTime(actual)) {
                onStatus('Windy n’a pas confirmé une heure météo valide.');
                return false;
            }
            // Une validation refusée peut ne produire aucun événement. Ne renvoie
            // pas alors l’ancienne heure vers la frise de course.
            if (actual !== timestampMs && actual === before && result !== true) {
                onStatus('Windy n’a pas accepté cette heure météo. Le relevé de course reste sélectionné.');
                return false;
            }
            if (actual !== timestampMs) {
                onStatus(`Windy a retenu ${label(actual)} pour la météo, au lieu de ${label(timestampMs)}.`);
            } else {
                onStatus('');
            }
            notify(actual, request);
            return true;
        } catch (error) {
            if (current(request)) onStatus(`La synchronisation avec Windy a échoué : ${error?.message || 'erreur inconnue'}.`);
            return false;
        } finally {
            pending.delete(request.sequence);
        }
    }

    return { start, push, stop };
}
