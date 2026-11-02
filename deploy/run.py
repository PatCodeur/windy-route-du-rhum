#!/usr/bin/env python3
"""Démarre le serveur et le relais ; arrête les deux si l'un s'arrête."""
from pathlib import Path
import os
import signal
import subprocess
import sys
import time


ROOT = Path(__file__).resolve().parents[1]


def main():
    children = []
    stopping = False

    def stop(_signal=None, _frame=None):
        nonlocal stopping
        stopping = True
        for child in children:
            try:
                # Inclut le validateur Node éventuellement lancé par le relais.
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    exit_code = 0
    try:
        children.append(subprocess.Popen([
            sys.executable, '-u', str(ROOT / 'deploy' / 'http_server.py'),
            '--host', '0.0.0.0', '--port', '8080', '--directory', str(ROOT / 'dist' / 'live'),
        ], cwd=ROOT, start_new_session=True))
        children.append(subprocess.Popen([
            sys.executable, '-u', str(ROOT / 'tools' / 'ftp-relay.py'),
            '--config', '/run/config/ftp.json',
            '--password-file', '/run/secrets/ftp_password',
        ], cwd=ROOT, start_new_session=True))
        while not stopping:
            if any(child.poll() is not None for child in children):
                exit_code = 1
                break
            time.sleep(0.25)
    finally:
        stop()
        deadline = time.monotonic() + 10
        for child in children:
            try:
                child.wait(timeout=max(0, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                child.wait()
    return exit_code


if __name__ == '__main__':
    sys.exit(main())
