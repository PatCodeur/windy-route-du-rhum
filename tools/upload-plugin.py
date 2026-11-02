#!/usr/bin/env python3
"""Validate a public plugin archive, then upload with a locally entered Windy key."""
import argparse
import getpass
import ipaddress
import json
from pathlib import Path
import re
import sys
import tarfile
import urllib.error
import urllib.parse
import urllib.request
import uuid

UPLOAD_URL = "https://node.windy.com/plugins/v1.0/upload"
REQUIRED = {"plugin.js", "plugin.min.js", "plugin.json"}
ALLOWED = REQUIRED | {"screenshot.jpg", "screenshot.png", "screenshot.webp", "screenshot.jpeg"}
MAX_ARCHIVE_BYTES = 50 * 1024 * 1024
MAX_FEED_BYTES = 64 * 1024 * 1024
MAX_REPLY_BYTES = 1024 * 1024


def public_feed_url(value):
    if not isinstance(value, str) or re.search(r"[\s?#]", value):
        raise ValueError("Le flux public doit être une URL HTTPS sans paramètres ni fragment.")
    url = urllib.parse.urlsplit(value)
    if url.scheme != "https" or not url.hostname or url.username or url.password:
        raise ValueError("Le flux public doit utiliser HTTPS, sans identifiants.")
    _ = url.port  # Also reject malformed or out-of-range ports.
    host = url.hostname.lower().rstrip(".")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address is not None:
        if address.version != 4 or not address.is_global:
            raise ValueError("Le flux doit utiliser un domaine public ou une adresse IPv4 publique.")
    elif re.fullmatch(r"[0-9.]+", host) or re.match(r"^0x[0-9a-f]+(?:\.|$)", host):
        raise ValueError("Représentation numérique d’adresse IP non autorisée.")
    elif "." not in host or re.search(r"(?:^|\.)(?:localhost|local|localdomain|internal|test|invalid|onion)$", host) or host.endswith("home.arpa"):
        raise ValueError("Un relais local ne peut pas être publié pour les autres utilisateurs.")
    return value


def validate_archive(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError("L’archive TAR doit être un fichier régulier existant.")
    if path.stat().st_size > MAX_ARCHIVE_BYTES:
        raise ValueError("Archive trop volumineuse.")
    contents = {}
    total = 0
    try:
        with tarfile.open(path, mode="r:") as archive:
            for entry in archive:
                if not entry.isfile() or entry.name not in ALLOWED or entry.name in contents:
                    raise ValueError("Archive refusée : fichier inattendu, doublon, lien ou chemin non autorisé.")
                total += entry.size
                if total > MAX_ARCHIVE_BYTES:
                    raise ValueError("Contenu de l’archive trop volumineux.")
                stream = archive.extractfile(entry)
                if stream is None:
                    raise ValueError("Fichier illisible dans l’archive.")
                contents[entry.name] = stream.read()
    except (tarfile.TarError, OSError) as error:
        raise ValueError("Archive TAR invalide ou illisible.") from error
    if not REQUIRED.issubset(contents):
        raise ValueError("L’archive doit contenir plugin.js, plugin.min.js et plugin.json.")
    try:
        config = json.loads(contents["plugin.json"].decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as error:
        raise ValueError("Métadonnées plugin.json invalides.") from error
    if not isinstance(config, dict) or config.get("private") is not False or config.get("publicMode") is not True:
        raise ValueError("L’archive doit être préparée explicitement pour une publication publique.")
    if config.get("name") != "windy-plugin-rhum-personnel":
        raise ValueError("Nom du plugin inattendu.")
    if not isinstance(config.get("author"), str) or not config["author"].strip():
        raise ValueError("Le nom de l’auteur est obligatoire.")
    if not isinstance(config.get("version"), str) or not re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", config["version"]):
        raise ValueError("Version du plugin invalide.")
    repo = config.get("repositoryName")
    if not isinstance(repo, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_.-]{1,100}", repo):
        raise ValueError("Dépôt GitHub manquant ou invalide.")
    owner, name = repo.split("/")
    if name in (".", "..") or owner.endswith("-") or config.get("repositoryOwner") != owner or config.get("repository") != "https://github.com/" + repo:
        raise ValueError("Métadonnées du dépôt incohérentes.")
    if not isinstance(config.get("commitSha"), str) or not re.fullmatch(r"[a-fA-F0-9]{7,40}", config["commitSha"]):
        raise ValueError("Référence du commit Git manquante.")
    feed = public_feed_url(config.get("publicFeedUrl"))
    for name in ("plugin.js", "plugin.min.js"):
        try:
            bundle = contents[name].decode("utf-8")
        except UnicodeDecodeError as error:
            raise ValueError("JavaScript public invalide.") from error
        if feed not in bundle or "sourceMappingURL=" in bundle:
            raise ValueError("Le flux public est absent du JavaScript, ou une source map subsiste.")
        if name == "plugin.js":
            marker = re.search(r"\bconst\s+__pluginConfig\s*=\s*", bundle)
            if marker is None:
                raise ValueError("La configuration Windy est absente du JavaScript public.")
            try:
                embedded, _ = json.JSONDecoder().raw_decode(bundle[marker.end():])
            except ValueError as error:
                raise ValueError("La configuration Windy intégrée est illisible.") from error
            if not isinstance(embedded, dict) or any(embedded.get(key) != value for key, value in config.items()
                                                    if key not in ("built", "builtReadable")):
                raise ValueError("Le JavaScript et plugin.json n’annoncent pas la même configuration publique.")
    screenshot = config.get("screenshot")
    if screenshot is not None and (screenshot not in ALLOWED - REQUIRED or screenshot not in contents):
        raise ValueError("Capture d’écran annoncée mais absente de l’archive.")
    return config, sorted(contents)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward the API key to a redirected address.
        raise urllib.error.HTTPError(req.full_url, code, "Redirection refusée", headers, fp)


def preflight_public_feed(url):
    """Check the feed exactly as a Windy browser origin would read it, before asking for a key."""
    public_feed_url(url)
    request = urllib.request.Request(url, headers={
        "Origin": "https://www.windy.com", "Accept": "application/json",
    })
    opener = urllib.request.build_opener(NoRedirect())
    with opener.open(request, timeout=20) as response:
        if response.status != 200:
            raise ValueError("Le flux public ne répond pas avec un statut HTTP 200.")
        cors = response.headers.get("Access-Control-Allow-Origin", "").strip()
        if cors not in ("*", "https://www.windy.com"):
            raise ValueError("Le flux public doit autoriser Windy par CORS (Access-Control-Allow-Origin: * ou https://www.windy.com).")
        content_length = response.headers.get("Content-Length")
        if content_length is not None:
            try:
                if int(content_length) > MAX_FEED_BYTES:
                    raise ValueError("Le flux public dépasse la limite de 64 Mio.")
            except (TypeError, ValueError) as error:
                raise ValueError("Taille du flux public invalide ou supérieure à 64 Mio.") from error
        data = response.read(MAX_FEED_BYTES + 1)
    if len(data) > MAX_FEED_BYTES:
        raise ValueError("Le flux public dépasse la limite de 64 Mio.")
    try:
        feed = json.loads(data.decode("utf-8-sig"))
    except (ValueError, UnicodeDecodeError) as error:
        raise ValueError("Le flux public ne contient pas un document JSON valide.") from error
    if not isinstance(feed, dict) or feed.get("type") != "RhumHistory" or feed.get("schema") != "rhum-history/v1":
        raise ValueError("Le flux public doit fournir un historique RhumHistory au format rhum-history/v1.")
    fleets = feed.get("fleets")
    if not isinstance(fleets, list) or not fleets or any(not isinstance(fleet, list) or not fleet for fleet in fleets):
        raise ValueError("Le flux public doit contenir au moins un relevé de positions non vide.")
    if any(not isinstance(boat, dict) for fleet in fleets for boat in fleet):
        raise ValueError("Les relevés du flux public doivent contenir des positions de bateaux.")
    return {"fleetCount": len(fleets), "boatCount": len(fleets[-1])}


def upload_archive(path, api_key):
    boundary = "rhum-" + uuid.uuid4().hex
    archive_bytes = Path(path).read_bytes()
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"plugin_archive\"; filename=\"plugin.tar\"\r\n"
            "Content-Type: application/x-tar\r\n\r\n").encode("ascii")
    body += archive_bytes + f"\r\n--{boundary}--\r\n".encode("ascii")
    request = urllib.request.Request(UPLOAD_URL, data=body, method="POST", headers={
        "Content-Type": "multipart/form-data; boundary=" + boundary,
        "x-windy-api-key": api_key,
    })
    opener = urllib.request.build_opener(NoRedirect())
    with opener.open(request, timeout=60) as response:
        data = response.read(MAX_REPLY_BYTES + 1)
        # Keep a bounded response so the installation link supplied by Windy is not lost.
        return {"status": response.status, "body": data[:MAX_REPLY_BYTES].decode("utf-8", errors="replace"),
                "truncated": len(data) > MAX_REPLY_BYTES}


def publication_reply(result, api_key):
    """Interpret an API reply without inventing an installation URL or exposing the key."""
    def redact(text):
        if api_key:
            for representation in {api_key, urllib.parse.quote(api_key, safe=""), urllib.parse.quote_plus(api_key)}:
                text = text.replace(representation, "[clé masquée]")
        return re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", text)

    body = result["body"]
    try:
        payload = json.loads(body)
    except ValueError:
        payload = None

    urls = []

    def sanitized(value):
        if isinstance(value, str):
            safe = redact(value)
            if safe.startswith(("https://", "http://")) and not re.search(r"\s", safe) and "[clé masquée]" not in safe:
                try:
                    parsed = urllib.parse.urlsplit(safe)
                    if parsed.hostname and not parsed.username and not parsed.password and safe not in urls:
                        urls.append(safe)
                except ValueError:
                    pass
            return safe
        if isinstance(value, dict):
            return {redact(str(key)): sanitized(item) for key, item in value.items()}
        if isinstance(value, list):
            return [sanitized(item) for item in value]
        return value

    failed = False
    positive = False
    if isinstance(payload, dict):
        state = payload.get("status")
        state_text = state.lower() if isinstance(state, str) else ""
        failed = bool(payload.get("error") or payload.get("errors")) or payload.get("success") is False or payload.get("ok") is False or state_text in ("error", "failed", "failure", "rejected")
        if isinstance(state, int) and not isinstance(state, bool) and state >= 400:
            failed = True
        positive = payload.get("success") is True or payload.get("ok") is True or state_text in ("ok", "success", "successful", "published", "uploaded", "accepted", "done")
    if payload is not None:
        safe_payload = sanitized(payload)
        message = json.dumps(safe_payload, ensure_ascii=False)
    else:
        message = redact(body).strip()
        for line in message.splitlines():
            sanitized(line.strip())
    status = result["status"]
    return {"confirmed": 200 <= status < 300 and not failed and (positive or bool(urls)),
            "error": failed or not 200 <= status < 300, "urls": urls,
            "message": message[:4000], "truncated": result.get("truncated", False) or len(message) > 4000}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Publier l’archive publique auprès de Windy. La clé est saisie localement, masquée et jamais enregistrée.")
    parser.add_argument("--archive", required=True, type=Path, help="Archive TAR créée par build-public.mjs")
    parser.add_argument("--dry-run", action="store_true", help="Vérifier l’archive sans clé API ni connexion réseau")
    args = parser.parse_args(argv)
    try:
        config, files = validate_archive(args.archive)
        print(f"Archive publique valide : {config['name']} {config['version']} ({len(files)} fichiers).")
        print(f"Flux destiné aux utilisateurs : {config['publicFeedUrl']}")
        if args.dry_run:
            print("Vérification terminée. Aucun envoi effectué.")
            return 0
        if not sys.stdin.isatty():
            raise ValueError("Lancez cette commande dans un Terminal interactif pour saisir la clé Windy sans l’afficher.")
        try:
            availability = preflight_public_feed(config["publicFeedUrl"])
        except urllib.error.HTTPError as error:
            raise ValueError(f"Le flux public est inaccessible (HTTP {error.code}). Aucun envoi à Windy effectué.") from error
        except urllib.error.URLError as error:
            raise ValueError("Connexion HTTPS au flux public impossible. Aucun envoi à Windy effectué.") from error
        print(f"Flux HTTPS accessible depuis Windy : {availability['fleetCount']} relevés, {availability['boatCount']} bateaux au dernier relevé.")
        key = getpass.getpass("Clé API Windy pour publier le plugin (saisie masquée) : ").strip()
        if not key or re.search(r"[\r\n\x00]", key):
            raise ValueError("Clé API absente ou invalide.")
        result = upload_archive(args.archive, key)
        reply = publication_reply(result, key)
        if reply["error"]:
            print(f"Publication non confirmée : Windy signale une erreur (HTTP {result['status']}).", file=sys.stderr)
        elif reply["confirmed"]:
            print(f"Le service Windy a accepté l’archive (HTTP {result['status']}).")
        else:
            print(f"Réponse de Windy reçue (HTTP {result['status']}) ; publication non confirmée.")
        if reply["urls"] and not reply["error"]:
            print("Liens renvoyés par Windy :")
            for url in reply["urls"]:
                print(url)
        elif not reply["error"]:
            print("Aucun lien d’installation renvoyé. Vérifiez le statut de publication dans votre compte Windy.")
        if reply["message"]:
            print("Réponse de Windy : " + reply["message"])
        if reply["truncated"]:
            print("Réponse affichée partiellement (taille limitée).")
        return 0 if reply["confirmed"] else 1
    except (ValueError, OSError, urllib.error.URLError) as error:
        if isinstance(error, urllib.error.HTTPError):
            message = f"Windy a refusé la requête (HTTP {error.code}). Vérifiez la clé API et les exigences de publication."
        elif isinstance(error, urllib.error.URLError):
            message = "Connexion HTTPS à Windy impossible. Aucun résultat de publication confirmé."
        else:
            message = str(error)
        print("Publication interrompue : " + message, file=sys.stderr)
        return 1
    except (KeyboardInterrupt, EOFError):
        print("\nPublication annulée.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
