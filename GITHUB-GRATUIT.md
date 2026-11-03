# Publication gratuite sur GitHub

Le dépôt public est [PatCodeur/windy-route-du-rhum](https://github.com/PatCodeur/windy-route-du-rhum). GitHub Actions récupère les positions FTP et leurs archives ; GitHub Pages publie les positions en HTTPS. L’ordinateur personnel peut rester éteint.

**Le paquet Windy 0.9.1 est publié et vérifié dans Windy.** La [reprise du relais](https://github.com/PatCodeur/windy-route-du-rhum/actions/runs/41626579394) a réussi le 3 novembre : relevé **11:00:18 UTC**, 114 bateaux reçus du FTP, **115 dernières positions connues** et 50 relevés dans Windy. Le bateau absent du dernier fichier reste à son dernier point connu, daté. Voir [SECOURS-ACTUALISATION.md](SECOURS-ACTUALISATION.md).

URL exacte d’installation renvoyée par Windy :

```text
https://windy-plugins.com/2439056/windy-plugin-rhum-personnel/0.9.1/plugin.min.js
```

## Installer ou mettre à jour le plugin

1. Ouvrir [les plugins Windy](https://www.windy.com/plugins).
2. Choisir le chargement depuis une URL, coller l’adresse **0.9.1** ci-dessus et confirmer l’installation.
3. Dans le menu Windy, ouvrir **Route du Rhum**, puis **Dernier relevé**.

[Ouvrir Route du Rhum](https://www.windy.com/plugin/rhum-personnel) permet ensuite de rouvrir le panneau dans ce navigateur. Le lien ne remplace pas l’installation. Installer 0.9.1 pour afficher **Non communiqué** sans perdre la position en cas de rang textuel. [PUBLICATION.md](PUBLICATION.md) décrit le paquet. L’examen pour la galerie reste à demander.

## Configuration déjà effectuée

Le dépôt `PatCodeur/windy-route-du-rhum` existe et est public. Pour reproduire sa configuration, créer dans **Settings → Secrets and variables → Actions** les secrets suivants :

| Nom exact | Valeur à saisir uniquement sur GitHub |
| --- | --- |
| `RHUM_FTP_HOST` | Adresse du serveur FTP |
| `RHUM_FTP_USER` | Utilisateur FTP |
| `RHUM_FTP_PASSWORD` | Mot de passe FTP |

Le port 21, `pos.txt` et `Archives_posreports` sont configurés. Ne pas envoyer `.ftp-config.json`, `.env`, les mots de passe, `state`, `node_modules` ou `dist` au dépôt.

Dans **Settings → Pages → Build and deployment**, la source est **GitHub Actions**. Pour un lancement manuel : **Actions → Actualiser les positions et publier le flux → Run workflow**, sur `main`. Vérifier la réussite du passage et le statut public avant de considérer les positions à jour.

## Adresses publiques

- [Accueil et installation](https://patcodeur.github.io/windy-route-du-rhum/)
- [Positions et traces](https://patcodeur.github.io/windy-route-du-rhum/live/historique.json)
- [Statut du dernier relevé](https://patcodeur.github.io/windy-route-du-rhum/live/status.json)

## Actualisation et conservation des traces

Depuis le 3 novembre, la tâche cron-job.org **8782527** déclenche le workflow à la **minute 10 de chaque heure**, dans le fuseau **Europe/Paris**. Le déclenchement GitHub à la **minute 17** est conservé. Les passages sont sérialisés pour éviter deux publications concurrentes.

Le premier test externe et le lancement horaire naturel de 10:10 UTC ont confirmé le déclenchement. Le traitement a ensuite refusé un rang non numérique, puis un fichier de 114 bateaux. Les deux contrôles ont été corrigés et la relance manuelle a réussi. Le prochain passage horaire naturel après correction reste à observer.

Les alertes d’échec et de retour au succès ne sont pas activées ; seule l’alerte de désactivation automatique de la tâche est conservée. Le jeton GitHub saisi par son propriétaire dans cron-job.org doit être remplacé **avant le 1er février 2027**. Voir [SECOURS-ACTUALISATION.md](SECOURS-ACTUALISATION.md) pour les réglages et les contrôles.

Chaque passage valide `pos.txt`, puis importe jusqu’à 36 archives en quatre minutes ; les autres attendent le passage suivant. Après le premier relevé de 115 bateaux, le seuil de complétude est de 90 % du dernier effectif source validé, pour les nouveaux relevés et les archives. Les identifiants, coordonnées, dates, caps et vitesses restent contrôlés. Un échec conserve les données précédentes ; les erreurs réseau ou Git sont réessayées trois fois à vingt secondes d’intervalle.

La branche publique `race-data` sauvegarde les rapports normalisés et les noms des archives traitées pour reprendre sur une autre machine GitHub. Elle ne contient aucun identifiant FTP. Les visiteurs téléchargent la page d’accueil et trois fichiers de positions. Le plugin relit le flux toutes les cinq minutes et conserve les dernières données valides pendant une coupure. Utiliser **Dernier relevé** pour quitter un rejeu volontaire.

## Gratuité et limites

GitHub Pages est gratuit pour un dépôt public et les tâches Linux standard sont gratuites dans ce cas : aucun serveur payant ni domaine acheté n’est nécessaire. Voir les [limites Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) et la [facturation Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

Les artefacts Pages durent un jour ; `race-data` conserve la sauvegarde. Surveiller les limites de stockage et de bande passante si la fréquentation augmente.

La ponctualité des passages n’est pas garantie : GitHub peut retarder ou abandonner des tâches planifiées en période de charge, et les désactiver après 60 jours sans activité sur un dépôt public. Le déclenchement externe reste également sans garantie contractuelle de ponctualité. Un lancement manuel est disponible. Sources : [programmation GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), [FAQ cron-job.org](https://cron-job.org/en/faq/).
