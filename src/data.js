/** Lecture du flux Route du Rhum : degrés/minutes, MM/JJ/AA, UTC, nœuds. */

const UNKNOWN_CLASS = 'Non renseignée';

function fail(message) {
    throw new Error(message);
}

function lines(text) {
    if (typeof text !== 'string') fail('Le fichier doit contenir du texte.');
    return text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
}

function positiveInteger(value, label) {
    if (!Number.isSafeInteger(value) || value <= 0) fail(`${label} doit être un entier positif.`);
    return value;
}

function nonNegativeInteger(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) fail(`${label} doit être un entier positif ou nul.`);
    return value;
}

function integerText(value, label) {
    if (!/^\d+$/.test(value)) fail(`${label} invalide.`);
    return positiveInteger(Number(value), label);
}

function sourceRank(value) {
    // Un statut ou un champ vide ne donne aucun rang et n'invalide pas la position.
    // 0 est la valeur canonique d'un classement non communiqué, sans interpréter le statut.
    return /^\d+$/.test(value) ? nonNegativeInteger(Number(value), 'Rang') : 0;
}

function numberText(value, label) {
    if (!/^\d+(?:\.\d+)?$/.test(value)) fail(`${label} invalide.`);
    const number = Number(value);
    if (!Number.isFinite(number)) fail(`${label} invalide.`);
    return number;
}

function coordinate(value, latitude) {
    const match = /^(\d+)(?:\.(\d+))?([NSEW])$/.exec(value);
    if (!match || !(latitude ? 'NS' : 'EW').includes(match[3])) {
        fail(`Coordonnée ${latitude ? 'latitude' : 'longitude'} invalide : ${value}`);
    }
    const degrees = Number(match[1]);
    const minutes = match[2] ? Number(`0.${match[2]}`) * 100 : 0;
    const result = degrees + minutes / 60;
    if (minutes >= 60 || !Number.isFinite(result) || result > (latitude ? 90 : 180)) {
        fail(`Coordonnée hors limites : ${value}`);
    }
    return result * ('SW'.includes(match[3]) ? -1 : 1);
}

function dateFromParts(year, month, day, hour, minute, second, milliseconds = 0) {
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, milliseconds));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day || date.getUTCHours() !== hour ||
        date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) {
        fail('Date ou heure UTC invalide.');
    }
    return date.toISOString();
}

function sourceDate(value) {
    const match = /^(\d{2})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
    if (!match) fail(`Date invalide (MM/JJ/AA HH:MM:SS attendu) : ${value}`);
    const [month, day, year, hour, minute, second] = match.slice(1).map(Number);
    return dateFromParts(2000 + year, month, day, hour, minute, second);
}

function utcDate(value) {
    if (typeof value !== 'string') fail('Horodatage UTC absent.');
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
    if (!match) fail('Horodatage attendu au format ISO UTC, terminé par Z.');
    const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
    const milliseconds = Number((match[7] || '').padEnd(3, '0'));
    return dateFromParts(year, month, day, hour, minute, second, milliseconds);
}

function movement(heading, speed) {
    if (typeof heading !== 'number' || !Number.isFinite(heading) || heading < 0 || heading >= 360) {
        fail('Le cap doit être compris entre 0° inclus et 360° exclus.');
    }
    if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0) {
        fail('La vitesse doit être un nombre positif ou nul en nœuds.');
    }
}

/** Retourne un annuaire id → { skipper, name, className }. */
export function parseIdentities(text, className) {
    if (typeof className !== 'string' || !className.trim()) fail('Classe de bateaux absente.');
    const result = Object.create(null);
    let header = false;
    let count = 0;
    lines(text).forEach((raw, index) => {
        const line = raw.trim();
        if (!line) return;
        if (!header) {
            if (line !== 'ID') fail('En-tête ID absent du fichier des concurrents.');
            header = true;
            return;
        }
        try {
            const fields = line.split(/\t+/).map(value => value.trim());
            if (fields.length < 3) fail('Trois champs séparés par des tabulations sont attendus.');
            const id = integerText(fields[0], 'ID');
            if (Object.hasOwn(result, id)) fail(`ID en double : ${id}`);
            const skipper = fields.slice(1, -1).join(' ').trim();
            const name = fields.at(-1);
            if (!skipper || !name) fail('Nom du skipper ou du bateau absent.');
            result[id] = { skipper, name, className: className.trim() };
            count += 1;
        } catch (error) {
            fail(`Concurrents, ligne ${index + 1} : ${error.message}`);
        }
    });
    if (!header || count === 0) fail('Le fichier des concurrents est vide.');
    return result;
}

/** Retourne toute la flotte, ou lève une erreur sans publier de relevé partiel. */
export function parsePositions(text, identities = {}) {
    if (!identities || typeof identities !== 'object' || Array.isArray(identities)) {
        fail('Annuaire des concurrents invalide.');
    }
    const input = lines(text);
    if (input[0]?.trim() !== 'POSREPORT') fail('En-tête POSREPORT absent.');
    const result = [];
    const seen = new Set();
    input.slice(1).forEach((raw, index) => {
        const line = raw.trim();
        if (!line) return;
        try {
            const fields = line.split(';').map(value => value.trim());
            if (fields.length !== 6) fail('Six champs séparés par des points-virgules sont attendus.');
            const [rankText, idText, latText, lonText, timeText, movementText] = fields;
            const id = integerText(idText, 'ID');
            const rank = sourceRank(rankText);
            if (seen.has(id)) fail(`ID en double : ${id}`);
            const lat = coordinate(latText, true);
            const lon = coordinate(lonText, false);
            const time = sourceDate(timeText);
            const parts = movementText.split('/');
            if (parts.length !== 2) fail('Cap/vitesse invalide.');
            const heading = numberText(parts[0], 'Cap');
            const speed = numberText(parts[1], 'Vitesse');
            movement(heading, speed);
            const known = Object.hasOwn(identities, id);
            const identity = known ? identities[id] : null;
            if (known && (!identity || typeof identity.skipper !== 'string' || !identity.skipper.trim() ||
                typeof identity.name !== 'string' || !identity.name.trim() ||
                typeof identity.className !== 'string' || !identity.className.trim())) {
                fail(`Identité invalide pour le bateau ${id}.`);
            }
            result.push({ id, rank, lat, lon, time, heading, speed,
                skipper: known ? identity.skipper : '',
                name: known ? identity.name : `Bateau #${id}`,
                className: known ? identity.className : UNKNOWN_CLASS, known });
            seen.add(id);
        } catch (error) {
            fail(`Positions, ligne ${index + 2} : ${error.message}`);
        }
    });
    if (!result.length) fail('Aucune position dans le relevé.');
    return result;
}

/** Accepte le GeoJSON du convertisseur Python ou les propriétés JS canoniques. */
export function normalizeFleet(geojson) {
    if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features) || !geojson.features.length) {
        fail('Une collection GeoJSON non vide est attendue.');
    }
    const seen = new Set();
    return geojson.features.map((feature, index) => {
        try {
            if (feature?.type !== 'Feature' || feature.geometry?.type !== 'Point' ||
                !Array.isArray(feature.geometry.coordinates) || feature.geometry.coordinates.length !== 2) {
                fail('Une géométrie Point [longitude, latitude] est attendue.');
            }
            const p = feature.properties;
            if (!p || typeof p !== 'object' || Array.isArray(p)) fail('Propriétés absentes.');
            const id = positiveInteger(p.id ?? feature.id, 'ID');
            if (feature.id !== undefined && feature.id !== id) fail('ID GeoJSON incohérent.');
            if (seen.has(id)) fail(`ID en double : ${id}`);
            seen.add(id);
            const rank = nonNegativeInteger(p.rank ?? p.rang_source, 'Rang');
            const [lon, lat] = feature.geometry.coordinates;
            if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) ||
                !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
                fail('Latitude ou longitude décimale hors limites.');
            }
            const time = utcDate(p.time ?? p.horodatage);
            const heading = p.heading ?? p.direction_source;
            const speed = p.speed ?? p.vitesse_source;
            movement(heading, speed);
            const suppliedKnown = p.known ?? p.identite_connue;
            if (suppliedKnown !== undefined && typeof suppliedKnown !== 'boolean') fail('Identité connue : booléen attendu.');
            const suppliedName = p.name ?? p.bateau;
            const known = suppliedKnown ?? Boolean(p.skipper && suppliedName);
            if (known && (typeof p.skipper !== 'string' || !p.skipper.trim() ||
                typeof suppliedName !== 'string' || !suppliedName.trim() ||
                typeof (p.className ?? p.classe) !== 'string' || !(p.className ?? p.classe).trim())) {
                fail('Identité du concurrent incomplète.');
            }
            return { id, rank, lat, lon, time, heading, speed,
                skipper: known ? p.skipper : '',
                name: known ? suppliedName : `Bateau #${id}`,
                className: known ? (p.className ?? p.classe) : UNKNOWN_CLASS, known };
        } catch (error) {
            fail(`GeoJSON, bateau ${index + 1} : ${error.message}`);
        }
    });
}

/** Bornes temporelles des positions et nombre d'identités manquantes. */
export function stats(boats) {
    if (!Array.isArray(boats)) fail('Une liste de bateaux est attendue.');
    if (!boats.length) return { oldest: null, newest: null, unknownCount: 0 };
    const times = boats.map(boat => utcDate(boat.time)).sort();
    return { oldest: times[0], newest: times.at(-1), unknownCount: boats.filter(boat => !boat.known).length };
}
