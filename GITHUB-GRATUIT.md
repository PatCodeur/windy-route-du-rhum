# Publication gratuite sur GitHub

Le dépôt public est [PatCodeur/windy-route-du-rhum](https://github.com/PatCodeur/windy-route-du-rhum). Le premier déploiement a réussi le 2 novembre 2026 : 115 bateaux identifiés, six classes et traces des archives. Le flux a été vérifié en HTTPS avec une autorisation CORS `*`. Le programme récupère le dernier relevé FTP et les archives chaque heure, puis publie uniquement les positions en HTTPS. L’ordinateur personnel peut rester éteint. Le plugin lui-même est ensuite envoyé aux serveurs officiels Windy.

## Configuration du dépôt

Créer un dépôt **public** nommé `windy-route-du-rhum` sous le compte `PatCodeur`, puis y envoyer les sources préparées. Ne pas envoyer `.ftp-config.json`, les mots de passe, `.env`, `state`, `node_modules` ou les fichiers du dossier `dist` local.

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

Ces adresses ont été vérifiées après le premier déploiement. Contrôler le nombre de bateaux et la date UTC du relevé. Vérifier également que Windy peut lire le flux dans Safari et Chrome : HTTPS et autorisation CORS effective doivent être validés sur le site réel.

## Fonctionnement et reprise

Le passage est prévu à la minute 17 de chaque heure UTC. GitHub peut retarder les tâches planifiées ; ce n’est pas une garantie de publication à la seconde près. Un déclenchement manuel reste disponible.

Chaque passage valide d’abord `pos.txt`. En cas d’échec, le site précédent est conservé et la tâche apparaît en erreur. Ensuite, il importe jusqu’à 36 archives, avec un budget de quatre minutes pour leur traitement. Les archives restantes sont reprises au passage suivant. Une archive défectueuse n’efface pas les relevés déjà reçus.

La branche `race-data` conserve les rapports normalisés et un manifeste contenant seulement les noms des archives traitées. Elle permet de reprendre après le remplacement de la machine GitHub. Elle est publique comme le dépôt, mais ne contient ni serveur FTP, ni utilisateur FTP, ni mot de passe. Les visiteurs téléchargent seulement trois fichiers de positions et une page d’accueil.

## Gratuité et limites

GitHub Pages est disponible gratuitement pour un dépôt public. Les tâches utilisent un runner Linux standard, gratuit dans ce cas. Aucun domaine acheté ni serveur payant n’est nécessaire. Voir les [conditions GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) et la [facturation GitHub Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

Le site publié est limité à 1 Go et la bande passante à 100 Go par mois comme limite souple. GitHub Free inclut 500 Mo de stockage d’artefacts, partagés avec les autres projets du compte. Les artefacts Pages ne sont conservés qu’un jour ; la sauvegarde durable repose sur `race-data`. Le plugin public demande une revalidation du cache pour réduire les transferts lorsque les positions sont identiques. Surveiller l’usage si le tracker attire beaucoup de visiteurs.

Les tâches planifiées d’un dépôt public peuvent être désactivées après 60 jours sans activité. Voir la [documentation des tâches planifiées](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## Envoi du plugin à Windy

Une fois le flux réel vérifié et les sources envoyées sur GitHub, reprendre [PUBLICATION.md](PUBLICATION.md) pour construire la version publique avec le dépôt et le commit réels. La clé Windy Plugins API sera saisie dans le Terminal en mode masqué. Ne jamais la copier dans les sources ou dans la conversation.

La mise en ligne du flux ne signifie pas que le plugin est déjà installé dans la galerie Windy : la publication officielle et l’examen par Windy restent deux étapes séparées.
