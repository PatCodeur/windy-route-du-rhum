import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest


spec = importlib.util.spec_from_file_location(
    'public_server', Path(__file__).parents[1] / 'deploy' / 'http_server.py')
server = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = server
spec.loader.exec_module(server)


class PublicServerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name) / 'live'
        self.directory.mkdir()
        for filename in server.PUBLIC_FILES.values():
            (self.directory / filename).write_text('{"boatCount":115}\n')

    def request(self, method='GET', path='/live/historique.json'):
        return server.public_response(method, path, self.directory)

    def test_exact_public_routes_return_json_with_cors(self):
        for path in server.PUBLIC_FILES:
            with self.subTest(path=path):
                response = self.request(path=path)
                self.assertEqual(response.status, 200)
                self.assertEqual(json.loads(response.body), {'boatCount': 115})
                self.assertEqual(response.headers['Access-Control-Allow-Origin'], '*')
                self.assertEqual(response.headers['Cache-Control'], 'no-store')
                self.assertEqual(int(response.headers['Content-Length']), len(response.body))

    def test_head_has_get_headers_and_no_body(self):
        response = self.request('HEAD')
        self.assertEqual(response.status, 200)
        self.assertEqual(response.headers, self.request().headers)
        self.assertEqual(response.body, b'')

    def test_preflight_and_queries(self):
        self.assertEqual(self.request('OPTIONS').status, 204)
        self.assertEqual(self.request('OPTIONS').body, b'')
        self.assertEqual(self.request(path='/live/historique.json?v=1').status, 200)
        self.assertEqual(self.request('OPTIONS', '/unknown').status, 404)

    def test_private_files_traversal_encoded_paths_and_listing_are_not_exposed(self):
        for path in ('/', '/live/', '/.ftp-config.json', '/run/secrets/ftp_password',
                     '/state/ftp/reports/report.json', '/live/../.ftp-config.json',
                     '/live/%2e%2e/.ftp-config.json', '/live%2fhistorique.json',
                     '/live/historique.json/extra', '//live/historique.json',
                     'https://host/live/historique.json', '/live/historique.json#secret',
                     '/live/positions.geojson.bak'):
            with self.subTest(path=path):
                self.assertEqual(self.request(path=path).status, 404)

    def test_only_read_methods_are_allowed(self):
        for method in ('POST', 'PUT', 'DELETE', 'PATCH', 'TRACE', 'CONNECT'):
            with self.subTest(method=method):
                response = self.request(method)
                self.assertEqual(response.status, 405)
                self.assertEqual(response.headers['Allow'], 'GET, HEAD, OPTIONS')

    def test_missing_data_keeps_health_available(self):
        (self.directory / 'historique.json').unlink()
        response = self.request()
        self.assertEqual(response.status, 404)
        self.assertEqual(json.loads(response.body), {'error': 'not_available'})
        health = self.request(path='/healthz')
        self.assertEqual(health.status, 200)
        self.assertEqual(json.loads(health.body), {'ok': True})

    def test_symlinks_cannot_publish_private_data(self):
        private = self.directory.parent / 'password'
        private.write_text('never-public')
        filename = self.directory / 'historique.json'
        filename.unlink()
        filename.symlink_to(private)
        response = self.request()
        self.assertEqual(response.status, 503)
        self.assertNotIn(b'never-public', response.body)
        self.assertNotIn(str(private).encode(), response.body)

    def test_read_error_has_no_filesystem_details(self):
        filename = self.directory / 'historique.json'
        filename.unlink()
        filename.mkdir()
        response = self.request()
        self.assertEqual(response.status, 503)
        self.assertNotIn(str(filename).encode(), response.body)


if __name__ == '__main__':
    unittest.main()
