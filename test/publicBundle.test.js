import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicArchive, normalizeRepository, preparePublicSource,
    publicLicenseBanner, validatePublicFeedUrl, validatePublicOptions } from '../tools/build-public.mjs';

const validOptions = { feedUrl: 'https://course.example.com/live/historique.json', author: 'Auteur de test',
    repository: 'auteur/suivi-rhum', commit: 'abcdef1234567' };
const uploadScript = fileURLToPath(new URL('../tools/upload-plugin.py', import.meta.url));

async function temporary(t) {
    const root = await mkdtemp(join(tmpdir(), 'rhum-public-bundle-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    return root;
}

async function project(root) {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'windy-plugin-rhum-personnel', version: '0.8.0' }));
    await writeFile(join(root, 'src/pluginConfig.ts'), `const config = {
        name: 'windy-plugin-rhum-personnel', version: '0.7.0', private: true, title: 'Flotte privée', icon: '⛵'
};
export default config;
`);
    await writeFile(join(root, 'src/plugin.svelte'), '<div>Flotte</div>');
    await writeFile(join(root, 'src/historySnapshot.js'), 'export default [{ privateHistory: true }];');
    await writeFile(join(root, 'src/runtimeConfig.js'), 'export default { publicMode: false, feedUrl: "" };');
    await writeFile(join(root, '.ftp-config.json'), '{"password":"secret-never-copy"}');
    await writeFile(join(root, 'src/secret.json'), '{"password":"not-a-source-file"}');
    await mkdir(join(root, 'state/ftp'), { recursive: true });
    await writeFile(join(root, 'state/ftp/session.json'), '{}');
}

test('Le flux public exige HTTPS sans accès local, adresse privée, identifiants ni jeton en URL', () => {
    assert.equal(validatePublicFeedUrl(validOptions.feedUrl), validOptions.feedUrl);
    assert.equal(validatePublicFeedUrl('https://8.8.8.8/live.json'), 'https://8.8.8.8/live.json');
    for (const url of [undefined, '', 'http://example.com/live.json', 'ftp://example.com/pos.txt',
        'https://localhost:9999/live/historique.json', 'https://localhost./live.json',
        'https://host.local/live.json', 'https://host.internal/live.json', 'https://server/live.json',
        'https://127.0.0.1/live.json', 'https://127.1/live.json', 'https://2130706433/live.json',
        'https://0x7f000001/live.json', 'https://10.1.1.1/live.json', 'https://172.20.1.1/live.json',
        'https://192.168.1.2/live.json', 'https://169.254.1.1/live.json', 'https://100.64.0.1/live.json',
        'https://[::1]/live.json', 'https://[::ffff:127.0.0.1]/live.json',
        'https://user:secret@example.com/live.json', 'https://example.com/live.json?token=secret',
        'https://example.com/live.json#secret', 'https://example.com/live.json?', ' https://example.com/live.json']) {
        assert.throws(() => validatePublicFeedUrl(url), undefined, String(url));
    }
});

test('Les métadonnées GitHub sont explicites, validées et cohérentes', () => {
    assert.deepEqual(normalizeRepository('auteur/suivi-rhum'), { repository: 'https://github.com/auteur/suivi-rhum',
        repositoryName: 'auteur/suivi-rhum', repositoryOwner: 'auteur' });
    assert.deepEqual(normalizeRepository('https://github.com/auteur/suivi-rhum.git'), normalizeRepository(validOptions.repository));
    for (const repository of ['', 'foo', '../secret', 'auteur/..', 'auteur/repo/more',
        'http://github.com/auteur/repo', 'https://gitlab.com/auteur/repo',
        'https://user:secret@github.com/auteur/repo', 'https://github.com/auteur/repo?token=secret']) {
        assert.throws(() => normalizeRepository(repository), undefined, repository);
    }
    for (const patch of [{ author: '' }, { commit: '' }, { commit: 'HEAD' }, { commit: 'abcdezz' }, { repository: undefined }]) {
        assert.throws(() => validatePublicOptions({ ...validOptions, ...patch }));
    }
    assert.equal(validatePublicOptions({ ...validOptions, commit: 'ABCDEF123' }).commitSha, 'abcdef123');
});

test('La préparation publique exclut les archives privées et ne modifie pas la configuration de travail', async t => {
    const root = await temporary(t);
    await project(root);
    const originalConfig = await readFile(join(root, 'src/pluginConfig.ts'), 'utf8');
    const staged = await preparePublicSource(validOptions, { rootDir: root });
    assert.equal(staged.metadata.private, false);
    assert.equal(staged.metadata.version, '0.8.0');
    assert.equal(staged.metadata.repositoryName, validOptions.repository);
    assert.equal(staged.metadata.repositoryOwner, 'auteur');
    assert.equal(staged.metadata.commitSha, validOptions.commit);
    const runtime = await readFile(join(staged.sourceDir, 'runtimeConfig.js'), 'utf8');
    assert.match(runtime, /"publicMode": true/u);
    assert.ok(runtime.includes(validOptions.feedUrl));
    assert.equal(await readFile(join(staged.sourceDir, 'historySnapshot.js'), 'utf8'), 'export default [];\n');
    assert.deepEqual((await readdir(staged.stageDir)), ['src']);
    assert.ok(!(await readdir(staged.sourceDir)).includes('secret.json'));
    const config = await readFile(join(staged.sourceDir, 'pluginConfig.ts'), 'utf8');
    assert.match(config, /private: false/u);
    assert.match(config, /name: "windy-plugin-rhum-personnel"/u); // Windy’s compiler requires literal keys.
    assert.equal(await readFile(join(root, 'src/pluginConfig.ts'), 'utf8'), originalConfig);
    assert.match(await readFile(join(root, 'src/historySnapshot.js'), 'utf8'), /privateHistory/u);
});

test('Une entrée symbolique ne permet pas de copier un fichier extérieur dans la publication', async t => {
    const root = await temporary(t);
    await project(root);
    await symlink(join(root, '.ftp-config.json'), join(root, 'src/leak.js'));
    await assert.rejects(preparePublicSource(validOptions, { rootDir: root }), /symbolique/u);
    assert.deepEqual(await readdir(join(root, 'work')), []);
});

test('Les deux notices sont conservées dans le commentaire du paquet public ; une notice absente bloque la construction', async t => {
    const root = await temporary(t);
    await assert.rejects(publicLicenseBanner(root), /NOTICE.txt/u);
    await writeFile(join(root, 'NOTICE.txt'), 'Copyright Windy — notice de test.');
    await assert.rejects(publicLicenseBanner(root), /svelte/u);
    await mkdir(join(root, 'node_modules/svelte'), { recursive: true });
    await writeFile(join(root, 'node_modules/svelte/LICENSE.md'), 'Copyright Svelte — notice de test.');
    const banner = await publicLicenseBanner(root);
    assert.ok(banner.startsWith('/*!\n'));
    assert.ok(banner.endsWith('\n*/\n'));
    assert.match(banner, /Copyright Windy/u);
    assert.match(banner, /Copyright Svelte/u);
});

async function publicOutput(root, overrides = {}) {
    const output = join(root, 'public');
    await mkdir(output, { recursive: true });
    const config = { name: 'windy-plugin-rhum-personnel', version: '0.8.0', private: false,
        publicMode: true, publicFeedUrl: validOptions.feedUrl, author: validOptions.author,
        repository: 'https://github.com/auteur/suivi-rhum', repositoryName: 'auteur/suivi-rhum',
        repositoryOwner: 'auteur', commitSha: validOptions.commit, ...overrides };
    await writeFile(join(output, 'plugin.json'), JSON.stringify(config));
    await writeFile(join(output, 'plugin.js'), `const __pluginConfig = ${JSON.stringify(config)}; export { __pluginConfig };`);
    await writeFile(join(output, 'plugin.min.js'), `var config=${JSON.stringify(config)};`);
    return output;
}

function dryRun(archive) {
    return spawnSync('python3', [uploadScript, '--archive', archive, '--dry-run'], { encoding: 'utf8', timeout: 10000 });
}

test('Le TAR est limité aux fichiers publics et vérifiable sans clé ni connexion', async t => {
    const root = await temporary(t);
    const output = await publicOutput(root);
    for (const name of ['.ftp-config.json', 'plugin.js.map', 'positions.geojson']) await writeFile(join(output, name), 'secret');
    await mkdir(join(output, 'state'));
    await writeFile(join(output, 'screenshot.png'), Buffer.from([137, 80, 78, 71]));
    const archive = join(root, 'plugin.tar');
    assert.deepEqual(await createPublicArchive(output, archive), ['plugin.js', 'plugin.min.js', 'plugin.json', 'screenshot.png']);
    const check = dryRun(archive);
    assert.equal(check.status, 0, check.stderr);
    assert.match(check.stdout, /Aucun envoi effectué/u);
    assert.doesNotMatch(check.stdout, /secret/u);
});

test('Le validateur refuse les TAR privés ou contenant un flux local', async t => {
    const root = await temporary(t);
    for (const patch of [{ private: true }, { publicMode: false }, { publicFeedUrl: 'https://localhost:9999/live/historique.json' },
        { publicFeedUrl: 'https://127.1/live.json' }, { publicFeedUrl: 'https://example.com/feed.json?token=secret' },
        { repositoryOwner: 'autre' }, { commitSha: 'HEAD' }]) {
        const output = await publicOutput(root, patch);
        const archive = join(root, 'bad.tar');
        await createPublicArchive(output, archive);
        const result = dryRun(archive);
        assert.equal(result.status, 1, JSON.stringify(patch));
        assert.match(result.stderr, /Publication interrompue/u);
    }
});

test('La configuration intégrée au JavaScript correspond au manifeste publié', async t => {
    const root = await temporary(t);
    const output = await publicOutput(root);
    const bundle = await readFile(join(output, 'plugin.js'), 'utf8');
    await writeFile(join(output, 'plugin.js'), bundle.replace('"private":false', '"private":true'));
    const archive = join(root, 'inconsistent.tar');
    await createPublicArchive(output, archive);
    const result = dryRun(archive);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /même configuration/u);
});

test('Les liens, chemins de traversée et fichiers privés sont rejetés avant tout envoi', async t => {
    const root = await temporary(t);
    const output = await publicOutput(root);
    const archive = join(root, 'plugin.tar');
    await createPublicArchive(output, archive);
    const script = `import io, sys, tarfile\np=sys.argv[1]\nname=sys.argv[2]\nwith tarfile.open(p, 'a') as t:\n i=tarfile.TarInfo(name)\n i.size=3\n if name=='link':\n  i.type=tarfile.SYMTYPE\n  i.linkname='/etc/passwd'\n  i.size=0\n t.addfile(i, io.BytesIO(b'bad'))\n`;
    for (const entry of ['../escape', '/absolute', 'state/password.txt', 'plugin.json', 'link']) {
        await createPublicArchive(output, archive);
        const added = spawnSync('python3', ['-c', script, archive, entry], { encoding: 'utf8', timeout: 10000 });
        assert.equal(added.status, 0, added.stderr);
        assert.equal(dryRun(archive).status, 1, entry);
    }
    await symlink(join(output, 'plugin.js'), join(output, 'screenshot.jpeg'));
    await assert.rejects(createPublicArchive(output, archive), /réguliers/u);
});

test('Avant toute clé, le précontrôle du flux vérifie HTTPS, JSON de course, positions, taille et CORS', () => {
    const python = `import importlib.util, json, sys\nfrom unittest.mock import MagicMock, patch\nspec=importlib.util.spec_from_file_location('rhum_upload',sys.argv[1])\nm=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(m)\nurl='https://course.example.com/live/historique.json'\nvalid={'type':'RhumHistory','schema':'rhum-history/v1','fleets':[[{'id':1,'lat':47.1,'lon':-21.5}]]}\n\ndef run(data, headers=None, status=200):\n response=MagicMock()\n response.__enter__.return_value=response\n response.status=status\n response.headers={'Access-Control-Allow-Origin':'*'} if headers is None else headers\n response.read.return_value=data\n opener=MagicMock()\n opener.open.return_value=response\n with patch.object(m.urllib.request,'build_opener',return_value=opener):\n  result=m.preflight_public_feed(url)\n request=opener.open.call_args.args[0]\n assert request.get_header('Origin')=='https://www.windy.com'\n assert opener.open.call_args.kwargs['timeout']==20\n assert response.read.call_args.args[0]==m.MAX_FEED_BYTES+1\n return result\n\ndata=json.dumps(valid).encode()\nassert run(data)=={'fleetCount':1,'boatCount':1}\nassert run(data,{'Access-Control-Allow-Origin':'https://www.windy.com'})['boatCount']==1\nfor payload,headers,status in [(data,{},200),(data,{'Access-Control-Allow-Origin':'https://elsewhere.example.com'},200),(data,None,204),(b'not json',None,200),(b'{}',None,200),(json.dumps({**valid,'fleets':[]}).encode(),None,200),(json.dumps({**valid,'fleets':[[]]}).encode(),None,200),(json.dumps({**valid,'schema':'wrong'}).encode(),None,200)]:\n try: run(payload,headers,status)\n except ValueError: pass\n else: raise AssertionError('invalid public feed accepted')\nwith patch.object(m,'MAX_FEED_BYTES',64):\n try: run(b'x'*65)\n except ValueError: pass\n else: raise AssertionError('oversized public feed accepted')\nprint('Précontrôle public vérifié sans réseau.')\n`;
    const result = spawnSync('python3', ['-c', python, uploadScript], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /sans réseau/u);
});

test('La réponse de publication conserve les liens fournis et masque la clé, même dans une erreur HTTP 200', () => {
    const python = `import contextlib, importlib.util, io, json, sys\nfrom unittest.mock import patch\nspec=importlib.util.spec_from_file_location('rhum_upload',sys.argv[1])\nm=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(m)\nkey='FAUSSE_CLE_TEST_123456'\nurl='https://www.windy.com/plugin/rhum-personnel/identifiant-fourni-par-windy'\nsuccess={'status':200,'body':json.dumps({'status':'OK','data':{'installationUrl':url},'echo':key})}\nreply=m.publication_reply(success,key)\nassert reply['confirmed'] and reply['urls']==[url]\nassert key not in reply['message'] and '[clé masquée]' in reply['message']\nfailed={'status':200,'body':json.dumps({'error':'Invalid key '+key,'url':url})}\nassert not m.publication_reply(failed,key)['confirmed']\nunknown=m.publication_reply({'status':200,'body':'unrecognized response'},key)\nassert not unknown['confirmed']\nencoded=m.publication_reply({'status':200,'body':'https://www.windy.com/path?echo=x%2Fy'},'x/y')\nassert 'x%2Fy' not in encoded['message'] and encoded['urls']==[]\n\ndef main_output(result):\n out,err=io.StringIO(),io.StringIO()\n with patch.object(m,'validate_archive',return_value=({'name':'windy-plugin-rhum-personnel','version':'0.8.0','publicFeedUrl':'https://course.example.com/feed.json'},['plugin.js','plugin.min.js','plugin.json'])),patch.object(m.sys.stdin,'isatty',return_value=True),patch.object(m,'preflight_public_feed',return_value={'fleetCount':2,'boatCount':115}),patch.object(m.getpass,'getpass',return_value=key),patch.object(m,'upload_archive',return_value=result),contextlib.redirect_stdout(out),contextlib.redirect_stderr(err):\n  code=m.main(['--archive','unused-fixture.tar'])\n combined=out.getvalue()+err.getvalue()\n assert key not in combined\n return code,combined\ncode,text=main_output(success)\nassert code==0 and url in text\ncode,text=main_output(failed)\nassert code==1 and 'Publication non confirmée' in text and 'Liens renvoyés' not in text\nprint('Réponse de publication vérifiée sans réseau ni clé réelle.')\n`;
    const result = spawnSync('python3', ['-c', python, uploadScript], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /sans réseau/u);
});

test('Le transfert garde la réponse bornée à 1 Mio et ne fait qu’un POST vers Windy', async t => {
    const root = await temporary(t);
    const archive = join(root, 'fake.tar');
    await writeFile(archive, 'fixture');
    const python = `import importlib.util, sys\nfrom unittest.mock import MagicMock, patch\nspec=importlib.util.spec_from_file_location('rhum_upload',sys.argv[1])\nm=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(m)\nresponse=MagicMock()\nresponse.__enter__.return_value=response\nresponse.status=200\nresponse.read.return_value=b'0123456789abcdefEXCESS'\nopener=MagicMock()\nopener.open.return_value=response\nwith patch.object(m.urllib.request,'build_opener',return_value=opener),patch.object(m,'MAX_REPLY_BYTES',16):\n result=m.upload_archive(sys.argv[2],'FAUSSE_CLE_TEST')\nassert result=={'status':200,'body':'0123456789abcdef','truncated':True}\nassert response.read.call_args.args[0]==17\nrequest=opener.open.call_args.args[0]\nassert request.get_method()=='POST' and request.full_url==m.UPLOAD_URL\nassert request.get_header('X-windy-api-key')=='FAUSSE_CLE_TEST'\nassert opener.open.call_count==1\nprint('Réponse bornée vérifiée sans envoi.')\n`;
    const result = spawnSync('python3', ['-c', python, uploadScript, archive], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /sans envoi/u);
});
