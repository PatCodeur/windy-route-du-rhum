#!/usr/bin/env python3
"""Relais local FTP -> validation des positions -> flux HTTPS du plugin Windy."""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import ftplib
import getpass
import json
import os
import re
import shutil
import ssl
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = ROOT / '.ftp-config.json'
MAX_REPORT_BYTES = 2 * 1024 * 1024
MAX_PASSWORD_BYTES = 4096
ARCHIVE_NAME = re.compile(r'pos_[0-9]{4}_[0-9]{2}_[0-9]{2}_[0-9]{2}_[0-9]{2}_[0-9]{2}\.txt', re.ASCII)


def validate_config(config):
    if not isinstance(config, dict):
        raise ValueError('La configuration doit être un objet JSON.')
    result = dict(config)
    for field in ('host', 'user', 'remote_path'):
        value = result.get(field)
        if not isinstance(value, str) or not value.strip() or any(char in value for char in '\r\n\0'):
            raise ValueError(f'Champ manquant ou invalide : {field}.')
    result['host'] = result['host'].strip()
    if any(char in result['host'] for char in '/@?# ') or '://' in result['host']:
        raise ValueError('Indiquez seulement le nom du serveur dans host, sans URL ni identifiants.')
    if result.get('protocol', 'ftp') not in ('ftp', 'ftps'):
        raise ValueError('Protocoles pris en charge : ftp ou ftps explicite.')
    result.setdefault('protocol', 'ftp')
    result.setdefault('port', 21)
    result.setdefault('interval_seconds', 300)
    result.setdefault('timeout_seconds', 30)
    result.setdefault('minimum_boats', 115)
    for field, low, high in [('port', 1, 65535), ('interval_seconds', 60, 86400),
                             ('timeout_seconds', 1, 120), ('minimum_boats', 1, 10000)]:
        value = result[field]
        if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
            raise ValueError(f'Champ invalide : {field}.')
    if 'password' in result:
        raise ValueError('Retirez le mot de passe du fichier : il sera demandé dans le Terminal.')
    archive_path = result.get('archive_path')
    if archive_path is not None:
        if not isinstance(archive_path, str) or any(char in archive_path for char in '\r\n\0'):
            raise ValueError('Champ invalide : archive_path.')
        archive_path = archive_path.strip().rstrip('/')
        if any(part in ('.', '..') for part in archive_path.split('/')) or '\\' in archive_path:
            raise ValueError('Le dossier d’archives ne doit pas contenir de traversée de dossiers.')
        result['archive_path'] = archive_path or None
    return result


def remote_signature(client, path):
    """Compare la date et la taille quand le serveur fournit ces commandes."""
    modified, size = None, None
    try:
        modified = client.sendcmd('MDTM ' + path)
    except ftplib.error_perm:
        pass
    try:
        size = client.size(path)
    except ftplib.error_perm:
        pass
    return modified, size


@contextmanager
def connected_client(config, password, client_factory=None):
    if client_factory is None:
        client = (ftplib.FTP_TLS(context=ssl.create_default_context(), timeout=config['timeout_seconds'])
                  if config['protocol'] == 'ftps' else ftplib.FTP(timeout=config['timeout_seconds']))
    else:
        client = client_factory()
    try:
        client.connect(config['host'], config['port'], timeout=config['timeout_seconds'])
        client.login(config['user'], password)
        if config['protocol'] == 'ftps':
            client.prot_p()
        client.set_pasv(True)
        yield client
    finally:
        # close ne renvoie pas le dialogue d’authentification ni de trace contenant le secret.
        client.close()


def download_from_client(client, remote_path):
    client.voidcmd('TYPE I')
    before = remote_signature(client, remote_path)
    if before[1] is not None and before[1] > MAX_REPORT_BYTES:
        raise ValueError('Le fichier de positions dépasse la taille maximale de 2 Mo.')
    chunks, byte_count = [], 0

    def receive(chunk):
        nonlocal byte_count
        byte_count += len(chunk)
        if byte_count > MAX_REPORT_BYTES:
            raise ValueError('Le fichier de positions dépasse la taille maximale de 2 Mo.')
        chunks.append(chunk)

    client.retrbinary('RETR ' + remote_path, receive)
    after = remote_signature(client, remote_path)
    if before != after:
        raise ValueError('Le fichier a changé pendant sa récupération ; nouvel essai au prochain passage.')
    raw = b''.join(chunks)
    if not raw:
        raise ValueError('Le serveur a renvoyé un fichier vide.')
    if before[1] is not None and len(raw) != before[1]:
        raise ValueError('La taille récupérée ne correspond pas à celle annoncée par le serveur.')
    return raw


def download_report(config, password, client_factory=None):
    config = validate_config(config)
    with connected_client(config, password, client_factory) as client:
        return download_from_client(client, config['remote_path'])


def valid_archive_name(name):
    if not isinstance(name, str) or not ARCHIVE_NAME.fullmatch(name):
        return False
    try:
        datetime.strptime(name, 'pos_%Y_%m_%d_%H_%M_%S.txt')
    except ValueError:
        return False
    return True


def list_archive_names(client, archive_path):
    """Ne construit des commandes RETR qu’à partir de noms de relevés validés."""
    try:
        entries = list(client.mlsd(archive_path))
        return sorted({name for name, facts in entries
                       if facts.get('type') == 'file' and valid_archive_name(name)})
    except (ftplib.error_perm, AttributeError):
        entries = client.nlst(archive_path)
        names = set()
        prefixes = {archive_path.rstrip('/') + '/', '/' + archive_path.strip('/') + '/'}
        for entry in entries:
            if not isinstance(entry, str):
                continue
            name = entry
            if not valid_archive_name(name):
                name = next((entry[len(prefix):] for prefix in prefixes if entry.startswith(prefix)), '')
            if valid_archive_name(name):
                names.add(name)
        return sorted(names)


def archive_source(config):
    return {field: config.get(field) for field in ('protocol', 'host', 'port', 'user', 'archive_path')}


def read_archive_index(root, config):
    path = Path(root) / 'state' / 'ftp' / 'archives-index.json'
    if not path.exists():
        return set()
    document = json.loads(path.read_text(encoding='utf-8'))
    if document.get('version') != 1 or document.get('source') != archive_source(config):
        return set()
    names = document.get('published')
    if not isinstance(names, list) or any(not valid_archive_name(name) for name in names):
        raise ValueError('L’index local des archives est invalide.')
    return set(names)


def write_archive_index(root, config, published):
    path = Path(root) / 'state' / 'ftp' / 'archives-index.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    document = dict(version=1, source=archive_source(config), published=sorted(published))
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent,
                                         prefix='.archives-index-', suffix='.tmp', delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(document, handle, ensure_ascii=False, indent=2)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def sync_cycle(config, password, client_factory=None, root=ROOT, status=print):
    """Publie le dernier relevé, puis les archives encore absentes de l’index local."""
    config = validate_config(config)

    def progress(message):
        stamp = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
        status(f'[{stamp}] ' + safe_message(message, password))

    result = dict(latest=None, archivesImported=0, archivesSkipped=0, archiveErrors=0)
    with connected_client(config, password, client_factory) as client:
        raw = download_from_client(client, config['remote_path'])
        latest = publish_report(raw, config, root)
        result['latest'] = latest
        progress(f"Dernier relevé publié : {latest['boatCount']} bateaux, dernier point "
                 f"{latest['reportNewest']}, {latest['newPoints']} nouveau(x) point(s).")
        if not config.get('archive_path'):
            return result
        try:
            names = list_archive_names(client, config['archive_path'])
            try:
                published = read_archive_index(root, config)
            except (ValueError, OSError, TypeError, AttributeError):
                published = set()
                progress('Index local illisible : les archives seront revérifiées.')
            pending = [name for name in names if name not in published]
            result['archivesSkipped'] = len(names) - len(pending)
            progress(f"Archives : {len(pending)} à importer, {result['archivesSkipped']} déjà publiées.")
        except Exception as error:
            result['archiveErrors'] += 1
            progress('Liste des archives indisponible ; nouvel essai au prochain passage : ' + safe_message(error, password))
            return result
        for number, name in enumerate(pending, start=1):
            try:
                remote_path = config['archive_path'].rstrip('/') + '/' + name
                raw = download_from_client(client, remote_path)
            except Exception as error:
                result['archiveErrors'] += 1
                progress(f'Archive {name} reportée au prochain passage : ' + safe_message(error, password))
                # Une interruption RETR peut laisser une réponse en attente. On ferme
                # cette session, puis reprend les archives manquantes au cycle suivant.
                break
            try:
                publication = publish_report(raw, config, root)
                confirmed = published | {name}
                write_archive_index(root, config, confirmed)
                published = confirmed
                result['archivesImported'] += 1
                progress(f"Archive {number}/{len(pending)} publiée : {name}, "
                         f"{publication['newPoints']} nouveau(x) point(s).")
            except Exception as error:
                result['archiveErrors'] += 1
                progress(f'Archive {name} reportée au prochain passage : ' + safe_message(error, password))
    return result


def publish_report(raw, config, root=ROOT):
    node = shutil.which('node')
    if not node:
        raise ValueError('Node.js est introuvable ; ouvrez le même Terminal que pour npm start.')
    command = [node, str(Path(root) / 'tools' / 'publish-report.mjs'),
               '--root', str(root), '--minimum-boats', str(config['minimum_boats'])]
    result = subprocess.run(command, input=raw, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            cwd=root, timeout=45, check=False)
    if result.returncode:
        detail = result.stderr.decode('utf-8', errors='replace').strip()
        raise ValueError(detail or 'Le relevé a été refusé par les contrôles de positions.')
    return json.loads(result.stdout.decode('utf-8'))


def safe_message(error, password):
    # Le serveur peut renvoyer un texte arbitraire. Ne jamais réafficher le secret.
    message = str(error).replace(password, '[masqué]') if password else str(error)
    return message[:1000]


def read_password_file(path):
    """Entrée non interactive pour un secret monté sur le serveur, jamais journalisé."""
    try:
        with Path(path).open('rb') as handle:
            raw = handle.read(MAX_PASSWORD_BYTES + 1)
    except OSError:
        raise ValueError('Le fichier du mot de passe FTP est introuvable ou illisible.') from None
    if len(raw) > MAX_PASSWORD_BYTES:
        raise ValueError('Le fichier du mot de passe FTP dépasse la taille autorisée.')
    try:
        password = raw.decode('utf-8')
    except UnicodeError:
        raise ValueError('Le fichier du mot de passe FTP doit contenir du texte UTF-8.') from None
    # Une fin de ligne de fichier est tolérée, sans retirer les espaces du secret.
    if password.endswith('\n'):
        password = password[:-1]
        if password.endswith('\r'):
            password = password[:-1]
    if any(character in password for character in '\r\n\0'):
        raise ValueError('Le fichier du mot de passe FTP doit contenir une seule ligne.')
    return password


def configure(path):
    print('Configuration locale du relais. Le mot de passe ne sera pas enregistré.')
    config = validate_config(json.loads(path.read_text(encoding='utf-8'))) if path.exists() else {}

    def ask(label, field, default):
        current = config.get(field, default)
        return input(f'{label} [{current}] : ').strip() or current

    config['protocol'] = ask('Protocole ftp ou ftps', 'protocol', 'ftp')
    config['host'] = ask('Adresse du serveur, sans ftp://', 'host', '')
    config['port'] = int(ask('Port', 'port', 21))
    config['user'] = ask('Identifiant', 'user', 'anonymous')
    config['remote_path'] = ask('Chemin du fichier de positions', 'remote_path', 'pos.txt')
    archives = ask('Dossier des archives, - pour désactiver', 'archive_path', '')
    config['archive_path'] = None if archives in ('', '-') else archives
    config['minimum_boats'] = int(ask('Nombre minimal de positions attendu', 'minimum_boats', 115))
    config['interval_seconds'] = int(ask('Vérification du FTP, en secondes', 'interval_seconds', 300))
    config = validate_config(config)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('Paramètres enregistrés. Lancez npm run ftp:once pour tester la connexion.')


@contextmanager
def single_relay(root=ROOT):
    # Le Mac libère ce verrou automatiquement à la fermeture du processus.
    import fcntl
    path = Path(root) / 'state' / 'ftp' / 'relay.lock'
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a+', encoding='utf-8') as handle:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('Un relais est déjà lancé dans un autre Terminal.') from None
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=DEFAULT_CONFIG)
    parser.add_argument('--configure', action='store_true')
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--password-file', type=Path,
                        help='Fichier de secret monté sur le serveur ; le mot de passe reste hors de la configuration.')
    args = parser.parse_args()
    try:
        if args.configure:
            configure(args.config)
            return 0
        if not args.config.exists():
            raise ValueError('Paramètres FTP absents. Lancez npm run ftp:configure.')
        config = validate_config(json.loads(args.config.read_text(encoding='utf-8')))
        with single_relay():
            password = (read_password_file(args.password_file) if args.password_file else
                        '' if config['user'].lower() == 'anonymous' else
                        getpass.getpass('Mot de passe FTP (saisie masquée) : '))
            print('Relais démarré. Les derniers relevés valides sont conservés en cas d’erreur.', flush=True)
            while True:
                try:
                    result = sync_cycle(config, password, status=lambda message: print(message, flush=True))
                    print('Flux JSON publié dans dist/live/ pour votre serveur HTTPS.' if args.password_file else
                          'Flux pour Windy : https://localhost:9999/live/historique.json', flush=True)
                    if args.once:
                        return 1 if result['archiveErrors'] else 0
                except Exception as error:
                    print('Récupération refusée : ' + safe_message(error, password), file=sys.stderr, flush=True)
                    if args.once:
                        return 1
                time.sleep(config['interval_seconds'])
    except KeyboardInterrupt:
        print('\nRelais arrêté ; les relevés enregistrés sont conservés.')
        return 0
    except Exception as error:
        print('Erreur : ' + safe_message(error, locals().get('password', '')), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
