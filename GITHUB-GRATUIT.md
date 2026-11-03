# Publication gratuite sur GitHub

Le dépôt public est [PatCodeur/windy-route-du-rhum](https://github.com/PatCodeur/windy-route-du-rhum). Le [premier déploiement](https://github.com/PatCodeur/windy-route-du-rhum/actions/runs/41508185794) a réussi le 2 novembre 2026 : 115 bateaux identifiés, six classes et traces des archives. Le flux a été vérifié en HTTPS avec une autorisation CORS `*`, un dernier pointage à 19:00:35 UTC et aucune archive encore en attente à la fin de ce passage. Le programme est prévu pour récupérer le dernier relevé FTP et les archives chaque heure, puis publier uniquement les positions en HTTPS. L’ordinateur personnel peut rester éteint.

La version **0.9.0 du plugin est aussi publiée sur les serveurs officiels Windy**, après un envoi confirmé par HTTP 201. Son URL exacte d’installation, renvoyée par Windy, est :

```text
https://windy-plugins.com/2439056/windy-plugin-rhum-personnel/0.9.0/plugin.min.js
```

Le TAR public est disponible dans la [release v0.9.0](https://github.com/PatCodeur/windy-route-du-rhum/releases/tag/v0.9.0). L’installation et le fonctionnement du plugin ont été vérifiés dans Windy. La demande d’examen pour la galerie Windy n’a pas encore été envoyée.

## Installer le plugin dans Windy

1. Ouvrir [la page des plugins Windy](https://www.windy.com/plugins).
2. Choisir le chargement depuis une URL, y coller l’adresse complète du bundle ci-dessus et confirmer l’installation.
3. Dans le menu Windy, ouvrir **Route du Rhum**.

Une fois le plugin installé dans ce navigateur, utiliser [Ouvrir Route du Rhum](https://www.windy.com/plugin/rhum-personnel) pour le rouvrir. Ce lien ne remplace pas l’installation lors d’une première visite.

## Configuration du dépôt déjà effectuée

Le dépôt **public** `windy-route-du-rhum` existe sous le compte `PatCodeur` et les sources y sont publiées. Pour reproduire la configuration sur un autre dépôt, suivre les étapes ci-dessous. Ne pas envoyer `.ftp-config.json`, les mots de passe, `.env`, `state`, `node_modules` ou les fichiers du dossier `dist` local.

Dans **Settings → Secrets and variables → Actions**, créer ces trois secrets de dépôt :

| Nom exact | Valeur à saisir sur GitHub |
|---|---|
| `RHUM_FTP_HOST` | L’adresse du serveur FTP |
| `RHUM_FTP_USER` | Le nom d’utilisateur FTP |
| `RHUM_FTP_PASSWORD` | Le mot de passe FTP |

Le port 21, le fichier `pos.txt` et le dossier `Archives_posreports` sont déjà configurés. Les identifiants restent dans les secrets GitHub ; ils ne sont pas inclus dans le code ni dans le flux public. Le FTP utilise la même connexion classique que le fournisseur.

Dans **Settings → Pages → Build and deployment**, choisir **GitHub Actions** comme source.

Dans **Actions → Actualiser les positions et publier le flux**, utiliser **Run workflow** sur la branche `main`. Le premier passage doit réussir avant de considérer le flux comme disponible.

## Adresses du flux publié

- Accueil : `https://patcodeur.github.io/windy-route-du-rhum/`
- Positions et traces : `https://patcodeur.github.io/windy-route-du-rhum/live/historique.json`
- Contrôle du dernier relevé : `https://patcodeur.github.io/windy-route-du-rhum/live/status.json`

Ces adresses ont été vérifiées après le premier déploiement : 115 bateaux, dernier pointage du 2 novembre 2026 à 19:00:35 UTC et CORS `*`. Le contrôle dans Windy a aussi confirmé le panneau de 115 bateaux, le filtre Ultim avec huit bateaux, la fiche de Tom Laperche avec coordonnées, rang et moyennes 4 h/24 h, puis le rejeu à 18:00:19 UTC et le retour au dernier pointage à 19:00:35 UTC. Continuer à surveiller le nombre de bateaux et la date UTC des nouveaux relevés.

## Fonctionnement et reprise

Depuis le 3 novembre 2026, une tâche gratuite cron-job.org est programmée à la **minute 10 de chaque heure**, dans le fuseau **Europe/Paris**. La programmation GitHub à la **minute 17** reste conservée comme déclenchement complémentaire. Le test complet depuis cron-job.org a réussi : [exécution GitHub 41609964985](https://github.com/PatCodeur/windy-route-du-rhum/actions/runs/41609964985), dernier relevé publié et affiché dans Windy à **09:00:24 UTC**, **115 bateaux** et **48 relevés**. Un lancement horaire naturel reste à observer ; le prochain affiché lors du contrôle était le **3 novembre à 11:10 à Paris, soit 10:10 UTC**.

Voir [SECOURS-ACTUALISATION.md](SECOURS-ACTUALISATION.md) pour le diagnostic, les réglages et les contrôles. Les alertes d’échec et de retour au succès ne sont pas activées ; seule l’alerte de désactivation automatique reste conservée. Le jeton doit être renouvelé avant le **1er février 2027**.

Ces services ne garantissent pas la ponctualité de chaque passage. GitHub peut retarder ou abandonner des tâches planifiées en période de forte charge. Un déclenchement manuel reste disponible.

Chaque passage valide d’abord `pos.txt`. En cas d’échec, le site précédent est conservé et la tâche apparaît en erreur. Ensuite, il importe jusqu’à 36 archives, avec un budget de quatre minutes pour leur traitement. Les archives restantes sont reprises au passage suivant. Une archive défectueuse n’efface pas les relevés déjà reçus.

La branche `race-data` conserve les rapports normalisés et un manifeste contenant seulement les noms des archives traitées. Elle permet de reprendre après le remplacement de la machine GitHub. Elle est publique comme le dépôt, mais ne contient ni serveur FTP, ni utilisateur FTP, ni mot de passe. Les visiteurs téléchargent seulement trois fichiers de positions et une page d’accueil.

## Gratuité et limites

GitHub Pages est disponible gratuitement pour un dépôt public. Les tâches utilisent un runner Linux standard, gratuit dans ce cas. Aucun domaine acheté ni serveur payant n’est nécessaire. Voir les [conditions GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) et la [facturation GitHub Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

Le site publié est limité à 1 Go et la bande passante à 100 Go par mois comme limite souple. GitHub Free inclut 500 Mo de stockage d’artefacts, partagés avec les autres projets du compte. Les artefacts Pages ne sont conservés qu’un jour ; la sauvegarde durable repose sur `race-data`. Le plugin public demande une revalidation du cache pour réduire les transferts lorsque les positions sont identiques. Surveiller l’usage si le tracker attire beaucoup de visiteurs.

Les tâches planifiées d’un dépôt public peuvent être désactivées après 60 jours sans activité. Voir la [documentation des tâches planifiées](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## Publication du plugin et galerie Windy

Le paquet public 0.9.0 a été envoyé depuis le Terminal et accepté par Windy avec HTTP 201. L’URL officielle figure en tête de ce document. [PUBLICATION.md](PUBLICATION.md) conserve la procédure de construction, les contrôles, la taille et l’empreinte du TAR publié, ainsi que les étapes des prochaines versions. La clé Windy Plugins API a été saisie localement en mode masqué ; elle n’est pas incluse dans le dépôt.

Le flux et le plugin sont publiés et le contrôle dans le navigateur a réussi. Une capture du résultat a été conservée. La demande d’examen pour apparaître dans la galerie Windy reste à envoyer ; aucun message n’a été envoyé au forum Windy.
