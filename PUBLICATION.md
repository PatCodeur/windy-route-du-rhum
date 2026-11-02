# Publier le suivi Route du Rhum pour les autres utilisateurs

**La version 0.9.0 est publiée sur les serveurs officiels Windy.** L’envoi effectué depuis le Terminal le 2 novembre 2026 a été confirmé par une réponse HTTP 201. Le [flux HTTPS](https://patcodeur.github.io/windy-route-du-rhum/live/historique.json) est également publié : 115 bateaux identifiés, autorisation CORS `*` et dernier pointage vérifié à 19:00:35 UTC le 2 novembre 2026. La solution gratuite utilise GitHub Actions et GitHub Pages ; voir [GITHUB-GRATUIT.md](GITHUB-GRATUIT.md).

URL exacte du plugin renvoyée par Windy pour l’installation :

```text
https://windy-plugins.com/2439056/windy-plugin-rhum-personnel/0.9.0/plugin.min.js
```

Le code est disponible dans [PatCodeur/windy-route-du-rhum](https://github.com/PatCodeur/windy-route-du-rhum), et le TAR public dans la [release v0.9.0](https://github.com/PatCodeur/windy-route-du-rhum/releases/tag/v0.9.0). **L’installation et le fonctionnement du plugin ont été vérifiés dans Windy. La demande d’examen pour la galerie Windy n’a pas encore été envoyée.**

## Installer et ouvrir le plugin

1. Ouvrir [les plugins Windy](https://www.windy.com/plugins).
2. Choisir le chargement depuis une URL et coller l’adresse complète du bundle ci-dessus, puis confirmer l’installation.
3. Ouvrir le menu Windy et choisir **Route du Rhum**.

Après cette installation dans le navigateur, le lien [Ouvrir Route du Rhum](https://www.windy.com/plugin/rhum-personnel) permet de rouvrir le panneau. Pour un premier visiteur, il faut d’abord effectuer les trois étapes : le lien d’ouverture n’installe pas automatiquement le plugin.

Votre version locale fonctionne comme avant. Sa configuration FTP et son mot de passe ne font pas partie du paquet public.

## Les deux éléments publiés

| Élément | Rôle | Hébergement |
|---|---|---|
| Relais de positions | Récupère `pos.txt` et les archives, conserve les traces, sert un flux HTTPS | GitHub Actions + GitHub Pages (gratuit, dépôt public) |
| Plugin Windy | Affiche les bateaux et lit ce flux automatiquement | Serveurs officiels `windy-plugins.com` |

Les visiteurs utilisent l’URL officielle du plugin sans lancer un Terminal ni configurer le FTP. La version publique commence sans anciennes positions embarquées, récupère son premier relevé automatiquement et réessaie toutes les cinq minutes après une coupure. Si elle dispose déjà de données valides, elle les conserve pendant la coupure. Quand le dernier relevé est sélectionné, une actualisation avance les bateaux ; un instant de rejeu ou une heure météo future restent sélectionnés.

## 1. Héberger le flux

La solution gratuite est détaillée dans [GITHUB-GRATUIT.md](GITHUB-GRATUIT.md). Le dossier [deploy](deploy/README.md) reste une alternative sur serveur à installer : relais FTP, stockage persistant et accès HTTPS. Il nécessite un serveur compatible Docker et un domaine qui pointe vers celui-ci. Un hébergement web classique devra être examiné avant de retenir cette méthode.

Le mot de passe FTP sera saisi sur le serveur dans un fichier privé, monté séparément du programme. Il n’est jamais inclus dans l’image, le JavaScript du plugin ou les réponses publiques. Le serveur expose seulement les trois fichiers du flux et une adresse de contrôle ; les fichiers de configuration et les archives internes restent inaccessibles par HTTP.

Avant de construire le plugin public, vérifier que l’adresse HTTPS retenue, suivie de `/live/historique.json`, renvoie les positions réelles et autorise leur lecture depuis Windy. Le dossier de déploiement contient les commandes de contrôle. Aucun domaine d’exemple ne doit être utilisé comme adresse de production.

## 2. Identité de publication et prochaines versions

Pour une prochaine publication, prévoir :

- le compte Windy qui publiera le plugin ;
- le nom d’auteur à afficher ;
- un dépôt GitHub du projet, public ou privé, et le commit correspondant à la version ;
- une clé **Windy Plugins API**, créée depuis [api.windy.com/keys](https://api.windy.com/keys) et saisie dans le Terminal au moment de l’envoi ;
- une véritable capture du plugin dans Windy, à placer dans `src/screenshot.png` ou `src/screenshot.jpg` pour présenter le résultat.

Le nom technique `windy-plugin-rhum-personnel` est conservé. La version publique porte le titre **« Route du Rhum — suivi des bateaux »** et `private: false` dans ses métadonnées Windy. Le `private: true` du fichier `package.json` reste volontairement présent : il évite une publication npm, qui n’est pas la procédure utilisée par Windy.

Ne copiez aucune clé API ni aucun mot de passe dans le dépôt ou dans la conversation.

## 3. Construire le paquet public

La commande suivante décrit la construction d’une prochaine version : renseigner le nom d’auteur et le commit de la version à publier. Augmenter sa version avant un nouvel envoi à Windy.

```sh
npm run build:public -- \
  --feed-url "https://patcodeur.github.io/windy-route-du-rhum/live/historique.json" \
  --author "NOM PUBLIC DE L’AUTEUR" \
  --repository "PatCodeur/windy-route-du-rhum" \
  --commit "COMMIT_GIT"
```

La construction utilise un dossier temporaire et conserve les fichiers de votre installation locale. Elle retire l’historique embarqué, remplace le réglage local par l’adresse HTTPS publique et produit :

```text
release/windy-plugin-rhum-personnel-0.9.0.tar
```

Ce TAR contient uniquement `plugin.js`, `plugin.min.js`, `plugin.json` et la capture si elle est présente. Il ne contient ni configuration FTP, ni mot de passe, ni dossier `state`, ni sources de débogage. Le dossier `release/public-plugin/` permet aussi d’inspecter les fichiers générés.

Le TAR de la release 0.9.0 publiée mesure **268 800 octets**. Son empreinte SHA-256 est :

```text
6e2fe3fad09f29ee33e67dd672156ef4162f852c904dee2e340f1439b4cb27eb
```

## 4. Vérifier puis envoyer à Windy

La vérification suivante reste hors ligne et ne demande aucune clé :

```sh
npm run publish:check -- --archive release/windy-plugin-rhum-personnel-0.9.0.tar
```

L’envoi de la version 0.9.0 a déjà réussi. La commande utilisée était :

```sh
npm run publish:windy -- --archive release/windy-plugin-rhum-personnel-0.9.0.tar
```

L’outil vérifie d’abord le flux public HTTPS et ses autorisations de lecture depuis Windy, puis demande la clé Windy en saisie masquée. La clé est utilisée seulement pour l’envoi à l’API officielle et n’est pas enregistrée. Une archive ou un flux invalide interrompt l’envoi. Le Terminal affiche la réponse du service et les liens effectivement renvoyés par Windy ; il n’invente pas d’adresse d’installation. Une erreur signalée par Windy, même avec un statut HTTP 200, ne sera pas présentée comme une publication réussie.

L’URL officielle renvoyée par Windy et les étapes d’installation figurent en tête de ce document. Le chargement, les filtres, une fiche bateau et le rejeu ont été vérifiés dans le navigateur. L’envoi réussi n’attribue pas encore une place dans la galerie. Pour une nouvelle publication, augmenter le numéro de version et utiliser le nom du TAR correspondant.

## 5. Apparition dans la galerie

La [procédure officielle Windy](https://docs.windy-plugins.com/getting-started/publishing-plugin.html) prévoit une publication sur ses serveurs, puis une demande d’examen pour rendre le plugin visible dans la galerie. Le code peut être stocké dans un dépôt GitHub public ou privé. Le [fil de la communauté indiqué par Windy](https://community.windy.com/topic/31066/list-of-finished-windy-plugins-v42) sert à présenter les plugins à examiner.

Préparer pour cette présentation : l’URL officielle de la version publiée ci-dessus, une capture de la carte, le nom du plugin, sa fonction de suivi de la flotte et l’adresse du dépôt. La demande d’examen n’a pas encore été faite et aucun message n’a été envoyé au forum Windy.

## Vérifications effectuées et restantes

Les tests automatisés couvrent le démarrage local et public, le chargement et la reprise du flux, les archives FTP, la séparation du secret, les routes publiques et le paquet de publication. **162 tests Node et 40 tests Python réussissent** ; les compilations locale et publique ont été contrôlées.

Le [premier workflow GitHub](https://github.com/PatCodeur/windy-route-du-rhum/actions/runs/41508185794) a réussi. Le flux public a été vérifié en HTTPS, avec 115 bateaux et CORS `*` ; aucune archive n’était encore en attente à la fin de ce passage. La réception du paquet par Windy est confirmée par HTTP 201.

Le contrôle dans Windy a confirmé l’installation depuis l’URL officielle et l’ouverture du panneau **Route du Rhum** : 115 bateaux, huit bateaux avec le filtre Ultim, fiche de Tom Laperche avec rang, coordonnées et moyennes 4 h/24 h. Le rejeu est passé à 18:00:19 UTC puis revenu au dernier pointage à 19:00:35 UTC. La réouverture par le lien du plugin fonctionne après installation dans ce navigateur. Une capture du résultat a été conservée pour préparer la demande d’examen pour la galerie, qui reste à envoyer.

L’alternative Docker n’a pas été déployée ni vérifiée dans cet environnement. Les clés API et identifiants FTP restent en dehors des sources publiques.
