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


if __name__ == '__main__':
    unittest.main()
