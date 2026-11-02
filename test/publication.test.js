import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { publishReport } from '../tools/publish-report.mjs';
import { parseFeed } from '../src/liveFeed.js';
import { buildHistory, fleetAt } from '../src/history.js';
import snapshot from '../src/historySnapshot.js';
import identities from '../src/identities.js';

const retrievedAt = '2026-11-03T16:05:00.000Z';
const row = (id, hour = 15, coordinate = '47.5442N') =>
    `${id};${id};${coordinate};21.0763W;11/03/26 ${hour}:00:00;248/31.1`;
const report = (...rows) => `POSREPORT\r\n${rows.join('\r\n')}\r\n`;
const read = async (root, filename) => JSON.parse(await readFile(join(root, 'dist', 'live', filename), 'utf8'));
const options = rootDir => ({ rootDir, minimumBoats: 2, retrievedAt });

async function temporary(t) {
    const root = await mkdtemp(join(tmpdir(), 'rhum-publication-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    return root;
}

test('Publie les derniers points, recharge toute la course et conserve les nouveaux points après réouverture', async t => {
    const root = await temporary(t);
    const result = await publishReport(Buffer.from(report(row(1), row(2))), options(root));
    assert.deepEqual(result, { retrievedAt, reportNewest: '2026-11-03T15:00:00.000Z',
        publishedNewest: '2026-11-03T15:00:00.000Z', boatCount: 2, newPoints: 2 });
    const source = await readFile(join(root, 'dist', 'live', 'historique.json'), 'utf8');
    const history = buildHistory(parseFeed(source, identities));
    assert.equal(history.newest, result.publishedNewest);
    assert.equal(history.tracks[1].at(-1).time, result.reportNewest);
    assert.equal(history.oldest, buildHistory(snapshot).oldest);
    assert.equal(Object.keys(history.tracks).length, 115);
    const positions = parseFeed(JSON.stringify(await read(root, 'positions.geojson')), identities)[0];
    assert.deepEqual(positions, fleetAt(history, history.newest));
    assert.deepEqual(await read(root, 'status.json'), result);
    await publishReport(report(row(1, 16), row(2, 16)), options(root));
    const next = buildHistory(parseFeed(JSON.stringify(await read(root, 'historique.json')), identities));
    assert.equal(next.tracks[1].at(-2).time, '2026-11-03T15:00:00.000Z');
    assert.equal(next.tracks[1].at(-1).time, '2026-11-03T16:00:00.000Z');
    assert.equal((await readdir(join(root, 'state', 'ftp', 'reports'))).length, 2);
});

test('Un fichier répété ou réordonné ne crée pas de double ni de nouvelle archive', async t => {
    const root = await temporary(t);
    await publishReport(report(row(1), row(2)), options(root));
    const original = await read(root, 'historique.json');
    const duplicate = await publishReport(report(row(2), row(1)), options(root));
    assert.equal(duplicate.newPoints, 0);
    assert.deepEqual(await read(root, 'historique.json'), original);
    assert.equal((await readdir(join(root, 'state', 'ftp', 'reports'))).length, 1);
    assert.equal(original.fleets.length, snapshot.length + 1);
});

test('Les 115 bateaux du corpus réel sont publiés avec le seuil par défaut', async t => {
    const root = await temporary(t);
    const raw = await readFile(new URL('../data/pos.txt', import.meta.url));
    const status = await publishReport(raw, { rootDir: root, retrievedAt });
    assert.equal(status.boatCount, 115);
    assert.equal(status.newPoints, 0);
    assert.equal(status.publishedNewest, buildHistory(snapshot).newest);
    const feed = await read(root, 'historique.json');
    assert.equal(feed.fleets.length, 30);
    assert.ok(parseFeed(JSON.stringify(feed), identities).flat().every(boat => boat.known));
});

test('Une ancienne copie ne rétablit pas des métadonnées remplacées au même pointage', async t => {
    const root = await temporary(t);
    const initial = report(row(1), row(2));
    const updated = report(row(1).replace(/^1;/, '2;'), row(2));
    await publishReport(initial, options(root));
    await publishReport(updated, options(root));
    await publishReport(initial, options(root));
    const history = buildHistory(parseFeed(JSON.stringify(await read(root, 'historique.json'))));
    const fleet = parseFeed(JSON.stringify(await read(root, 'positions.geojson')))[0];
    assert.equal(history.tracks[1].at(-1).rank, 2);
    assert.equal(fleet.find(boat => boat.id === 1).rank, 2);
    assert.equal((await readdir(join(root, 'state', 'ftp', 'reports'))).length, 2);
});

test('Un relevé plus ancien enrichit les traces sans remplacer les dernières positions par bateau', async t => {
    const root = await temporary(t);
    await publishReport(report(row(1, 16), row(2, 16)), options(root));
    const older = await publishReport(report(row(1, 14), row(2, 14)), options(root));
    assert.equal(older.reportNewest, '2026-11-03T14:00:00.000Z');
    assert.equal(older.publishedNewest, '2026-11-03T16:00:00.000Z');
    assert.equal(older.newPoints, 2);
    const fleet = parseFeed(JSON.stringify(await read(root, 'positions.geojson')))[0];
    assert.ok(fleet.filter(boat => boat.id <= 2).every(boat => boat.time === older.publishedNewest));
    const history = buildHistory(parseFeed(JSON.stringify(await read(root, 'historique.json'))));
    assert.equal(history.tracks[1].at(-2).time, older.reportNewest);
});

test('Un bateau au pointage ancien dans un nouveau fichier conserve son observation la plus récente', async t => {
    const root = await temporary(t);
    await publishReport(report(row(1, 15), row(2, 15)), options(root));
    const status = await publishReport(report(row(1, 16), row(2, 14)), options(root));
    assert.equal(status.newPoints, 2);
    const fleet = parseFeed(JSON.stringify(await read(root, 'positions.geojson')))[0];
    assert.equal(fleet.find(boat => boat.id === 1).time, '2026-11-03T16:00:00.000Z');
    assert.equal(fleet.find(boat => boat.id === 2).time, '2026-11-03T15:00:00.000Z');
});

test('Accepte le décodage Windows-1252 du fournisseur lorsque le fichier n’est pas UTF-8', async t => {
    const root = await temporary(t);
    const raw = Buffer.concat([Buffer.from(report(row(1), row(2))), Buffer.from([0xa0])]);
    assert.equal((await publishReport(raw, options(root))).boatCount, 2);
});

test('Relevé vide, tronqué, mal formé ou contradictoire : aucun fichier valide publié ou archivé n’est remplacé', async t => {
    const root = await temporary(t);
    await publishReport(report(row(1), row(2)), options(root));
    const files = ['historique.json', 'positions.geojson', 'status.json'];
    const before = await Promise.all(files.map(filename => readFile(join(root, 'dist', 'live', filename), 'utf8')));
    for (const bad of ['', 'POSREPORT\n', report(row(1)), report(row(1), 'invalide'),
        report(row(1, 15, '48.0000N'), row(2))]) {
        await assert.rejects(publishReport(bad, options(root)));
        assert.deepEqual(await Promise.all(files.map(filename => readFile(join(root, 'dist', 'live', filename), 'utf8'))), before);
        assert.equal((await readdir(join(root, 'state', 'ftp', 'reports'))).length, 1);
    }
    await assert.rejects(publishReport(report(row(1), row(2)), { rootDir: root }), /115 minimum/);
});

test('Rejette une archive corrompue et garde le dernier flux publié', async t => {
    const root = await temporary(t);
    await publishReport(report(row(1), row(2)), options(root));
    const original = await read(root, 'historique.json');
    const [filename] = await readdir(join(root, 'state', 'ftp', 'reports'));
    await writeFile(join(root, 'state', 'ftp', 'reports', filename), '{}');
    await assert.rejects(publishReport(report(row(1, 16), row(2, 16)), options(root)), /archivé est invalide/);
    assert.deepEqual(await read(root, 'historique.json'), original);
});

test('Une correction d’identité ultérieure respecte le sceau du relevé archivé et enrichit sa relecture', async t => {
    const root = await temporary(t);
    await publishReport(report(row(1), row(2)), options(root));
    const directory = join(root, 'state', 'ftp', 'reports');
    const [filename] = await readdir(directory);
    const archived = JSON.parse(await readFile(join(directory, filename), 'utf8'));
    archived.fleets[0][0].name = 'Ancien nom du bateau';
    const hash = createHash('sha256').update(JSON.stringify(archived.fleets[0])).digest('hex');
    await writeFile(join(directory, filename), JSON.stringify(archived));
    await rename(join(directory, filename), join(directory, `${hash}.json`));
    await publishReport(report(row(1, 16), row(2, 16)), options(root));
    const history = buildHistory(parseFeed(JSON.stringify(await read(root, 'historique.json')), identities));
    assert.equal(history.tracks[1].at(-2).name, identities[1].name);
});

test('Valide les options et limite la taille d’un relevé brut sans plafonner la course complète', async t => {
    const root = await temporary(t);
    for (const minimumBoats of [0, -1, 2.5, NaN, 10001]) {
        await assert.rejects(publishReport(report(row(1)), { rootDir: root, minimumBoats }), /minimum/);
    }
    await assert.rejects(publishReport('x'.repeat(4 * 1024 * 1024 + 1), options(root)), /volumineux/);
    await assert.rejects(publishReport({}, options(root)), /texte ou des octets/);
    await assert.rejects(publishReport(report(row(1)), { ...options(root), retrievedAt: '2026-02-30T12:00:00Z' }), /UTC/);
});

test('L’aide CLI fonctionne seule ; la publication stdin produit uniquement un court état JSON', async t => {
    const root = await temporary(t);
    const cli = new URL('../tools/publish-report.mjs', import.meta.url);
    const help = spawnSync(process.execPath, [cli.pathname, '--help'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Usage/);
    const result = spawnSync(process.execPath, [cli.pathname, '--root', root, '--minimum-boats', '2'], {
        input: Buffer.from(report(row(1), row(2))), encoding: 'utf8', timeout: 10000
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(JSON.parse(result.stdout).boatCount, 2);
    const invalid = spawnSync(process.execPath, [cli.pathname, '--root', root], {
        input: 'POSREPORT\n', encoding: 'utf8', timeout: 10000
    });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /Publication refusée/);
});

test('Le CLI lancé par lien symbolique publie le relevé réel sans déclencher le CLI lors d’un import', async t => {
    const root = await temporary(t);
    const cli = new URL('../tools/publish-report.mjs', import.meta.url);
    const alias = join(root, 'publication-symbolique.mjs');
    await symlink(cli, alias);
    const raw = await readFile(new URL('../data/pos.txt', import.meta.url));
    const result = spawnSync(process.execPath, [alias, '--root', root], {
        input: raw, encoding: 'utf8', timeout: 10000
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    const status = JSON.parse(result.stdout);
    assert.equal(status.boatCount, 115);
    assert.deepEqual(await read(root, 'status.json'), status);
    assert.equal(parseFeed(JSON.stringify(await read(root, 'positions.geojson')), identities)[0].length, 115);
    const history = buildHistory(parseFeed(JSON.stringify(await read(root, 'historique.json')), identities));
    assert.equal(history.newest, status.publishedNewest);
    const imported = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(cli.href)});`], {
        input: raw, encoding: 'utf8', timeout: 10000
    });
    assert.equal(imported.status, 0, imported.stderr);
    assert.equal(imported.stdout, '');
    assert.equal(imported.stderr, '');
});
