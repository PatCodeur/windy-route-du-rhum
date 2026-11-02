/** Publie un POSREPORT reçu sur stdin. Ne connaît aucun identifiant ni serveur FTP. */
import { createHash, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import identities from '../src/identities.js';
import initialFleets from '../src/historySnapshot.js';
import { parsePositions, stats } from '../src/data.js';
import { buildHistory, fleetAt, mergeHistory } from '../src/history.js';
import { HISTORY_SCHEMA, parseFeed } from '../src/liveFeed.js';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_REPORT_BYTES = 4 * 1024 * 1024;

function decodeReport(raw) {
    if (typeof raw === 'string') {
        if (Buffer.byteLength(raw, 'utf8') > MAX_REPORT_BYTES) throw new Error('Relevé trop volumineux (4 Mo maximum).');
        return raw;
    }
    if (!(raw instanceof Uint8Array)) throw new Error('Le relevé doit contenir du texte ou des octets.');
    if (raw.byteLength > MAX_REPORT_BYTES) throw new Error('Relevé trop volumineux (4 Mo maximum).');
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(raw);
    } catch {
        return new TextDecoder('windows-1252').decode(raw);
    }
}

function retrievedTime(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) {
        throw new Error('Heure de récupération UTC invalide.');
    }
    const parsed = new Date(value);
    const expanded = value.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction) => `.${(fraction || '').padEnd(3, '0')}Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== expanded) {
        throw new Error('Heure de récupération UTC invalide.');
    }
    return parsed.toISOString();
}

function canonicalFleet(fleet) {
    return [...fleet].sort((a, b) => a.id - b.id);
}

function reportHash(fleet) {
    return createHash('sha256').update(JSON.stringify(canonicalFleet(fleet))).digest('hex');
}

function historyFeed(fleets, retrievedAt) {
    return { type: 'RhumHistory', schema: HISTORY_SCHEMA, fleets, retrievedAt };
}

function geojson(fleet, status) {
    return { type: 'FeatureCollection', ...status, features: fleet.map(boat => ({
        type: 'Feature', id: boat.id, properties: boat,
        geometry: { type: 'Point', coordinates: [boat.lon, boat.lat] }
    })) };
}

async function atomicJson(path, data) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, `${JSON.stringify(data)}\n`, { flag: 'wx', mode: 0o600 });
        await rename(temporary, path);
    } finally {
        await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
}

async function archivedReports(directory) {
    const entries = await readdir(directory);
    const reports = [];
    for (const filename of entries.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort()) {
        const text = await readFile(join(directory, filename), 'utf8');
        let data;
        try {
            data = JSON.parse(text);
            const storedFleets = parseFeed(text);
            if (storedFleets.length !== 1 || reportHash(storedFleets[0]) !== filename.slice(0, -5)) throw new Error();
            // Une correction ultérieure de l’annuaire ne doit pas invalider le sceau
            // du relevé original ; seules les observations rejouées sont enrichies.
            const fleets = parseFeed(text, identities);
            const sequence = data.sequence ?? 0;
            if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error();
            reports.push({ filename, fleet: fleets[0], retrievedAt: retrievedTime(data.retrievedAt), sequence });
        } catch {
            throw new Error('Un relevé archivé est invalide. Le dernier flux publié est conservé.');
        }
    }
    return reports.sort((a, b) => a.sequence - b.sequence ||
        a.retrievedAt.localeCompare(b.retrievedAt) || a.filename.localeCompare(b.filename));
}

/**
 * Valide et conserve un relevé, puis publie le cumul de la course sous dist/live/.
 * rootDir facilite les essais isolés ; aucun des 29 relevés embarqués n’est copié dans state/.
 */
export async function publishReport(raw, { rootDir = DEFAULT_ROOT, minimumBoats = 115,
    retrievedAt = new Date().toISOString() } = {}) {
    if (!Number.isSafeInteger(minimumBoats) || minimumBoats < 1 || minimumBoats > 10000) {
        throw new Error('Le nombre minimum de bateaux doit être un entier entre 1 et 10000.');
    }
    const retrieval = retrievedTime(retrievedAt);
    const fleet = canonicalFleet(parsePositions(decodeReport(raw), identities));
    if (fleet.length < minimumBoats) {
        throw new Error(`Relevé incomplet : ${fleet.length} bateaux reçus, ${minimumBoats} minimum attendus. Le dernier flux est conservé.`);
    }
    const archiveDir = join(resolve(rootDir), 'state', 'ftp', 'reports');
    const liveDir = join(resolve(rootDir), 'dist', 'live');
    await mkdir(archiveDir, { recursive: true });
    const archived = await archivedReports(archiveDir);
    const oldFleets = [...initialFleets, ...archived.map(report => report.fleet)];
    const previous = buildHistory(oldFleets);
    const hash = reportHash(fleet);
    const filename = `${hash}.json`;
    const isDuplicate = archived.some(report => report.filename === filename);
    // La fusion refuse toute contradiction ID/heure/position avant d’écrire le moindre relevé.
    const next = isDuplicate ? previous : mergeHistory(previous, [fleet]);
    const count = history => Object.values(history.tracks).reduce((total, track) => total + track.length, 0);
    const status = {
        retrievedAt: retrieval,
        reportNewest: stats(fleet).newest,
        publishedNewest: next.newest,
        boatCount: fleet.length,
        newPoints: count(next) - count(previous)
    };
    const allFleets = isDuplicate ? oldFleets : [...oldFleets, fleet];
    // Un ancien relevé peut compléter des traces, mais ne remplace jamais les dernières positions.
    const latest = fleetAt(next, next.newest);
    const history = historyFeed(allFleets, retrieval);
    await mkdir(liveDir, { recursive: true });
    if (!isDuplicate) await atomicJson(join(archiveDir, filename), {
        ...historyFeed([fleet], retrieval), sequence: (archived.at(-1)?.sequence ?? 0) + 1
    });
    await atomicJson(join(liveDir, 'positions.geojson'), geojson(latest, status));
    await atomicJson(join(liveDir, 'historique.json'), history);
    await atomicJson(join(liveDir, 'status.json'), status);
    return status;
}

async function cli() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        process.stdout.write('Usage : node tools/publish-report.mjs [--root DOSSIER] [--minimum-boats N] < pos.txt\n');
        return;
    }
    const options = { minimumBoats: Number(process.env.RHUM_MIN_BOATS ?? 115) };
    for (let index = 0; index < args.length; index += 1) {
        if (args[index] === '--root' && args[index + 1]) options.rootDir = args[++index];
        else if (args[index] === '--minimum-boats' && args[index + 1]) options.minimumBoats = Number(args[++index]);
        else throw new Error('Option inconnue ou valeur absente. Utilisez --help.');
    }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
        bytes += chunk.length;
        if (bytes > MAX_REPORT_BYTES) throw new Error('Relevé trop volumineux (4 Mo maximum).');
        chunks.push(chunk);
    }
    const status = await publishReport(Buffer.concat(chunks), options);
    process.stdout.write(`${JSON.stringify(status)}\n`);
}

function isCliEntry() {
    if (!process.argv[1]) return false;
    try {
        // Sur macOS /var et /private/var peuvent désigner le même script.
        return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
    } catch {
        return false;
    }
}

if (isCliEntry()) {
    cli().catch(error => {
        process.stderr.write(`Publication refusée : ${error.message}\n`);
        process.exitCode = 1;
    });
}
