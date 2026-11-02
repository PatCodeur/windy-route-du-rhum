/** Historique fondé sur l’heure UTC des observations, jamais sur le nom des fichiers. */

function utc(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) {
        throw new Error('Heure attendue au format ISO UTC, terminé par Z.');
    }
    const milliseconds = Date.parse(value);
    if (!Number.isFinite(milliseconds)) throw new Error(`Heure UTC invalide : ${value}`);
    const canonical = new Date(milliseconds).toISOString();
    const expanded = value.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction) => `.${(fraction || '').padEnd(3, '0')}Z`);
    if (canonical !== expanded) throw new Error(`Heure UTC invalide : ${value}`);
    return canonical;
}

function sample(boat) {
    if (!boat || !Number.isSafeInteger(boat.id) || boat.id <= 0 ||
        !Number.isFinite(boat.lat) || Math.abs(boat.lat) > 90 ||
        !Number.isFinite(boat.lon) || Math.abs(boat.lon) > 180) {
        throw new Error('Observation invalide : ID, latitude ou longitude.');
    }
    return { ...boat, time: utc(boat.time) };
}

function addPoint(index, boat) {
    const point = sample(boat);
    if (!index.has(point.id)) index.set(point.id, new Map());
    const track = index.get(point.id);
    const previous = track.get(point.time);
    // Les conversions Python/JS du même relevé peuvent différer de quelques ulps.
    // 1e-9 degré représente moins d’un millimètre, très inférieur à la précision du flux.
    const tolerance = 1e-9;
    if (previous && (Math.abs(previous.lat - point.lat) > tolerance ||
        Math.abs(previous.lon - point.lon) > tolerance)) {
        throw new Error(`Positions contradictoires pour le bateau #${point.id} à ${point.time} : ` +
            `[${previous.lat}, ${previous.lon}] et [${point.lat}, ${point.lon}].`);
    }
    // Un même point peut être répété avec un rang ou une identité actualisés.
    track.set(point.time, point);
}

function addFleets(index, times, fleets) {
    if (!Array.isArray(fleets)) throw new Error('Une liste de relevés est attendue.');
    for (const fleet of fleets) {
        if (!Array.isArray(fleet)) throw new Error('Chaque relevé doit être une liste de bateaux.');
        let newest = null;
        const ids = new Set();
        for (const boat of fleet) {
            if (ids.has(boat?.id)) throw new Error(`Bateau #${boat.id} répété dans un même relevé.`);
            ids.add(boat?.id);
            addPoint(index, boat);
            const time = utc(boat.time);
            if (newest === null || time > newest) newest = time;
        }
        // Une étape de lecture désigne la dernière observation disponible de ce relevé.
        if (newest !== null) times.add(newest);
    }
}

function finish(index, times) {
    const tracks = Object.create(null);
    let oldest = null;
    let newest = null;
    for (const id of [...index.keys()].sort((a, b) => a - b)) {
        const points = [...index.get(id).values()].sort((a, b) => a.time.localeCompare(b.time));
        tracks[id] = points;
        if (oldest === null || points[0].time < oldest) oldest = points[0].time;
        if (newest === null || points.at(-1).time > newest) newest = points.at(-1).time;
    }
    return { tracks, times: [...times].sort(), oldest, newest };
}

/** fleets : tableaux de bateaux normalisés par parsePositions / normalizeFleet. */
export function buildHistory(fleets) {
    const index = new Map();
    const times = new Set();
    addFleets(index, times, fleets);
    return finish(index, times);
}

/** Fusion atomique : l’historique reçu reste intact, y compris si un fichier est invalide. */
export function mergeHistory(history, fleets) {
    const index = new Map();
    const times = new Set(history.times.map(utc));
    for (const track of Object.values(history.tracks)) {
        for (const boat of track) addPoint(index, boat);
    }
    addFleets(index, times, fleets);
    return finish(index, times);
}

// Premier point strictement après l’heure demandée ; évite de révéler une observation future.
function after(track, cutoff) {
    let low = 0;
    let high = track.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (track[middle].time <= cutoff) low = middle + 1;
        else high = middle;
    }
    return low;
}

/** Dernière position connue de chaque bateau à l’heure choisie, sans interpolation. */
export function fleetAt(history, time) {
    const cutoff = utc(time);
    const fleet = [];
    for (const track of Object.values(history.tracks)) {
        const end = after(track, cutoff);
        if (end > 0) fleet.push(track[end - 1]);
    }
    return fleet;
}

/** Trace observée d’un bateau, arrêtée à l’heure choisie. */
export function trackAt(history, id, time) {
    const cutoff = utc(time);
    const track = history.tracks[id] || [];
    return track.slice(0, after(track, cutoff));
}
