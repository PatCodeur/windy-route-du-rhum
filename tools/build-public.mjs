import { spawnSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED_FILES = ['plugin.js', 'plugin.min.js', 'plugin.json'];
const SCREENSHOTS = ['screenshot.jpg', 'screenshot.png', 'screenshot.webp', 'screenshot.jpeg'];
export const PUBLIC_ARCHIVE_FILES = Object.freeze([...REQUIRED_FILES, ...SCREENSHOTS]);

/** Publication requires a stable, credential-free HTTPS address, never a local relay. */
export function validatePublicFeedUrl(value) {
    if (value === undefined || value === '') throw new Error('--feed-url est obligatoire : adresse HTTPS publique du flux de positions.');
    if (typeof value !== 'string' || value !== value.trim() || /[\s?#]/u.test(value)) {
        throw new Error('Le flux public doit être une URL HTTPS sans paramètres, fragment ni espace.');
    }
    let url;
    try { url = new URL(value); } catch { throw new Error('URL du flux public invalide.'); }
    if (url.protocol !== 'https:' || url.username || url.password) {
        throw new Error('Le flux public doit utiliser HTTPS, sans identifiant ni mot de passe.');
    }
    const host = url.hostname.toLowerCase().replace(/\.$/u, '');
    const ipVersion = isIP(host.replace(/^\[|\]$/gu, ''));
    if (ipVersion === 6) {
        throw new Error('Utilisez le nom de domaine public HTTPS du flux, plutôt qu’une adresse IPv6.');
    }
    if (ipVersion === 4) {
        const [a, b, c] = host.split('.').map(Number);
        const nonPublic = a === 0 || a === 10 || a === 127 || a >= 224 ||
            (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
            (a === 192 && b === 0 && (c === 0 || c === 2)) ||
            (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
            (a === 203 && b === 0 && c === 113);
        if (nonPublic) throw new Error('Le flux doit être public : adresse IP locale ou réservée refusée.');
    } else if (!host.includes('.') || /(?:^|\.)(?:localhost|local|localdomain|internal|test|invalid|onion)$/u.test(host) ||
        /(?:^|\.)home\.arpa$/u.test(host)) {
        throw new Error('Le flux doit être hébergé sur un domaine public, accessible aux autres utilisateurs.');
    }
    return url.href;
}

export function normalizeRepository(value) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('--repository est obligatoire (propriétaire/dépôt GitHub).');
    let name = value;
    if (value.includes('://')) {
        let url;
        try { url = new URL(value); } catch { throw new Error('Dépôt GitHub invalide.'); }
        if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password ||
            url.search || url.hash || /[?#]/u.test(value)) throw new Error('Utilisez une URL HTTPS github.com sans identifiants ni paramètres.');
        name = url.pathname.replace(/^\//u, '').replace(/\/$/u, '');
    }
    name = name.replace(/\.git$/u, '');
    const match = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9_.-]{1,100})$/u.exec(name);
    if (!match || ['.', '..'].includes(match[2]) || match[1].endsWith('-')) throw new Error('Dépôt attendu : propriétaire/dépôt GitHub.');
    return { repository: `https://github.com/${name}`, repositoryName: name, repositoryOwner: match[1] };
}

export function validatePublicOptions(options = {}) {
    const feedUrl = validatePublicFeedUrl(options.feedUrl);
    if (typeof options.author !== 'string' || !options.author.trim() || options.author.length > 200 || /[\r\n\x00-\x1f]/u.test(options.author)) {
        throw new Error('--author est obligatoire (nom de l’auteur, sur une seule ligne).');
    }
    if (typeof options.commit !== 'string' || !/^[a-fA-F0-9]{7,40}$/u.test(options.commit)) {
        throw new Error('--commit est obligatoire : identifiant du commit Git, de 7 à 40 caractères hexadécimaux.');
    }
    return { feedUrl, author: options.author.trim(), ...normalizeRepository(options.repository), commitSha: options.commit.toLowerCase() };
}

async function copySourceTree(source, target) {
    await mkdir(target, { recursive: true });
    for (const entry of await readdir(source, { withFileTypes: true })) {
        const from = join(source, entry.name);
        const to = join(target, entry.name);
        if (entry.isSymbolicLink()) throw new Error(`Lien symbolique refusé dans les sources : ${entry.name}`);
        if (entry.isDirectory()) await copySourceTree(from, to);
        else if (entry.isFile() && (/\.(?:js|ts|svelte|css|svg)$/u.test(entry.name) || SCREENSHOTS.includes(entry.name))) {
            await writeFile(to, await readFile(from));
        }
    }
}

export async function preparePublicSource(options, { rootDir = ROOT } = {}) {
    const validated = validatePublicOptions(options);
    const packageInfo = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'));
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(packageInfo.version)) throw new Error('Version du projet invalide.');
    const configText = await readFile(join(rootDir, 'src', 'pluginConfig.ts'), 'utf8');
    const object = /const\s+config(?:\s*:[^=]+)?\s*=\s*(\{[\s\S]*?\n\});/u.exec(configText)?.[1];
    if (!object) throw new Error('Configuration du plugin introuvable.');
    const config = vm.runInNewContext(`(${object})`, Object.create(null), { timeout: 1000 });
    if (config.name !== 'windy-plugin-rhum-personnel') throw new Error('Nom du plugin inattendu.');
    const metadata = { ...config, version: packageInfo.version, private: false,
        title: 'Route du Rhum — suivi des bateaux', author: validated.author,
        repository: validated.repository, repositoryName: validated.repositoryName,
        repositoryOwner: validated.repositoryOwner, commitSha: validated.commitSha,
        publicMode: true, publicFeedUrl: validated.feedUrl };
    await mkdir(join(rootDir, 'work'), { recursive: true });
    const stageDir = await mkdtemp(join(rootDir, 'work', '.public-build-'));
    try {
        const sourceDir = join(stageDir, 'src');
        await copySourceTree(join(rootDir, 'src'), sourceDir);
        await writeFile(join(sourceDir, 'runtimeConfig.js'), `export default ${JSON.stringify({ publicMode: true, feedUrl: validated.feedUrl }, null, 2)};\n`);
        await writeFile(join(sourceDir, 'historySnapshot.js'), 'export default [];\n');
        // Windy's compiler reads this literal and embeds the same metadata in both bundles.
        const literal = JSON.stringify(metadata, null, 4).replace(/^(\s*)"([A-Za-z_$][\w$]*)":/gmu, '$1$2:');
        await writeFile(join(sourceDir, 'pluginConfig.ts'), `const config = ${literal};\nexport default config;\n`);
        return { stageDir, sourceDir, metadata, options: validated };
    } catch (error) {
        await rm(stageDir, { recursive: true, force: true });
        throw error;
    }
}

function tarHeader(name, length) {
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, 'ascii');
    const octal = (value, offset, width) => header.write(`${value.toString(8).padStart(width - 1, '0')}\0`, offset, width, 'ascii');
    octal(0o644, 100, 8); octal(0, 108, 8); octal(0, 116, 8);
    octal(length, 124, 12); octal(0, 136, 12);
    header.fill(32, 148, 156); header.write('0', 156);
    header.write('ustar\0', 257, 6, 'ascii'); header.write('00', 263, 2, 'ascii');
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
    return header;
}

/** An explicit file list prevents state, FTP settings and source maps entering the TAR. */
export async function createPublicArchive(outputDir, archivePath) {
    const available = await readdir(outputDir);
    for (const name of REQUIRED_FILES) if (!available.includes(name)) throw new Error(`Fichier public manquant : ${name}`);
    const files = PUBLIC_ARCHIVE_FILES.filter(name => available.includes(name));
    const chunks = [];
    for (const name of files) {
        const path = join(outputDir, name);
        if (!(await lstat(path)).isFile()) throw new Error(`Seuls les fichiers réguliers sont admis dans l’archive : ${name}`);
        const bytes = await readFile(path);
        chunks.push(tarHeader(name, bytes.length), bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
    }
    chunks.push(Buffer.alloc(1024));
    await mkdir(dirname(archivePath), { recursive: true });
    await writeFile(archivePath, Buffer.concat(chunks));
    return files;
}

export async function publicLicenseBanner(rootDir = ROOT) {
    const texts = [];
    for (const name of ['NOTICE.txt', 'node_modules/svelte/LICENSE.md']) {
        let text;
        try { text = (await readFile(join(rootDir, name), 'utf8')).trim(); }
        catch { throw new Error(`Notice de licence requise pour le paquet public : ${name}`); }
        if (!text || text.includes('*/')) throw new Error(`Notice de licence vide ou incompatible avec le JavaScript : ${name}`);
        texts.push(text);
    }
    return `/*!\n${texts.join('\n\n')}\n*/\n`;
}

export async function buildPublicPlugin(options, { rootDir = ROOT, prepareOnly = false } = {}) {
    const staged = await preparePublicSource(options, { rootDir });
    if (prepareOnly) return staged;
    try {
        const licenseBanner = await publicLicenseBanner(rootDir);
        const outputDir = join(rootDir, 'release', 'public-plugin');
        await rm(outputDir, { recursive: true, force: true });
        await mkdir(outputDir, { recursive: true });
        const result = spawnSync(process.execPath, [join(rootDir, 'node_modules/rollup/dist/bin/rollup'), '-c'], {
            cwd: rootDir, stdio: 'inherit', env: { ...process.env, SERVE: 'false',
                RHUM_SOURCE_DIR: staged.sourceDir, RHUM_OUTPUT_DIR: outputDir }
        });
        if (result.error || result.status !== 0) throw new Error('Compilation publique échouée.');
        const metadata = JSON.parse(await readFile(join(outputDir, 'plugin.json'), 'utf8'));
        for (const [key, value] of Object.entries(staged.metadata)) {
            if (metadata[key] !== value) throw new Error(`Métadonnée publique incohérente : ${key}`);
        }
        for (const name of ['plugin.js', 'plugin.min.js']) {
            const path = join(outputDir, name);
            const bundle = await readFile(path, 'utf8');
            if (!bundle.includes(staged.options.feedUrl)) throw new Error(`Flux public absent de ${name}.`);
            await writeFile(path, licenseBanner + bundle.replace(/\n?\/\/# sourceMappingURL=[^\r\n]*/gu, ''));
        }
        for (const name of await readdir(outputDir)) {
            if (!PUBLIC_ARCHIVE_FILES.includes(name)) await rm(join(outputDir, name), { recursive: true, force: true });
        }
        const archivePath = join(rootDir, 'release', `${metadata.name}-${metadata.version}.tar`);
        const files = await createPublicArchive(outputDir, archivePath);
        return { outputDir, archivePath, files, metadata };
    } finally {
        await rm(staged.stageDir, { recursive: true, force: true });
    }
}

const usage = `Usage : node tools/build-public.mjs --feed-url https://DOMAINE/flux/historique.json --author "NOM" --repository PROPRIETAIRE/DEPOT --commit SHA
Prépare la version publique et son TAR dans release/, sans aucun envoi en ligne.
Options : --prepare-only conserve uniquement les sources publiques temporaires pour inspection ; --help.
Le flux doit être réellement hébergé et public ; les valeurs ci-dessus sont des emplacements à remplacer.`;

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help')) { console.log(usage); return; }
    const options = {};
    let prepareOnly = false;
    const keys = { '--feed-url': 'feedUrl', '--author': 'author', '--repository': 'repository', '--commit': 'commit' };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--prepare-only') { prepareOnly = true; continue; }
        if (!keys[arg] || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Option invalide ou incomplète : ${arg}.\n${usage}`);
        if (options[keys[arg]] !== undefined) throw new Error(`Option répétée : ${arg}.`);
        options[keys[arg]] = args[++i];
    }
    const result = await buildPublicPlugin(options, { prepareOnly });
    console.log(prepareOnly ? `Sources publiques préparées : ${result.sourceDir}` : `Archive publique préparée : ${result.archivePath}\nAucun envoi effectué.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    main().catch(error => { console.error(`Publication non préparée : ${error.message}`); process.exitCode = 1; });
}
