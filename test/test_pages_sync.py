import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).parents[1]
spec = importlib.util.spec_from_file_location('pages_sync', ROOT / 'tools' / 'pages-sync.py')
pages = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pages)

FIRST = 'pos_2026_11_01_12_04_46.txt'
SECOND = 'pos_2026_11_01_13_04_45.txt'
CONFIG = pages.relay.validate_config(dict(host='ftp.private.test', user='private-reader', remote_path='pos.txt',
                                         archive_path='Archives_posreports', minimum_boats=2))
STATUS = dict(retrievedAt='2026-11-03T16:05:00.000Z', reportNewest='2026-11-03T15:00:00.000Z',
              publishedNewest='2026-11-03T15:00:00.000Z', boatCount=2, newPoints=2)
FLEET = [dict(id=1, rank=1, lat=47, lon=-21, time='2026-11-03T15:00:00.000Z', heading=248,
              speed=31.1, name='Test', skipper='Skipper', className='Ultim', known=True)]
HISTORY = dict(type='RhumHistory', schema='rhum-history/v1', fleets=[FLEET], retrievedAt=STATUS['retrievedAt'])


def populate(work):
    root = Path(work)
    for name, data in [(pages.MANIFEST, dict(version=1, published=[FIRST])),
                       ('state/ftp/reports/' + 'a' * 64 + '.json', dict(HISTORY, sequence=1)),
                       ('dist/live/historique.json', HISTORY), ('dist/live/status.json', STATUS),
                       ('dist/live/positions.geojson', dict(type='FeatureCollection', features=[], **STATUS))]:
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(data), encoding='utf-8')


class FakeFTP:
    def __init__(self, names=(FIRST, SECOND), fail_latest=False, fail_archive=False, listing_error=False):
        self.names = names
        self.fail_latest, self.fail_archive, self.listing_error = fail_latest, fail_archive, listing_error
        self.commands = []
        self.closed = False

    def connect(self, *args, **kwargs): pass
    def login(self, *args): pass
    def set_pasv(self, value): pass
    def voidcmd(self, command): pass
    def sendcmd(self, command): return '213 20261103150000'
    def size(self, path): return 6
    def retrbinary(self, command, callback):
        self.commands.append(command)
        if (command == 'RETR pos.txt' and self.fail_latest) or ('Archives_posreports/' in command and self.fail_archive):
            raise TimeoutError('server echoed private-password')
        callback(b'latest')
    def mlsd(self, path):
        if self.listing_error:
            raise TimeoutError('private-password')
        return [(name, {'type': 'file'}) for name in self.names]
    def close(self): self.closed = True


class PagesTests(unittest.TestCase):
    def test_only_normalized_data_paths_are_allowed(self):
        self.assertTrue(pages.allowed_path('state/ftp/reports/' + 'a' * 64 + '.json'))
        for name in ['.ftp-config.json', 'state/ftp/archives-index.json', '../dist/live/status.json',
                     'dist/live/../secret.json', 'src/plugin.js', 'dist/live/other.json']:
            self.assertFalse(pages.allowed_path(name), name)

    def test_manifest_contains_only_valid_archive_names_and_no_source(self):
        raw = pages.manifest_bytes({FIRST, SECOND})
        self.assertEqual(pages.read_manifest(raw), {FIRST, SECOND})
        self.assertEqual(set(json.loads(raw)), {'version', 'published'})
        for document in [dict(version=1, published=[FIRST], source={'host': 'private'}),
                         dict(version=1, published=['../' + FIRST]),
                         dict(version=1, published=[FIRST, FIRST]), dict(version=1, published=['pos_2026_02_30_12_00_00.txt'])]:
            with self.assertRaises(ValueError):
                pages.read_manifest(json.dumps(document))

    def test_missing_or_invalid_secrets_fail_without_disclosing_values(self):
        for env in [{}, dict(RHUM_FTP_HOST='host', RHUM_FTP_USER='reader', RHUM_FTP_PASSWORD='secret\nmore')]:
            with self.assertRaises(ValueError) as caught:
                pages.config_from_environment(env)
            self.assertNotIn('secret', str(caught.exception).lower().replace('secrets ftp', 'credentials'))
        config, password = pages.config_from_environment(dict(RHUM_FTP_HOST='ftp.test', RHUM_FTP_USER='reader', RHUM_FTP_PASSWORD=' secret '))
        self.assertNotIn('password', config)
        self.assertEqual(password, ' secret ')
        self.assertEqual(config['port'], 21)
        self.assertEqual(config['archive_path'], 'Archives_posreports')

    def test_sync_skips_persistent_archives_and_retries_failed_archive(self):
        with tempfile.TemporaryDirectory() as work:
            populate(work)
            ftp = FakeFTP(fail_archive=True)
            with patch.object(pages.relay, 'publish_report', return_value=STATUS):
                result = pages.sync_once(CONFIG, 'private-password', work, lambda: ftp)
            self.assertEqual(result['archiveErrors'], 1)
            self.assertEqual(pages.read_manifest((Path(work) / pages.MANIFEST).read_bytes()), {FIRST})
            self.assertNotIn('RETR Archives_posreports/' + FIRST, ftp.commands)
            second = FakeFTP()
            with patch.object(pages.relay, 'publish_report', return_value=STATUS):
                result = pages.sync_once(CONFIG, 'private-password', work, lambda: second)
            self.assertEqual(result['archivesImported'], 1)
            self.assertEqual(pages.read_manifest((Path(work) / pages.MANIFEST).read_bytes()), {FIRST, SECOND})
            self.assertTrue(second.closed)

    def test_latest_failure_preserves_durable_data_and_does_not_import_archives(self):
        with tempfile.TemporaryDirectory() as work:
            populate(work)
            before = pages.generated_files(work)
            ftp = FakeFTP(fail_latest=True)
            with self.assertRaises(TimeoutError):
                pages.sync_once(CONFIG, 'private-password', work, lambda: ftp)
            self.assertEqual(pages.generated_files(work), before)
            self.assertEqual(ftp.commands, ['RETR pos.txt'])
            self.assertTrue(ftp.closed)

    def test_invalid_latest_refuses_publication_and_listing_failure_still_keeps_latest(self):
        with tempfile.TemporaryDirectory() as work:
            populate(work)
            with patch.object(pages.relay, 'publish_report', side_effect=ValueError('invalid latest')):
                with self.assertRaises(ValueError):
                    pages.sync_once(CONFIG, 'secret', work, FakeFTP)
            with patch.object(pages.relay, 'publish_report', return_value=STATUS):
                result = pages.sync_once(CONFIG, 'secret', work, lambda: FakeFTP(listing_error=True))
            self.assertEqual(result['archiveErrors'], 1)
            self.assertEqual(result['latest'], STATUS)

    def test_archive_budget_persists_completed_work_for_next_run(self):
        with tempfile.TemporaryDirectory() as work:
            ftp = FakeFTP()
            with patch.object(pages.relay, 'publish_report', return_value=STATUS):
                result = pages.sync_once(CONFIG, 'secret', work, lambda: ftp, max_archives=1)
            self.assertEqual(result['archivesImported'], 1)
            self.assertEqual(result['archivesPending'], 1)
            self.assertEqual(pages.read_manifest((Path(work) / pages.MANIFEST).read_bytes()), {FIRST})

    def test_snapshot_rejects_symlinks_private_metadata_and_unexpected_reports(self):
        with tempfile.TemporaryDirectory() as work:
            populate(work)
            path = Path(work) / 'state/ftp/reports/private.json'
            path.write_text('{}')
            with self.assertRaises(ValueError): pages.generated_files(work)
            path.unlink()
            status = Path(work) / 'dist/live/status.json'
            status.unlink()
            status.symlink_to(Path(work) / pages.MANIFEST)
            with self.assertRaises(ValueError): pages.generated_files(work)
        for document in [dict(HISTORY, source={'user': 'private-reader'}),
                         dict(HISTORY, fleets=[[dict(FLEET[0], password='private-password')]])]:
            with self.assertRaises(ValueError): pages.validate_blob('dist/live/historique.json', json.dumps(document).encode())

    def test_pages_exports_only_public_live_json_and_landing_page(self):
        with tempfile.TemporaryDirectory() as directory:
            work, output = Path(directory) / 'work', Path(directory) / 'pages'
            populate(work)
            (work / '.ftp-config.json').write_text('private-password')
            pages.write_pages(work, output)
            self.assertEqual(sorted(path.relative_to(output).as_posix() for path in output.rglob('*') if path.is_file()),
                             ['index.html', 'live/historique.json', 'live/positions.geojson', 'live/status.json'])
            self.assertNotIn('private-password', ''.join(path.read_text() for path in output.rglob('*') if path.is_file()))

    def test_git_branch_round_trip_preserves_reports_and_excludes_private_files(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            remote, repo = base / 'remote.git', base / 'code'
            subprocess.run(['git', 'init', '--bare', str(remote)], check=True, capture_output=True)
            subprocess.run(['git', 'init', str(repo)], check=True, capture_output=True)
            subprocess.run(['git', '-C', str(repo), 'remote', 'add', 'origin', str(remote)], check=True)
            work = base / 'first'
            work.mkdir()
            self.assertIsNone(pages.restore_data(repo, work))
            populate(work)
            (work / 'state/ftp/archives-index.json').write_text('{"source":{"host":"private-server"}}')
            (repo / '.ftp-config.json').write_text('private-password')
            commit = pages.save_data(repo, work, None, base)
            restored = base / 'second'
            restored.mkdir()
            self.assertEqual(pages.restore_data(repo, restored), commit)
            self.assertEqual(pages.generated_files(work), pages.generated_files(restored))
            self.assertFalse((restored / 'state/ftp/archives-index.json').exists())
            self.assertFalse((restored / '.ftp-config.json').exists())
            self.assertEqual(pages.save_data(repo, restored, commit, base), commit)

    def test_real_publisher_runs_from_private_runtime_and_restores_history(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory) / 'runtime'
            pages.prepare_runtime(ROOT, work)
            report = b'POSREPORT\n1;1;47.5442N;21.0763W;11/03/26 15:00:00;248/31.1\n2;2;47.5443N;21.0764W;11/03/26 15:00:00;248/30.2\n'
            status = pages.relay.publish_report(report, CONFIG, work)
            self.assertEqual(status['boatCount'], 2)
            manifest = work / pages.MANIFEST
            manifest.write_bytes(pages.manifest_bytes({FIRST}))
            files = pages.generated_files(work)
            self.assertEqual(len([name for name in files if pages.REPORT_PATH.fullmatch(name)]), 1)
            history = json.loads(files['dist/live/historique.json'])
            self.assertEqual(len(history['fleets']), 30)

    def test_cli_never_prints_remote_exception_or_credentials(self):
        environment = dict(RHUM_FTP_HOST='private-host', RHUM_FTP_USER='private-user', RHUM_FTP_PASSWORD='private-password')
        output, errors = io.StringIO(), io.StringIO()
        with tempfile.TemporaryDirectory() as directory:
            environment['RUNNER_TEMP'] = directory
            with patch.dict(os.environ, environment, clear=True), patch.object(pages, 'restore_data', side_effect=RuntimeError('private-password private-host private-user')):
                with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
                    self.assertEqual(pages.main(['--once', '--output', str(Path(directory) / 'pages')]), 1)
        text = output.getvalue() + errors.getvalue()
        for value in ['private-password', 'private-host', 'private-user']:
            self.assertNotIn(value, text)

    def test_cli_retries_transient_ftp_with_fresh_workspace_before_publication(self):
        environment = dict(RHUM_FTP_HOST='private-host', RHUM_FTP_USER='private-user', RHUM_FTP_PASSWORD='private-password')
        workspaces = []

        def sync(config, password, work, stage):
            workspaces.append(Path(work))
            stage('latest-download')
            self.assertFalse((Path(work) / 'incomplete-report').exists())
            if len(workspaces) == 1:
                (Path(work) / 'incomplete-report').write_text('partial data')
                raise TimeoutError('private-host private-user private-password')
            populate(work)
            return dict(archivesImported=1, archivesPending=0, archiveErrors=0)

        output, errors = io.StringIO(), io.StringIO()
        with tempfile.TemporaryDirectory() as directory:
            environment['RUNNER_TEMP'] = directory
            destination = Path(directory) / 'pages'
            with patch.dict(os.environ, environment, clear=True), \
                    patch.object(pages, 'restore_data', return_value='durable-commit') as restore, \
                    patch.object(pages, 'sync_once', side_effect=sync), \
                    patch.object(pages, 'save_data', return_value='new-commit') as save, \
                    patch.object(pages.time, 'sleep') as sleep:
                with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
                    self.assertEqual(pages.main(['--once', '--output', str(destination)]), 0)
                self.assertEqual(json.loads((destination / 'live/status.json').read_text()), STATUS)
                self.assertFalse((destination / 'incomplete-report').exists())
                self.assertEqual(restore.call_count, 2)
                save.assert_called_once()
                sleep.assert_called_once_with(20)
        self.assertEqual(len(set(workspaces)), 2)
        self.assertTrue(all(not work.exists() for work in workspaces))
        self.assertIn('stage=latest-download; category=timeout; attempt=1/3', errors.getvalue())
        for secret in ['private-password', 'private-host', 'private-user']:
            self.assertNotIn(secret, output.getvalue() + errors.getvalue())

    def test_cli_retries_git_save_using_the_newly_restored_commit(self):
        environment = dict(RHUM_FTP_HOST='private-host', RHUM_FTP_USER='private-user', RHUM_FTP_PASSWORD='private-password')
        workspaces = []

        def sync(config, password, work, stage):
            workspaces.append(Path(work))
            populate(work)
            return dict(archivesImported=0, archivesPending=0, archiveErrors=0)

        with tempfile.TemporaryDirectory() as directory:
            environment['RUNNER_TEMP'] = directory
            with patch.dict(os.environ, environment, clear=True), \
                    patch.object(pages, 'restore_data', side_effect=['original-commit', 'concurrent-commit']) as restore, \
                    patch.object(pages, 'sync_once', side_effect=sync), \
                    patch.object(pages, 'save_data', side_effect=[pages.GitOperationError('private-password'), 'new-commit']) as save, \
                    patch.object(pages.time, 'sleep') as sleep, \
                    contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(pages.main(['--once', '--output', str(Path(directory) / 'pages')]), 0)
                self.assertEqual(restore.call_count, 2)
                self.assertEqual([call.args[2] for call in save.call_args_list], ['original-commit', 'concurrent-commit'])
                sleep.assert_called_once_with(20)
        self.assertEqual(len(set(workspaces)), 2)

    def test_cli_stops_after_three_network_attempts_and_keeps_previous_publication(self):
        environment = dict(RHUM_FTP_HOST='private-host', RHUM_FTP_USER='private-user', RHUM_FTP_PASSWORD='private-password')
        def fail(config, password, work, stage):
            stage('ftp-connect')
            raise ConnectionResetError('private-password private-host private-user')

        errors = io.StringIO()
        with tempfile.TemporaryDirectory() as directory:
            environment['RUNNER_TEMP'] = directory
            destination = Path(directory) / 'pages'
            destination.mkdir()
            previous = destination / 'previous-publication'
            previous.write_text('unchanged')
            with patch.dict(os.environ, environment, clear=True), \
                    patch.object(pages, 'restore_data', return_value='original-commit'), \
                    patch.object(pages, 'sync_once', side_effect=fail) as sync, \
                    patch.object(pages, 'save_data') as save, patch.object(pages, 'write_pages') as write, \
                    patch.object(pages.time, 'sleep') as sleep, contextlib.redirect_stderr(errors):
                self.assertEqual(pages.main(['--once', '--output', str(destination)]), 1)
                self.assertEqual(sync.call_count, 3)
                self.assertEqual(sleep.call_count, 2)
                save.assert_not_called()
                write.assert_not_called()
            self.assertEqual(previous.read_text(), 'unchanged')
            self.assertEqual(list(destination.iterdir()), [previous])
        self.assertIn('stage=ftp-connect; category=connection', errors.getvalue())
        for secret in ['private-password', 'private-host', 'private-user']:
            self.assertNotIn(secret, errors.getvalue())

    def test_cli_does_not_retry_ftp_permission_or_structural_validation_failures(self):
        environment = dict(RHUM_FTP_HOST='private-host', RHUM_FTP_USER='private-user', RHUM_FTP_PASSWORD='private-password')
        cases = [('ftp-connect', pages.ftplib.error_perm('530 private-password'), 'ftp-permission'),
                 ('latest-download', ValueError('private-password partial report'), 'validation'),
                 ('latest-validation', ValueError('private-password invalid report'), 'validation'),
                 ('restore', ValueError('private-password forbidden file'), 'validation')]
        for failed_stage, exception, category in cases:
            with self.subTest(stage=failed_stage), tempfile.TemporaryDirectory() as directory:
                environment['RUNNER_TEMP'] = directory
                def fail(config, password, work, stage):
                    stage(failed_stage)
                    raise exception
                errors = io.StringIO()
                with patch.dict(os.environ, environment, clear=True), \
                        patch.object(pages, 'restore_data', return_value='original-commit'), \
                        patch.object(pages, 'sync_once', side_effect=fail) as sync, \
                        patch.object(pages, 'save_data') as save, patch.object(pages, 'write_pages') as write, \
                        patch.object(pages.time, 'sleep') as sleep, contextlib.redirect_stderr(errors):
                    self.assertEqual(pages.main(['--once', '--output', str(Path(directory) / 'pages')]), 1)
                    sync.assert_called_once()
                    save.assert_not_called()
                    write.assert_not_called()
                    sleep.assert_not_called()
                self.assertIn('stage=' + failed_stage + '; category=' + category, errors.getvalue())
                self.assertNotIn('private-password', errors.getvalue())

    def test_cli_classifies_known_publisher_failures_without_exposing_received_text(self):
        environment = dict(RHUM_FTP_HOST='private-host', RHUM_FTP_USER='private-user', RHUM_FTP_PASSWORD='private-password')
        sentinel = 'private-password private-host private-user RECEIVED-SECRET-SENTINEL'
        cases = [
            ('Publication refusée : Relevé incomplet : 114 bateaux reçus, 115 minimum attendus. ', 'report-incomplete'),
            ('Publication refusée : Positions contradictoires pour le bateau #1 à ', 'history-conflict'),
            ('Publication refusée : Un relevé archivé est invalide. ', 'stored-report-invalid'),
            ('Publication refusée : Positions, ligne 4 : Coordonnée latitude invalide : ', 'coordinate-invalid'),
            ('Publication refusée : Positions, ligne 4 : Coordonnée longitude invalide : ', 'coordinate-invalid'),
            ('Publication refusée : Positions, ligne 4 : Coordonnée hors limites : ', 'coordinate-invalid'),
            ('Publication refusée : Positions, ligne 7 : Le cap doit être compris entre 0° inclus et 360° exclus. ', 'cap-range'),
            ('Publication refusée : Positions, ligne 7 : Cap invalide. ', 'cap-invalid'),
            ('Publication refusée : Positions, ligne 4 : Rang invalide. ', 'rank-invalid'),
            ('Publication refusée : Positions, ligne 4 : Rang doit être un entier positif. ', 'rank-invalid'),
            ('Publication refusée : Positions, ligne 4 : Date invalide (MM/JJ/AA HH:MM:SS attendu) : ', 'date-invalid'),
            ('Publication refusée : Positions, ligne 4 : Date ou heure UTC invalide. ', 'date-invalid'),
            ('Publication refusée : Positions, ligne 4 : Vitesse invalide. ', 'speed-invalid'),
            ('Publication refusée : Positions, ligne 4 : La vitesse doit être un nombre positif ou nul en nœuds. ', 'speed-invalid'),
            ('Publication refusée : Positions, ligne 4 : ID invalide. ', 'id-invalid'),
            ('Publication refusée : Positions, ligne 4 : ID doit être un entier positif. ', 'id-invalid'),
            ('Publication refusée : Positions, ligne 4 : ID en double : ', 'duplicate-id'),
            ('Publication refusée : Positions, ligne 4 : Six champs séparés par des points-virgules sont attendus. ', 'field-count'),
            ('Publication refusée : Positions, ligne 4 : Cap/vitesse invalide. ', 'movement-format'),
            ('Publication refusée : Positions, ligne 4 : Unknown nested parser error ', 'report-format'),
            ('Publication refusée : Positions, ligne injected : Rang invalide. ', 'validation'),
            ('Publication refusée : En-tête POSREPORT absent. ', 'report-format'),
            ('Publication refusée : Aucune position dans le relevé. ', 'report-format'),
            ('Remote text containing Relevé incomplet : ', 'validation'),
            ('Unrecognized publisher error ', 'validation'),
        ]
        for message, category in cases:
            with self.subTest(category=category, prefix=message), tempfile.TemporaryDirectory() as directory:
                environment['RUNNER_TEMP'] = directory
                exception = ValueError(message + sentinel)
                self.assertEqual(pages.failure_category(exception, 'restore'), 'validation')
                def fail(config, password, work, stage):
                    stage('latest-validation')
                    raise exception
                output, errors = io.StringIO(), io.StringIO()
                with patch.dict(os.environ, environment, clear=True), \
                        patch.object(pages, 'restore_data', return_value='durable-commit'), \
                        patch.object(pages, 'sync_once', side_effect=fail), \
                        patch.object(pages, 'save_data') as save, patch.object(pages, 'write_pages') as write, \
                        patch.object(pages.time, 'sleep') as sleep, \
                        contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
                    self.assertEqual(pages.main(['--once', '--output', str(Path(directory) / 'pages')]), 1)
                    save.assert_not_called()
                    write.assert_not_called()
                    sleep.assert_not_called()
                log = output.getvalue() + errors.getvalue()
                self.assertIn('stage=latest-validation; category=' + category, log)
                for secret in ['private-password', 'private-host', 'private-user', 'RECEIVED-SECRET-SENTINEL']:
                    self.assertNotIn(secret, log)

    def test_rank_shape_distinguishes_zero_from_invalid_and_oversized_without_values(self):
        sentinel = b'PRIVATE-SOURCE-SENTINEL'
        raw = b'POSREPORT\r\n' + b'\r\n'.join(rank + b';' + sentinel for rank in [
            b'1', b' 002 ', b'0', b'000', b'-1', b'', b'abc', b'1.5',
            b'9007199254740991', b'9007199254740992', b'9' * 10_000,
        ]) + b'\r\n\r\n'
        shape = pages.report_shape(raw)
        self.assertEqual(shape, dict(rows=11, rankZero=2, rankNonNumeric=4, rankOversized=2))
        self.assertNotIn(sentinel.decode(), json.dumps(shape))

    def test_latest_shape_is_logged_before_validation_failure_without_source_text(self):
        raw = b'POSREPORT\n0;PRIVATE-SOURCE-SENTINEL\n1;private-password\n'
        ftp = FakeFTP(names=())
        ftp.size = lambda path: len(raw)
        ftp.retrbinary = lambda command, callback: callback(raw)
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(pages.relay, 'publish_report', side_effect=ValueError('private-password')), \
                contextlib.redirect_stdout(output):
            with self.assertRaises(ValueError):
                pages.sync_once(CONFIG, 'private-password', directory, lambda: ftp)
        self.assertEqual(output.getvalue(),
                         'Dernier relevé reçu : rows=2; rankZero=1; rankNonNumeric=0; rankOversized=0.\n')
        self.assertNotIn('PRIVATE-SOURCE-SENTINEL', output.getvalue())
        self.assertNotIn('private-password', output.getvalue())


if __name__ == '__main__':
    unittest.main()
