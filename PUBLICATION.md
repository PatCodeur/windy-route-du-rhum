# Publier le suivi Route du Rhum pour les autres utilisateurs

La préparation technique est disponible en version 0.9. La solution gratuite retenue utilise GitHub Actions et GitHub Pages : suivre [GITHUB-GRATUIT.md](GITHUB-GRATUIT.md). **Le flux et le plugin ne sont pas encore publiés.** Le dépôt est `PatCodeur/windy-route-du-rhum` ; l’adresse prévue du flux est indiquée dans le guide GitHub. Son accessibilité doit être vérifiée après le premier déploiement.

Votre version locale fonctionne comme avant. Sa configuration FTP et son mot de passe ne font pas partie du paquet public.

## Les deux éléments à mettre en ligne

| Élément | Rôle | Emplacement prévu |
|---|---|---|
| Relais de positions | Récupère `pos.txt` et les archives, conserve les traces, sert un flux HTTPS | GitHub Actions + GitHub Pages (gratuit, dépôt public) |
| Plugin Windy | Affiche les bateaux et lit ce flux automatiquement | Serveurs officiels `windy-plugins.com` |

Les visiteurs n’auront pas à lancer un Terminal ni à configurer le FTP. La version publique commence sans anciennes positions embarquées, récupère son premier relevé automatiquement et réessaie toutes les cinq minutes après une coupure. Si elle dispose déjà de données valides, elle les conserve pendant la coupure. Quand le dernier relevé est sélectionné, une actualisation avance les bateaux ; un instant de rejeu ou une heure météo future restent sélectionnés.

## 1. Héberger le flux

La solution gratuite est détaillée dans [GITHUB-GRATUIT.md](GITHUB-GRATUIT.md). Le dossier [deploy](deploy/README.md) reste une alternative sur serveur à installer : relais FTP, stockage persistant et accès HTTPS. Il nécessite un serveur compatible Docker et un domaine qui pointe vers celui-ci. Un hébergement web classique devra être examiné avant de retenir cette méthode.

Le mot de passe FTP sera saisi sur le serveur dans un fichier privé, monté séparément du programme. Il n’est jamais inclus dans l’image, le JavaScript du plugin ou les réponses publiques. Le serveur expose seulement les trois fichiers du flux et une adresse de contrôle ; les fichiers de configuration et les archives internes restent inaccessibles par HTTP.

Avant de construire le plugin public, vérifier que l’adresse HTTPS retenue, suivie de `/live/historique.json`, renvoie les positions réelles et autorise leur lecture depuis Windy. Le dossier de déploiement contient les commandes de contrôle. Aucun domaine d’exemple ne doit être utilisé comme adresse de production.

## 2. Préparer l’identité de publication

Prévoir :

- le compte Windy qui publiera le plugin ;
- le nom d’auteur à afficher ;
- un dépôt GitHub du projet, public ou privé, et le commit correspondant à la version ;
- une clé **Windy Plugins API**, créée depuis [api.windy.com/keys](https://api.windy.com/keys) et saisie dans le Terminal au moment de l’envoi ;
- une véritable capture du plugin dans Windy, à placer dans `src/screenshot.png` ou `src/screenshot.jpg` pour présenter le résultat.

Le nom technique `windy-plugin-rhum-personnel` est conservé. La version publique porte le titre **« Route du Rhum — suivi des bateaux »** et `private: false` dans ses métadonnées Windy. Le `private: true` du fichier `package.json` reste volontairement présent : il évite une publication npm, qui n’est pas la procédure utilisée par Windy.

Ne copiez aucune clé API ni aucun mot de passe dans le dépôt ou dans la conversation.

## 3. Construire le paquet public

La commande suivante est un modèle : remplacer le domaine, le nom d’auteur, le dépôt et le commit par leurs vraies valeurs.

```sh
npm run build:public -- \
  --feed-url "https://VOTRE-DOMAINE/live/historique.json" \
  --author "NOM PUBLIC DE L’AUTEUR" \
  --repository "PROPRIETAIRE/DEPOT" \
  --commit "COMMIT_GIT"
```

La construction utilise un dossier temporaire et conserve les fichiers de votre installation locale. Elle retire l’historique embarqué, remplace le réglage local par l’adresse HTTPS publique et produit :

```text
release/windy-plugin-rhum-personnel-0.9.0.tar
```

Ce TAR contient uniquement `plugin.js`, `plugin.min.js`, `plugin.json` et la capture si elle est présente. Il ne contient ni configuration FTP, ni mot de passe, ni dossier `state`, ni sources de débogage. Le dossier `release/public-plugin/` permet aussi d’inspecter les fichiers générés.

## 4. Vérifier puis envoyer à Windy

La vérification suivante reste hors ligne et ne demande aucune clé :

```sh
npm run publish:check -- --archive release/windy-plugin-rhum-personnel-0.9.0.tar
```

Pour envoyer la version préparée :

```sh
npm run publish:windy -- --archive release/windy-plugin-rhum-personnel-0.9.0.tar
```

L’outil vérifie d’abord le flux public HTTPS et ses autorisations de lecture depuis Windy, puis demande la clé Windy en saisie masquée. La clé est utilisée seulement pour l’envoi à l’API officielle et n’est pas enregistrée. Une archive ou un flux invalide interrompt l’envoi. Le Terminal affiche la réponse du service et les liens effectivement renvoyés par Windy ; il n’invente pas d’adresse d’installation. Une erreur signalée par Windy, même avec un statut HTTP 200, ne sera pas présentée comme une publication réussie.

L’envoi ne garantit pas encore l’apparition dans la galerie. Récupérer le lien de la version publié par Windy, l’installer dans un autre navigateur et vérifier le premier chargement, le rejeu et l’actualisation avant de le partager. Pour une nouvelle publication ultérieure, augmenter le numéro de version.

## 5. Apparition dans la galerie

La [procédure officielle Windy](https://docs.windy-plugins.com/getting-started/publishing-plugin.html) prévoit une publication sur ses serveurs, puis une demande d’examen pour rendre le plugin visible dans la galerie. Le code peut être stocké dans un dépôt GitHub public ou privé. Le [fil de la communauté indiqué par Windy](https://community.windy.com/topic/31066/list-of-finished-windy-plugins-v42) sert à présenter les plugins à examiner.

Préparer pour cette présentation : le lien de la version réellement publiée, une capture de la carte, le nom du plugin, sa fonction de suivi de la flotte et l’adresse du dépôt. Aucun message n’a été envoyé à la communauté dans cette préparation.

## Limites des vérifications locales

Les tests automatisés couvrent le démarrage local et public, le chargement et la reprise du flux, les archives FTP, la séparation du secret, les routes publiques et le paquet de publication. Une compilation publique réelle a été contrôlée dans un projet temporaire puis supprimée ; elle ne constitue pas une mise en ligne.

Docker n’est pas installé dans cet environnement : l’image, le certificat du domaine réel, l’accès au FTP depuis l’hébergement et la réception par Windy devront être vérifiés lors de la mise en ligne.

Validation de cette préparation : **162 tests Node et 40 tests Python réussis** ; compilation locale et compilation publique contrôlées. Aucun domaine réel, compte Windy ou clé API n’a été inventé pour produire une publication.
