# Relais public des positions

Ce dossier prépare un serveur autonome : il récupère le FTP, conserve les relevés validés et publie les données en HTTPS. Il fonctionne quand le Mac est éteint. Il ne publie pas à lui seul le plugin dans le catalogue Windy.

**État : configuration fournie, aucun serveur ni domaine déployé.** Le choix de l'hébergement et le domaine restent à préciser. L'image Docker n'a pas été construite dans cet environnement ; les tests du serveur HTTP s'exécutent sans Docker ni connexion FTP.

## Préparer le serveur

Il faut un serveur Linux toujours allumé avec Docker Engine et Docker Compose, un domaine pointant vers son adresse publique et les ports entrants 80 et 443 disponibles. Si un enregistrement DNS IPv6 existe, il doit aussi pointer vers ce serveur. Le serveur doit pouvoir sortir vers le FTP, y compris ses ports de données passifs.

Copier le projet sur le serveur **sans** `node_modules`, `.ftp-config.json`, `state/`, `dist/live/` ni mot de passe. L'image utilise une liste explicite de fichiers autorisés et ne lance pas `npm install`. Elle n'embarque aucun fichier de configuration FTP.

Dans le dossier du projet, préparer les deux fichiers privés :

```sh
mkdir -p deploy/runtime
cp deploy/ftp.example.json deploy/runtime/ftp.json
```

Remplacer `SERVEUR_FTP` et `IDENTIFIANT_FTP` dans `deploy/runtime/ftp.json`. Le mot de passe doit rester dans un fichier séparé. Le saisir depuis le terminal du serveur, sans le mettre dans une commande ni dans le JSON :

```sh
python3 -c 'import getpass,pathlib; p=pathlib.Path("deploy/runtime/ftp_password"); p.write_text(getpass.getpass("Mot de passe FTP : "), encoding="utf-8"); p.chmod(0o600)'
sudo chown 1000:1000 deploy/runtime/ftp_password
```

Le conteneur du relais s'exécute sous l'utilisateur 1000. Avec Docker Compose sur Linux, le secret est monté à partir du fichier local : son propriétaire doit donc lui permettre la lecture. Ne pas placer `deploy/runtime/` dans Git ni dans une archive à distribuer. Ce dossier est exclu du contexte de construction de l'image.

## Démarrer

Remplacer le domaine d'exemple ci-dessous par le domaine retenu. Il s'agit du nom seul, sans `https://` ni chemin. Caddy demande et renouvelle son certificat HTTPS automatiquement lorsque le domaine et les ports sont prêts.

```sh
export RHUM_DOMAIN="positions.votre-domaine.fr"
docker compose -f deploy/compose.yaml config --quiet
docker compose -f deploy/compose.yaml up -d --build
docker compose -f deploy/compose.yaml logs --tail=40 relay caddy
```

Le premier transfert doit afficher « Dernier relevé publié ». Les archives sont ensuite importées progressivement. Le relais vérifie le FTP toutes les cinq minutes pour récupérer le relevé horaire dès qu'il apparaît. En cas d'erreur, il conserve le dernier flux validé et réessaie au passage suivant.

Le port 8080 reste interne à Docker ; seuls Caddy et ses ports publics 80/443 sont exposés. Les données sont volontairement accessibles à tous, avec CORS ouvert pour permettre leur lecture dans Windy. Aucun navigateur ne reçoit les identifiants FTP.

## Contrôler le flux puis connecter Windy

Les seules adresses servies sont :

| Chemin | Contenu |
| --- | --- |
| `/live/historique.json` | Flux à connecter dans le plugin : positions et traces |
| `/live/positions.geojson` | Dernières positions validées |
| `/live/status.json` | Dates de récupération et du dernier point publié |
| `/healthz` | Réponse du serveur HTTP, sans détail privé |

Par exemple, après le premier transfert :

```sh
curl --fail "https://${RHUM_DOMAIN}/live/status.json"
```

Le champ `publishedNewest` donne la date UTC du point le plus récent ; `retrievedAt` indique la dernière récupération publiée. `/healthz` répond aussi avant le premier transfert : c'est un contrôle de fonctionnement du serveur, **pas** une garantie de fraîcheur des positions. Avant le premier relevé validé, les routes de données renvoient 404. Ne pas connecter un flux dont le premier transfert ou la date n'ont pas été vérifiés.

Dans Windy, connecter l'adresse HTTPS du domaine retenu suivie de `/live/historique.json`. Utiliser cette même adresse dans la configuration publique du plugin avant de le soumettre au catalogue. Aucune adresse réelle n'est préremplie ici.

## Arrêt, redémarrage et conservation

```sh
docker compose -f deploy/compose.yaml down
docker compose -f deploy/compose.yaml up -d
```

Les volumes `ftp_state` et `live_data` conservent l'index des archives, les relevés et le flux entre redémarrages. Les volumes Caddy conservent les certificats. Prévoir des sauvegardes régulières des volumes de données. **Ne pas utiliser `down -v` : cette option supprime les volumes.** Après une modification du code, relancer `up -d --build`.

Le superviseur arrête les deux processus si l'un s'arrête ; Docker redémarre le service. Un arrêt volontaire reste arrêté grâce à `restart: unless-stopped`.

## Tests locaux

Depuis le dossier du projet :

```sh
python3 -m unittest discover -s test -p "test_public_server.py"
```

Ces tests vérifient les routes publiques, les méthodes de lecture, CORS, l'absence de listing, le refus des chemins privés et des liens symboliques, ainsi que la conservation de réponses génériques en cas d'erreur. La construction Docker, le certificat du vrai domaine et l'accès FTP depuis l'hébergeur doivent être contrôlés lors du déploiement réel.

Références : [HTTPS automatique Caddy](https://caddyserver.com/docs/automatic-https), [compression des réponses](https://caddyserver.com/docs/caddyfile/directives/encode), [images officielles Node](https://github.com/nodejs/docker-node).
