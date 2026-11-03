#!/usr/bin/env python3
"""Un passage FTP pour GitHub Pages ; les archives durables restent dans race-data."""
import argparse
import ftplib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
BRANCH = 'race-data'
MANIFEST = 'state/ftp/published-archives.json'
LIVE = ('historique.json', 'positions.geojson', 'status.json')
REPORT_PATH = re.compile(r'state/ftp/reports/[a-f0-9]{64}\.json', re.ASCII)
MAX_BLOB_BYTES = 90 * 1024 * 1024
COPY_SOURCES = ('data.js', 'identities.js', 'historySnapshot.js', 'history.js', 'liveFeed.js')
MAX_ATTEMPTS = 3
RETRY_DELAY_SECONDS = 20

spec = importlib.util.spec_from_file_location('rhum_ftp_relay', ROOT / 'tools' / 'ftp-relay.py')
relay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(relay)


class GitOperationError(RuntimeError):
    """Échec Git dont le dialogue distant ne doit jamais être journalisé."""


def failure_category(error, stage):
    """Codes constants : ni texte du serveur, ni chemin, ni identifiant."""
    if isinstance(error, GitOperationError):
        return 'git-operation'
    if isinstance(error, ftplib.error_perm):
        return 'ftp-permission'
    if isinstance(error, ftplib.error_temp):
        return 'ftp-temporary'
    if isinstance(error, (TimeoutError, subprocess.TimeoutExpired)):
        return 'timeout'
    if isinstance(error, (ConnectionError, EOFError)):
        return 'connection'
    if isinstance(error, OSError):
        return 'network' if stage in {'ftp-connect', 'latest-download'} else 'local-io'
    if isinstance(error, ValueError):
        if stage == 'latest-validation':
            # Le programme local enveloppe les contrôles connus dans ces préfixes.
            # Seul leur code constant sort dans les journaux, jamais le détail
            # susceptible de contenir une ligne du fichier reçu.
            message = str(error)
            position_error = re.match(r'\APublication refusée : Positions, ligne [0-9]+ : ', message)
            if position_error:
                detail = message[position_error.end():]
                fields = (
                    ('Le cap doit être compris entre 0° inclus et 360° exclus.', 'cap-range'),
                    ('Cap invalide.', 'cap-invalid'),
                    ('Rang invalide.', 'rank-invalid'),
                    ('Rang doit être un entier positif.', 'rank-invalid'),
                    ('Coordonnée latitude invalide : ', 'coordinate-invalid'),
                    ('Coordonnée longitude invalide : ', 'coordinate-invalid'),
                    ('Coordonnée hors limites : ', 'coordinate-invalid'),
                    ('Date invalide (MM/JJ/AA HH:MM:SS attendu) : ', 'date-invalid'),
                    ('Date ou heure UTC invalide.', 'date-invalid'),
                    ('Vitesse invalide.', 'speed-invalid'),
                    ('La vitesse doit être un nombre positif ou nul en nœuds.', 'speed-invalid'),
                    ('ID invalide.', 'id-invalid'),
                    ('ID doit être un entier positif.', 'id-invalid'),
                    ('ID en double : ', 'duplicate-id'),
                    ('Six champs séparés par des points-virgules sont attendus.', 'field-count'),
                    ('Cap/vitesse invalide.', 'movement-format'),
                )
                for prefix, category in fields:
                    if detail.startswith(prefix):
                        return category
                return 'report-format'
            known = (
                ('Publication refusée : Relevé incomplet :', 'report-incomplete'),
                ('Publication refusée : Positions contradictoires pour le bateau #', 'history-conflict'),
                ('Publication refusée : Un relevé archivé est invalide.', 'stored-report-invalid'),
                ('Publication refusée : En-tête POSREPORT absent.', 'report-format'),
                ('Publication refusée : Aucune position dans le relevé.', 'report-format'),
            )
            for prefix, category in known:
                if message.startswith(prefix):
                    return category
        return 'validation'
    return 'unexpected'


def retryable_failure(error, stage):
    if stage in {'restore', 'save'}:
        return isinstance(error, (GitOperationError, subprocess.TimeoutExpired))
    if stage in {'ftp-connect', 'latest-download'}:
        return isinstance(error, (OSError, EOFError, ftplib.error_temp))
    return False


def allowed_path(name):
    return name == MANIFEST or name in {'dist/live/' + filename for filename in LIVE} or bool(REPORT_PATH.fullmatch(name))


def read_manifest(raw):
    try:
        data = json.loads(raw)
        if set(data) != {'version', 'published'} or data['version'] != 1:
            raise ValueError()
        names = data['published']
        if not isinstance(names, list) or any(not relay.valid_archive_name(name) for name in names):
            raise ValueError()
        if len(names) != len(set(names)):
            raise ValueError()
        return set(names)
    except (ValueError, TypeError, KeyError):
        raise ValueError('Le manifeste public des archives est invalide.') from None


def manifest_bytes(names):
    document = {'version': 1, 'published': sorted(names)}
    raw = (json.dumps(document, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    read_manifest(raw)
    return raw


def git(root, *args, data=None, env=None, allowed_codes=(0,)):
    result = subprocess.run(['git', '-C', str(root), *args], input=data, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, env=env, timeout=90, check=False)
    if result.returncode not in allowed_codes:
        # Git peut inclure une URL authentifiée ou un serveur distant dans stderr.
        raise GitOperationError('La sauvegarde GitHub de la course est indisponible ; aucune publication effectuée.')
    return result


def restore_data(repo, work):
    """Lit uniquement des blobs JSON autorisés ; aucun fichier distant n’est exécuté."""
    remote = git(repo, 'ls-remote', '--exit-code', 'origin', 'refs/heads/' + BRANCH, allowed_codes=(0, 2))
    if remote.returncode == 2:
        return None
    git(repo, 'fetch', '--no-tags', '--depth=1', 'origin',
        'refs/heads/' + BRANCH + ':refs/remotes/origin/' + BRANCH)
    previous = git(repo, 'rev-parse', 'refs/remotes/origin/' + BRANCH).stdout.decode().strip()
    entries = git(repo, 'ls-tree', '-rz', '--long', previous).stdout
    blobs = []
    for entry in entries.split(b'\0'):
        if not entry:
            continue
        metadata, raw_name = entry.split(b'\t', 1)
        mode, kind, oid, size = metadata.split()
        try:
            name = raw_name.decode('utf-8')
        except UnicodeError:
            raise ValueError('La branche de données contient un nom de fichier invalide.') from None
        if mode != b'100644' or kind != b'blob' or not allowed_path(name) or int(size) > MAX_BLOB_BYTES:
            raise ValueError('La branche de données contient un fichier non autorisé.')
        blobs.append((name, oid.decode('ascii')))
    for name, oid in blobs:
        data = git(repo, 'cat-file', 'blob', oid).stdout
        validate_blob(name, data)
        target = Path(work) / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    if not (Path(work) / MANIFEST).exists():
        raise ValueError('Le manifeste durable de la course est absent.')
    return previous


def validate_blob(name, raw):
    if not allowed_path(name) or len(raw) > MAX_BLOB_BYTES:
        raise ValueError('Fichier de course non autorisé.')
    if name == MANIFEST:
        read_manifest(raw)
        return
    try:
        document = json.loads(raw)
    except (ValueError, UnicodeError):
        raise ValueError('Un fichier durable de la course est illisible.') from None
    if not isinstance(document, dict):
        raise ValueError('Un fichier durable de la course est invalide.')
    def metadata_free(value):
        if isinstance(value, dict):
            return not ({'source', 'host', 'user', 'password', 'protocol', 'port', 'archive_path'} & set(value)) and all(
                metadata_free(item) for item in value.values())
        return not isinstance(value, list) or all(metadata_free(item) for item in value)

    if not metadata_free(document):
        raise ValueError('Un fichier durable contient des métadonnées privées.')
    status_keys = {'retrievedAt', 'reportNewest', 'publishedNewest', 'boatCount', 'newPoints'}
    if name.endswith('/status.json'):
        valid = set(document) == status_keys
    elif name.endswith('/positions.geojson'):
        valid = set(document) == status_keys | {'type', 'features'} and document['type'] == 'FeatureCollection'
    else:
        valid = (set(document) <= {'type', 'schema', 'fleets', 'retrievedAt', 'sequence'} and
                 document.get('type') == 'RhumHistory' and document.get('schema') == 'rhum-history/v1' and
                 isinstance(document.get('fleets'), list) and bool(document['fleets']))
    if not valid:
        raise ValueError('Un fichier durable contient des métadonnées non autorisées.')


def generated_files(work):
    root = Path(work)
    files = [root / MANIFEST, *(root / 'dist' / 'live' / name for name in LIVE)]
    files.extend(sorted((root / 'state' / 'ftp' / 'reports').glob('*.json')))
    result = {}
    for path in files:
        if path.is_symlink() or not path.is_file():
            raise ValueError('Un fichier nécessaire à la sauvegarde est absent ou invalide.')
        name = path.relative_to(root).as_posix()
        raw = path.read_bytes()
        validate_blob(name, raw)
        result[name] = raw
    return result


def save_data(repo, work, previous, temp_dir):
    """Construit un arbre neuf, sans ajouter les fichiers de travail ni les secrets."""
    files = generated_files(work)
    with tempfile.TemporaryDirectory(prefix='rhum-git-', dir=temp_dir) as directory:
        env = dict(os.environ, GIT_INDEX_FILE=str(Path(directory) / 'index'),
                   GIT_AUTHOR_NAME='Route du Rhum positions', GIT_COMMITTER_NAME='Route du Rhum positions',
                   GIT_AUTHOR_EMAIL='41898282+github-actions[bot]@users.noreply.github.com',
                   GIT_COMMITTER_EMAIL='41898282+github-actions[bot]@users.noreply.github.com')
        git(repo, 'read-tree', '--empty', env=env)
        for name, raw in sorted(files.items()):
            oid = git(repo, 'hash-object', '-w', '--stdin', data=raw, env=env).stdout.decode().strip()
            git(repo, 'update-index', '--add', '--cacheinfo', '100644,' + oid + ',' + name, env=env)
        tree = git(repo, 'write-tree', env=env).stdout.decode().strip()
        if previous:
            old_tree = git(repo, 'rev-parse', previous + '^{tree}', env=env).stdout.decode().strip()
            if tree == old_tree:
                return previous
        parent = ['-p', previous] if previous else []
        commit = git(repo, 'commit-tree', tree, *parent, data=b'Actualisation des positions\n', env=env).stdout.decode().strip()
        # Sans --force : une modification concurrente doit échouer plutôt que perdre des points.
        git(repo, 'push', 'origin', commit + ':refs/heads/' + BRANCH, env=env)
        return commit


def config_from_environment(environment):
    fields = {'RHUM_FTP_HOST': 'host', 'RHUM_FTP_USER': 'user', 'RHUM_FTP_PASSWORD': 'password'}
    values = {}
    for variable, field in fields.items():
        value = environment.get(variable)
        if not isinstance(value, str) or not value or any(char in value for char in '\r\n\0'):
            raise ValueError('Les trois secrets FTP doivent être renseignés dans GitHub Actions.')
        values[field] = value
    password = values.pop('password')
    config = relay.validate_config(dict(values, protocol='ftp', port=21, remote_path='pos.txt',
                                       archive_path='Archives_posreports', minimum_boats=115,
                                       timeout_seconds=20))
    return config, password


def prepare_runtime(repo, work):
    work = Path(work)
    (work / 'tools').mkdir(parents=True, exist_ok=True)
    (work / 'src').mkdir(parents=True, exist_ok=True)
    shutil.copyfile(Path(repo) / 'tools' / 'publish-report.mjs', work / 'tools' / 'publish-report.mjs')
    for name in COPY_SOURCES:
        shutil.copyfile(Path(repo) / 'src' / name, work / 'src' / name)
    (work / 'package.json').write_text('{"type":"module"}\n', encoding='utf-8')


def sync_once(config, password, work, client_factory=None, budget_seconds=240, max_archives=36,
              stage=lambda value: None):
    """Dernier point d’abord ; les archives en attente reprennent au passage suivant."""
    work = Path(work)
    manifest = work / MANIFEST
    published = read_manifest(manifest.read_bytes()) if manifest.exists() else set()
    started = time.monotonic()
    result = {'archivesImported': 0, 'archiveErrors': 0, 'archivesPending': 0}
    stage('ftp-connect')
    with relay.connected_client(config, password, client_factory) as client:
        # Une erreur ici interrompt le job avant sauvegarde/déploiement.
        stage('latest-download')
        latest = relay.download_from_client(client, config['remote_path'])
        stage('latest-validation')
        result['latest'] = relay.publish_report(latest, config, work)
        stage('archive-list')
        try:
            names = relay.list_archive_names(client, config['archive_path'])
        except Exception:
            names = []
            result['archiveErrors'] += 1
        pending = [name for name in names if name not in published]
        for name in pending:
            if result['archivesImported'] >= max_archives or time.monotonic() - started >= budget_seconds:
                break
            try:
                stage('archive-download')
                raw = relay.download_from_client(client, config['archive_path'] + '/' + name)
            except Exception:
                result['archiveErrors'] += 1
                break  # Une réponse FTP peut être restée en attente après un RETR interrompu.
            try:
                stage('archive-validation')
                relay.publish_report(raw, config, work)
            except Exception:
                result['archiveErrors'] += 1
                continue
            published.add(name)
            result['archivesImported'] += 1
        result['archivesPending'] = len(set(names) - published)
    manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_bytes(manifest_bytes(published))
    return result


def write_pages(work, output):
    """Seuls trois flux publics et la page d’accueil partent vers GitHub Pages."""
    output = Path(output)
    if output.exists() and (output.is_symlink() or any(output.iterdir())):
        raise ValueError('Le dossier de publication doit être vide.')
    (output / 'live').mkdir(parents=True, exist_ok=True)
    for name in LIVE:
        source = Path(work) / 'dist' / 'live' / name
        validate_blob('dist/live/' + name, source.read_bytes())
        shutil.copyfile(source, output / 'live' / name)
        (output / 'live' / name).chmod(0o644)
    (output / 'index.html').write_text('''<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="Installez le suivi de la Route du Rhum dans Windy pour voir les bateaux, leurs traces et rejouer les positions avec la météo.">
<title>Route du Rhum — installer le suivi dans Windy</title>
<style>body{font:18px/1.6 system-ui;max-width:760px;margin:64px auto;padding:0 24px;background:#102635;color:#edf7fc}a{color:#87d8ff}h1{line-height:1.2}li{margin:16px 0}code{display:block;margin:12px 0;padding:16px;border:1px solid #416276;border-radius:8px;background:#163547;font:15px/1.6 ui-monospace,monospace;overflow-wrap:anywhere;user-select:text}small,.note{color:#bad0dd}footer{margin-top:40px;border-top:1px solid #416276;padding-top:16px;font-size:14px}@media(max-width:520px){body{margin:32px auto;padding:0 20px}h1{font-size:1.8em}code{font-size:13px}}</style>
</head>
<body>
<main>
<h1>Route du Rhum · suivi dans Windy</h1>
<p>Affichez la flotte sur la carte météo, suivez les traces des bateaux et rejouez leurs positions.</p>
<h2>Installer le plugin</h2>
<ol>
<li>Ouvrez <a href="https://www.windy.com/plugins">la page des plugins Windy</a>.</li>
<li>Choisissez le chargement d’un plugin depuis une URL, puis copiez et collez cette adresse complète :
<code>https://windy-plugins.com/2439056/windy-plugin-rhum-personnel/0.9.0/plugin.min.js</code>
Confirmez l’installation dans Windy.</li>
<li>Ouvrez le menu Windy et choisissez <strong>Route du Rhum</strong> pour afficher la flotte.</li>
</ol>
<p>Le plugin est déjà installé dans ce navigateur ? <a href="https://www.windy.com/plugin/rhum-personnel">Ouvrir Route du Rhum dans Windy</a>.</p>
<p class="note">Le lien d’ouverture fonctionne après l’installation. Pour une première visite, suivez les étapes ci-dessus. La demande d’examen pour la galerie Windy reste à envoyer.</p>
</main>
<footer>
<p><a href="live/historique.json">Flux des positions et traces</a> · <a href="live/status.json">Date du dernier relevé</a></p>
<p>Actualisation horaire prévue, sous réserve de disponibilité des relevés et du service. Les heures des observations sont en UTC.</p>
</footer>
</body>
</html>\n''', encoding='utf-8')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--once', action='store_true', required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'pages')
    args = parser.parse_args(argv)
    current_stage = 'config'

    def stage(value):
        nonlocal current_stage
        current_stage = value

    try:
        config, password = config_from_environment(os.environ)
        temp_dir = os.environ.get('RUNNER_TEMP')
        if not temp_dir or not Path(temp_dir).is_dir():
            raise ValueError('Le dossier temporaire privé du runner GitHub est absent.')
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                # Un nouvel essai repart exclusivement de la sauvegarde durable ;
                # aucun relevé partiellement traité ne passe d’un essai à l’autre.
                stage('runtime')
                with tempfile.TemporaryDirectory(prefix='rhum-run-', dir=temp_dir) as directory:
                    work = Path(directory)
                    prepare_runtime(ROOT, work)
                    stage('restore')
                    previous = restore_data(ROOT, work)
                    result = sync_once(config, password, work, stage=stage)
                    # La persistance doit réussir avant le déploiement ; les erreurs d’archives
                    # conservent les données déjà reçues et réessaient au passage suivant.
                    stage('save')
                    save_data(ROOT, work, previous, temp_dir)
                    stage('pages')
                    write_pages(work, args.output)
                    print('Dernier relevé validé et sauvegardé. Archives ajoutées : ' + str(result['archivesImported']) +
                          '. Archives en attente : ' + str(result['archivesPending']) + '.')
                    if result['archiveErrors']:
                        print('::warning::Certaines archives sont indisponibles ; nouvel essai au prochain passage.')
                return 0
            except Exception as error:
                if attempt == MAX_ATTEMPTS or not retryable_failure(error, current_stage):
                    raise
                print('::warning::Nouvel essai après interruption (stage=' + current_stage +
                      '; category=' + failure_category(error, current_stage) + '; attempt=' + str(attempt) +
                      '/' + str(MAX_ATTEMPTS) + ').', file=sys.stderr)
                time.sleep(RETRY_DELAY_SECONDS)
        return 0
    except Exception as error:
        # Ne jamais publier d’exception distante : elle peut contenir des identifiants.
        print('::error::Actualisation refusée (stage=' + current_stage + '; category=' +
              failure_category(error, current_stage) + '). Le flux précédemment publié est conservé.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
