import ftplib
import importlib.util
import json
import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('ftp_relay', Path(__file__).parents[1] / 'tools' / 'ftp-relay.py')
relay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(relay)

CONFIG = dict(host='ftp.example.test', user='reader', remote_path='/course/pos.txt')


class FakeFTP:
    def __init__(self, raw=b'POSREPORT\r\n', moving=False, size=None, no_stat=False):
        self.raw = raw
        self.moving = moving
        self.reported_size = len(raw) if size is None else size
        self.no_stat = no_stat
        self.stats = 0
        self.closed = False
        self.tls = False
        self.commands = []

    def connect(self, host, port, timeout): self.commands.append(('connect', host, port, timeout))
    def login(self, user, password): self.commands.append(('login', user, password))
    def prot_p(self): self.tls = True
    def set_pasv(self, value): self.passive = value
    def voidcmd(self, command): self.commands.append(command)
    def sendcmd(self, command):
        if self.no_stat: raise ftplib.error_perm('500 unsupported')
        self.stats += 1
        return str(self.stats) if self.moving else '213 20261102130000'
    def size(self, path):
        if self.no_stat: raise ftplib.error_perm('500 unsupported')
        return self.reported_size
    def retrbinary(self, command, callback):
        self.commands.append(command)
        callback(self.raw)
    def close(self): self.closed = True


class ArchiveFTP(FakeFTP):
    def __init__(self, files, listing=None, nlst_listing=None, listing_error=None, moving_path=None):
        super().__init__()
        self.files = files
        self.listing = listing if listing is not None else [
            (name.rsplit('/', 1)[-1], {'type': 'file'}) for name in files if name != 'pos.txt']
        self.nlst_listing = nlst_listing
        self.listing_error = listing_error
        self.moving_path = moving_path
        self.path_stats = {}

    def mlsd(self, path):
        self.commands.append(('mlsd', path))
        if self.nlst_listing is not None:
            raise ftplib.error_perm('502 MLSD unsupported')
        if self.listing_error:
            raise self.listing_error
        return iter(self.listing)

    def nlst(self, path):
        self.commands.append(('nlst', path))
        return self.nlst_listing

    def sendcmd(self, command):
        self.commands.append(command)
        path = command.removeprefix('MDTM ') if hasattr(command, 'removeprefix') else command[5:]
        self.path_stats[path] = self.path_stats.get(path, 0) + 1
        return str(self.path_stats[path]) if path == self.moving_path else '213 20261102130000'

    def size(self, path):
        return len(self.files[path])

    def retrbinary(self, command, callback):
        self.commands.append(command)
        callback(self.files[command[5:]])


FIRST = 'pos_2026_11_01_12_04_46.txt'
SECOND = 'pos_2026_11_01_13_04_45.txt'
THIRD = 'pos_2026_11_01_14_04_45.txt'
ARCHIVE_CONFIG = dict(CONFIG, remote_path='pos.txt', archive_path='Archives_posreports')


def report_status(raw, config, root):
    return dict(boatCount=115, reportNewest='2026-11-02T13:45:00Z', newPoints=115)


class RelayTests(unittest.TestCase):
    def test_password_file_accepts_one_line_and_preserves_password_spaces(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'secret'
            for content, expected in [(b'  secret  \n', '  secret  '),
                                      (b'secret\r\n', 'secret'), (b'', '')]:
                path.write_bytes(content)
                self.assertEqual(relay.read_password_file(path), expected)

    def test_password_file_rejects_invalid_contents_without_echoing_them(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'secret'
            for content in [b'private-secret\nsecond-line', b'private-secret\0',
                            b'private-secret\xff', b'private-secret' * 500]:
                path.write_bytes(content)
                with self.assertRaises(ValueError) as caught:
                    relay.read_password_file(path)
                self.assertNotIn('private-secret', str(caught.exception))
            with self.assertRaisesRegex(ValueError, 'introuvable ou illisible'):
                relay.read_password_file(Path(directory) / 'absent')

    def test_download_binary_passive_and_close(self):
        fake = FakeFTP(b'POSREPORT\r\ntexte\r\n')
        raw = relay.download_report(CONFIG, 'secret', lambda: fake)
        self.assertEqual(raw, fake.raw)
        self.assertTrue(fake.passive)
        self.assertTrue(fake.closed)
        self.assertIn('RETR /course/pos.txt', fake.commands)

    def test_explicit_ftps_encrypts_data(self):
        fake = FakeFTP()
        relay.download_report(dict(CONFIG, protocol='ftps'), 'secret', lambda: fake)
        self.assertTrue(fake.tls)

    def test_unsupported_remote_stat_is_optional(self):
        fake = FakeFTP(no_stat=True)
        self.assertEqual(relay.download_report(CONFIG, 'secret', lambda: fake), fake.raw)

    def test_reject_moving_partial_empty_or_large_file(self):
        cases = [FakeFTP(moving=True), FakeFTP(size=999), FakeFTP(raw=b''),
                 FakeFTP(raw=b'x' * (relay.MAX_REPORT_BYTES + 1))]
        for fake in cases:
            with self.subTest(size=len(fake.raw)):
                with self.assertRaises(ValueError):
                    relay.download_report(CONFIG, 'secret', lambda: fake)
                self.assertTrue(fake.closed)

    def test_config_refuses_command_injection_and_stored_password(self):
        for change in [dict(remote_path='pos.txt\r\nDELE file'), dict(host='ftp://user:secret@host'),
                       dict(user='user\r\nPASS secret'), dict(password='secret'), dict(port=True),
                       dict(protocol='sftp'), dict(minimum_boats=0), dict(interval_seconds=2)]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                relay.validate_config(dict(CONFIG, **change))

    def test_only_one_relay_per_directory_and_lock_is_released(self):
        with tempfile.TemporaryDirectory() as root:
            with relay.single_relay(root):
                with self.assertRaises(ValueError):
                    with relay.single_relay(root):
                        pass
            with relay.single_relay(root):
                pass

    def test_redacts_secret_even_if_remote_server_echoes_it(self):
        message = relay.safe_message(ValueError('530 password secret rejected'), 'secret')
        self.assertNotIn('secret', message)
        self.assertIn('[masqué]', message)

    def test_archive_config_is_optional_and_paths_refuse_command_injection_or_traversal(self):
        self.assertNotIn('archive_path', relay.validate_config(CONFIG))
        self.assertEqual(relay.validate_config(dict(CONFIG, archive_path=' /Archives_posreports/ '))['archive_path'],
                         '/Archives_posreports')
        self.assertIsNone(relay.validate_config(dict(CONFIG, archive_path=''))['archive_path'])
        for path in ['Archives\r\nDELE file', '../Archives', '/ok/../Archives', '/./Archives', 'folder\\Archives', '\0']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                relay.validate_config(dict(CONFIG, archive_path=path))

    def test_mlsd_lists_only_real_reports_with_valid_dates_and_no_paths(self):
        invalid = ['../' + FIRST, 'other.txt', 'pos_2026_02_30_12_00_00.txt',
                   'pos_2026_11_01_24_00_00.txt', FIRST + '\r\nDELE pos.txt', 'folder/' + FIRST]
        fake = ArchiveFTP({}, listing=[(FIRST, {'type': 'file'}), (SECOND, {'type': 'dir'})] +
                          [(name, {'type': 'file'}) for name in invalid])
        self.assertEqual(relay.list_archive_names(fake, 'Archives_posreports'), [FIRST])

    def test_nlst_fallback_accepts_bare_or_expected_directory_and_rejects_other_paths(self):
        fake = ArchiveFTP({}, nlst_listing=[FIRST, 'Archives_posreports/' + SECOND,
                                           '/Archives_posreports/' + THIRD, '/other/' + FIRST,
                                           'Archives_posreports/../' + FIRST, '../' + SECOND,
                                           'Archives_posreports/nested/' + THIRD, FIRST + '\nDELE other'])
        self.assertEqual(relay.list_archive_names(fake, 'Archives_posreports'), [FIRST, SECOND, THIRD])
        self.assertIn(('nlst', 'Archives_posreports'), fake.commands)

    def test_first_cycle_publishes_latest_before_archives_and_next_cycle_skips_confirmed_files(self):
        files = {'pos.txt': b'latest', 'Archives_posreports/' + SECOND: b'second',
                 'Archives_posreports/' + FIRST: b'first'}
        fake = ArchiveFTP(files)
        progress = []
        with tempfile.TemporaryDirectory() as root, patch.object(relay, 'publish_report', side_effect=report_status) as publish:
            result = relay.sync_cycle(ARCHIVE_CONFIG, 'secret', lambda: fake, root, progress.append)
            self.assertEqual([call.args[0] for call in publish.call_args_list], [b'latest', b'first', b'second'])
            self.assertEqual(result['archivesImported'], 2)
            self.assertEqual(result['archiveErrors'], 0)
            self.assertEqual(sum(isinstance(command, tuple) and command[0] == 'connect' for command in fake.commands), 1)
            self.assertTrue(fake.closed)
            self.assertEqual(fake.commands.count('TYPE I'), 3)
            self.assertTrue(all('UTC]' in message for message in progress))
            index = json.loads((Path(root) / 'state/ftp/archives-index.json').read_text())
            self.assertEqual(index['published'], [FIRST, SECOND])
            publish.reset_mock()
            second = ArchiveFTP(dict(files, **{'Archives_posreports/' + THIRD: b'third'}))
            result = relay.sync_cycle(ARCHIVE_CONFIG, 'secret', lambda: second, root, progress.append)
            self.assertEqual([call.args[0] for call in publish.call_args_list], [b'latest', b'third'])
            self.assertEqual(result['archivesSkipped'], 2)
            self.assertEqual(result['archivesImported'], 1)
            self.assertNotIn('RETR Archives_posreports/' + FIRST, second.commands)

    def test_publication_failure_is_not_indexed_and_is_retried_while_other_archives_continue(self):
        files = {'pos.txt': b'latest', 'Archives_posreports/' + FIRST: b'bad', 'Archives_posreports/' + SECOND: b'good'}

        def publish(raw, config, root):
            if raw == b'bad':
                raise ValueError('Relevé refusé secret')
            return report_status(raw, config, root)

        with tempfile.TemporaryDirectory() as root, patch.object(relay, 'publish_report', side_effect=publish):
            progress = []
            result = relay.sync_cycle(ARCHIVE_CONFIG, 'secret', lambda: ArchiveFTP(files), root, progress.append)
            self.assertIsNotNone(result['latest'])
            self.assertEqual(result['archivesImported'], 1)
            self.assertEqual(result['archiveErrors'], 1)
            self.assertEqual(relay.read_archive_index(root, relay.validate_config(ARCHIVE_CONFIG)), {SECOND})
            self.assertNotIn('secret', '\n'.join(progress))
            self.assertIn('[masqué]', '\n'.join(progress))
            fake = ArchiveFTP(files)
            relay.sync_cycle(ARCHIVE_CONFIG, 'secret', lambda: fake, root, progress.append)
            self.assertIn('RETR Archives_posreports/' + FIRST, fake.commands)
            self.assertNotIn('RETR Archives_posreports/' + SECOND, fake.commands)

    def test_archive_listing_error_does_not_undo_the_latest_publication(self):
        fake = ArchiveFTP({'pos.txt': b'latest'}, listing_error=TimeoutError('secret timeout'))
        with tempfile.TemporaryDirectory() as root, patch.object(relay, 'publish_report', side_effect=report_status) as publish:
            progress = []
            result = relay.sync_cycle(ARCHIVE_CONFIG, 'secret', lambda: fake, root, progress.append)
            self.assertEqual(publish.call_count, 1)
            self.assertIsNotNone(result['latest'])
            self.assertEqual(result['archiveErrors'], 1)
            self.assertNotIn('secret', '\n'.join(progress))
            self.assertTrue(fake.closed)

    def test_unstable_archive_closes_session_and_is_not_indexed(self):
        files = {'pos.txt': b'latest', 'Archives_posreports/' + FIRST: b'moving'}
        fake = ArchiveFTP(files, moving_path='Archives_posreports/' + FIRST)
        with tempfile.TemporaryDirectory() as root, patch.object(relay, 'publish_report', side_effect=report_status) as publish:
            result = relay.sync_cycle(ARCHIVE_CONFIG, 'secret', lambda: fake, root, lambda message: None)
            self.assertEqual(publish.call_count, 1)
            self.assertIsNotNone(result['latest'])
            self.assertEqual(result['archiveErrors'], 1)
            self.assertEqual(relay.read_archive_index(root, relay.validate_config(ARCHIVE_CONFIG)), set())
            self.assertTrue(fake.closed)

    def test_latest_failure_does_not_list_archives_or_change_an_existing_index(self):
        with tempfile.TemporaryDirectory() as root:
            config = relay.validate_config(ARCHIVE_CONFIG)
            relay.write_archive_index(root, config, {FIRST})
            fake = ArchiveFTP({'pos.txt': b'latest'})
            with patch.object(relay, 'publish_report', side_effect=ValueError('invalid latest')), self.assertRaises(ValueError):
                relay.sync_cycle(config, 'secret', lambda: fake, root, lambda message: None)
            self.assertEqual(relay.read_archive_index(root, config), {FIRST})
            self.assertNotIn(('mlsd', config['archive_path']), fake.commands)
            self.assertTrue(fake.closed)

    def test_index_is_tied_to_server_identity_and_archive_directory(self):
        config = relay.validate_config(ARCHIVE_CONFIG)
        with tempfile.TemporaryDirectory() as root:
            relay.write_archive_index(root, config, {FIRST})
            for change in [dict(host='other.example.test'), dict(user='other'), dict(port=2121),
                           dict(protocol='ftps'), dict(archive_path='OtherArchives')]:
                with self.subTest(change=change):
                    self.assertEqual(relay.read_archive_index(root, dict(config, **change)), set())

    def test_failed_atomic_index_replace_keeps_previous_index_and_cleans_temporary_file(self):
        config = relay.validate_config(ARCHIVE_CONFIG)
        with tempfile.TemporaryDirectory() as root:
            relay.write_archive_index(root, config, {FIRST})
            with patch.object(relay.os, 'replace', side_effect=OSError('disk error')), self.assertRaises(OSError):
                relay.write_archive_index(root, config, {FIRST, SECOND})
            self.assertEqual(relay.read_archive_index(root, config), {FIRST})
            self.assertEqual(list((Path(root) / 'state/ftp').glob('.archives-index-*')), [])

    def test_existing_configure_defaults_are_preserved_when_all_answers_are_blank(self):
        config = relay.validate_config(dict(ARCHIVE_CONFIG, interval_seconds=600, timeout_seconds=47, minimum_boats=100))
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / '.ftp-config.json'
            path.write_text(json.dumps(config))
            with patch('builtins.input', return_value=''), patch('builtins.print'):
                relay.configure(path)
            self.assertEqual(json.loads(path.read_text()), config)


if __name__ == '__main__':
    unittest.main()
