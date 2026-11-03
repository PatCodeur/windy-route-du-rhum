# Publier le suivi Route du Rhum pour les autres utilisateurs

**La version 0.9.1 est publiée, installée et vérifiée dans Windy.** L’envoi a reçu HTTP 201 le 3 novembre 2026. Le flux corrigé affiche le relevé **12:00:18 UTC**, **115 dernières positions connues** et **51 relevés**. Le dernier fichier FTP fournit 114 bateaux ; le bateau absent conserve son point daté précédent.

URL exacte renvoyée par Windy pour installer **0.9.1** :

```text
https://windy-plugins.com/2439056/windy-plugin-rhum-personnel/0.9.1/plugin.min.js
```

Sources : [PatCodeur/windy-route-du-rhum](https://github.com/PatCodeur/windy-route-du-rhum). Le flux est hébergé gratuitement par GitHub Actions et GitHub Pages ; voir [GITHUB-GRATUIT.md](GITHUB-GRATUIT.md). La demande d’examen pour la galerie Windy n’a pas encore été envoyée.

## Correctif 0.9.1 et état de mise en service

Le 3 novembre, le relais a refusé un relevé contenant 115 positions, dont une avec un rang non numérique. Le correctif conserve les coordonnées et représente ce rang par **— / Non communiqué**, sans attribuer de statut sportif ni calculer un classement de remplacement. Les autres contrôles des positions restent actifs. Le plugin 0.9.0 refusait aussi ce rang : installer 0.9.1 pour lire le flux corrigé.

Le paquet correspond au commit `ee1b59661e096e9508031ccf3b0cfff42c35cbb3`, conservé dans la [release v0.9.1](https://github.com/PatCodeur/windy-route-du-rhum/releases/tag/v0.9.1). Le relais a reçu un contrôle de complétude adaptatif et une correction du statut public au commit `fc8a657dca0a279ceb0d24d8149719518ec23de9`. **168 tests Node et 50 tests Python réussissent**. La [reprise 41626579394](https://github.com/PatCodeur/windy-route-du-rhum/actions/runs/41626579394) et le contrôle dans Windy ont réussi. Le passage horaire naturel du **3 novembre à 12:10 UTC (13:10 à Paris)** a réussi, sans relance manuelle : [exécution 41633492203](https://github.com/PatCodeur/windy-route-du-rhum/actions/runs/41633492203). Voir [SECOURS-ACTUALISATION.md](SECOURS-ACTUALISATION.md).

## Installer ou mettre à jour dans Windy

1. Ouvrir [les plugins Windy](https://www.windy.com/plugins).
2. Choisir le chargement depuis une URL, coller l’adresse **0.9.1** ci-dessus et confirmer l’installation.
3. Dans le menu Windy, ouvrir **Route du Rhum**, puis choisir **Dernier relevé** pour quitter un éventuel rejeu.

Après installation dans ce navigateur, [Ouvrir Route du Rhum](https://www.windy.com/plugin/rhum-personnel) permet de rouvrir le panneau. Ce lien d’ouverture ne remplace pas l’installation. Un navigateur qui utilise encore 0.9.0 doit installer la nouvelle URL ; un simple rechargement ne remplace pas nécessairement le paquet déjà installé.

Le plugin lit le flux HTTPS toutes les cinq minutes et conserve les dernières données valides pendant une coupure. L’actualisation avance les bateaux si **Dernier relevé** est sélectionné ; elle conserve un instant de rejeu ou une heure météo future.

## Les deux éléments publiés

| Élément | Fonction | Hébergement |
| --- | --- | --- |
| Relais de positions | Récupère `pos.txt` et les archives ; conserve les traces ; sert le flux HTTPS | GitHub Actions + GitHub Pages |
| Plugin Windy | Affiche les bateaux et lit automatiquement ce flux | Serveurs officiels `windy-plugins.com` |

Les visiteurs n’ont ni FTP à configurer ni Terminal à lancer. Les identifiants FTP restent dans les secrets GitHub, hors du code, du paquet Windy et des réponses publiques. L’alternative [Docker](deploy/README.md) n’a pas été déployée ici.

## Construire une prochaine version

Prévoir un numéro de version inédit, le compte Windy de publication, le nom d’auteur, le dépôt et le commit exact de la version. Une clé **Windy Plugins API** se crée sur [api.windy.com/keys](https://api.windy.com/keys). Ne placer aucune clé ni aucun mot de passe dans les sources ou dans une conversation.

```sh
npm run build:public -- \
  --feed-url "https://patcodeur.github.io/windy-route-du-rhum/live/historique.json" \
  --author "NOM PUBLIC DE L’AUTEUR" \
  --repository "PatCodeur/windy-route-du-rhum" \
  --commit "COMMIT_GIT"
```

La construction retire l’historique embarqué et règle le flux HTTPS sans modifier l’installation locale. Elle produit `release/windy-plugin-rhum-personnel-0.9.1.tar` : `plugin.js`, `plugin.min.js`, `plugin.json` et la capture si présente, sans configuration FTP, mot de passe, `state` ou sources de débogage. Les fichiers générés sont dans `release/public-plugin/`.

## Vérifier et envoyer le paquet

Le contrôle hors ligne ne demande aucune clé :

```sh
npm run publish:check -- --archive release/windy-plugin-rhum-personnel-0.9.1.tar
```

Commande utilisée pour l’envoi confirmé :

```sh
npm run publish:windy -- --archive release/windy-plugin-rhum-personnel-0.9.1.tar
```

L’outil vérifie le flux HTTPS et CORS, puis demande la clé Windy en saisie masquée, sans l’enregistrer. Une archive ou un flux invalide interrompt l’envoi. Les liens affichés sont ceux réellement renvoyés par Windy.

| Paquet | Taille | SHA-256 |
| --- | --- | --- |
| 0.9.1, accepté le 3 novembre 2026 | 269 312 octets | `f02702ab59e85d1a6868803396c87047489afce2e576efe9d9b902efbbe592d9` |
| 0.9.0, publié le 2 novembre 2026 | 268 800 octets | `6e2fe3fad09f29ee33e67dd672156ef4162f852c904dee2e340f1439b4cb27eb` |

Le bundle 0.9.1 reçu depuis Windy a été contrôlé en HTTPS : HTTP 200, CORS `*`, **84 829 octets**, identique au fichier minifié du TAR. L’installation par son URL officielle a été confirmée dans Windy, puis vérifiée après rechargement : 115 bateaux, 51 relevés, rang **— / Non communiqué** sur la fiche OCEANS et conservation du dernier point connu du bateau absent. La [release historique v0.9.0](https://github.com/PatCodeur/windy-route-du-rhum/releases/tag/v0.9.0) conserve le paquet initial publié le 2 novembre.

## Apparition dans la galerie Windy

La [procédure officielle](https://docs.windy-plugins.com/getting-started/publishing-plugin.html) exige une demande d’examen après publication. Préparer l’URL, une capture réelle et la description pour le [fil indiqué par Windy](https://community.windy.com/topic/31066/list-of-finished-windy-plugins-v42). Aucun message n’a été envoyé et aucune présence dans la galerie n’est annoncée.
