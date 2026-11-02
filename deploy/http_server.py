#!/usr/bin/env python3
"""Expose uniquement les trois fichiers publics produits par le relais."""
import argparse
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
from urllib.parse import urlsplit


PUBLIC_FILES = {
    '/live/historique.json': 'historique.json',
    '/live/positions.geojson': 'positions.geojson',
    '/live/status.json': 'status.json',
}
COMMON_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
}


@dataclass(frozen=True)
class Response:
    status: int
    headers: dict
    body: bytes


def public_response(method, target, directory):
    """Fonction sans socket : aucun chemin reçu n'est joint au dossier de données."""
    headers = dict(COMMON_HEADERS)
    if method not in ('GET', 'HEAD', 'OPTIONS'):
        headers['Allow'] = 'GET, HEAD, OPTIONS'
        status, body = 405, b'{"error":"method_not_allowed"}\n'
    else:
        try:
            parsed = urlsplit(target)
            valid = not (parsed.scheme or parsed.netloc or parsed.fragment)
            path = parsed.path if valid else None
        except ValueError:
            path = None
        if path not in PUBLIC_FILES and path != '/healthz':
            status, body = 404, b'{"error":"not_found"}\n'
        elif method == 'OPTIONS':
            status, body = 204, b''
        elif path == '/healthz':
            # Indique seulement que le serveur répond, pas la fraîcheur du relevé.
            status, body = 200, b'{"ok":true}\n'
        else:
            filename = Path(directory) / PUBLIC_FILES[path]
            try:
                # Même un lien symbolique portant un nom autorisé est refusé.
                descriptor = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW)
                with os.fdopen(descriptor, 'rb') as stream:
                    body = stream.read()
                status = 200
            except FileNotFoundError:
                status, body = 404, b'{"error":"not_available"}\n'
            except OSError:
                status, body = 503, b'{"error":"temporarily_unavailable"}\n'
    headers['Content-Length'] = str(len(body))
    return Response(status, headers, b'' if method == 'HEAD' else body)


def handler_for(directory):
    directory = Path(directory).resolve()

    class PublicHandler(BaseHTTPRequestHandler):
        def respond(self):
            response = public_response(self.command, self.path, directory)
            self.send_response(response.status)
            for name, value in response.headers.items():
                self.send_header(name, value)
            self.end_headers()
            if response.body:
                self.wfile.write(response.body)

        do_GET = respond
        do_HEAD = respond
        do_OPTIONS = respond
        do_POST = respond
        do_PUT = respond
        do_DELETE = respond
        do_PATCH = respond
        do_CONNECT = respond
        do_TRACE = respond

        def log_message(self, *_):
            # Aucun URL, paramètre ou détail du système de fichiers dans les logs.
            pass

    return PublicHandler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=Path('/app/dist/live'))
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8080)
    args = parser.parse_args()
    with ThreadingHTTPServer((args.host, args.port), handler_for(args.directory)) as server:
        server.serve_forever()


if __name__ == '__main__':
    main()
