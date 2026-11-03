# Actualisation horaire : diagnostic et secours

Le 3 novembre 2026, une seule actualisation programmée GitHub a été observée à 01:36 UTC, puis aucune autre jusqu’à 09:00 UTC. Cette exécution avait réussi ; le dernier relevé publié restait celui de 01:02:54 UTC.

Une relance manuelle à 09:01:51 UTC a rétabli le service : [exécution GitHub 41607710682](https://github.com/PatCodeur/windy-route-du-rhum/actions/runs/41607710682), réussie. Le flux récupéré à 09:02:22 UTC contenait 115 bateaux et des positions allant jusqu’à 08:00:29 UTC.

## État du secours au 3 novembre 2026

La tâche cron-job.org **Route du Rhum — actualisation horaire**, numéro **8782527**, est enregistrée et active. Elle est programmée toutes les heures à la **minute 10**, dans le fuseau **Europe/Paris**. Le premier lancement horaire naturel a eu lieu le **3 novembre à 11:10 à Paris, soit 10:10 UTC**. La programmation GitHub à la minute 17 est conservée comme déclenchement complémentaire ; les exécutions sont sérialisées par le workflow.

Le test lancé dans cron-job.org à **09:18:33 UTC** a reçu **HTTP 200** en 1,64 seconde. Il a déclenché l’[exécution GitHub 41609964985](https://github.com/PatCodeur/windy-route-du-rhum/actions/runs/41609964985), qui a réussi jusqu’à la publication du site et s’est terminée à **09:19:14 UTC**. Le [statut public](https://patcodeur.github.io/windy-route-du-rhum/live/status.json) indiquait ensuite une récupération à **09:18:50.170 UTC**, un dernier relevé à **09:00:24 UTC** et **115 bateaux**. Le contrôle dans Windy a confirmé ce relevé, les **48 relevés disponibles** et **115 bateaux sur 115**.

### Échec de validation constaté après le test initial

Le premier lancement horaire naturel, le **3 novembre à 10:10 UTC (11:10 à Paris)**, a bien été accepté par GitHub depuis cron-job.org. L’[exécution GitHub 41617045601](https://github.com/PatCodeur/windy-route-du-rhum/actions/runs/41617045601) a ensuite échoué dans le traitement du relevé. Le déclenchement automatique fonctionne ; une réponse HTTP réussie ne garantit pas que la publication des positions réussisse.

Les journaux ajoutés au programme ont permis d’identifier le refus lors de l’[exécution 41620646088](https://github.com/PatCodeur/windy-route-du-rhum/actions/runs/41620646088), lancée à **10:36:14 UTC** sur le commit `32285a0cce6399be7d45baf27474013f620de88e` :

```text
Dernier relevé reçu : rows=115; rankZero=0; rankNonNumeric=1; rankOversized=0.
Actualisation refusée (stage=latest-validation; category=rank-invalid).
```

Le fichier FTP a donc été récupéré et contient **115 lignes de positions**, dont **une avec un rang non numérique**. Ce contrôle ne permet pas d’attribuer un statut sportif au skipper concerné. Le programme exigeant alors un rang entier positif, il a conservé le flux précédent, dont les dernières positions restent au **3 novembre à 09:00:24 UTC**. Les coordonnées ne doivent pas être supprimées à cause d’un rang non communiqué.

**La nouvelle mise à jour n’est pas encore rétablie.** Un correctif **0.9.1** est en préparation sur la branche prévue `release/rang-non-communique-0.9.1`. Il doit conserver la position et représenter un rang source textuel ou absent par un rang inconnu, affiché **— / Non communiqué**, sans inventer de classement. Les coordonnées, identifiants, heures, caps et vitesses restent contrôlés.

Le plugin Windy **0.9.0 refuse aussi un rang inconnu dans le flux JSON**. Il faut donc publier puis vérifier **0.9.1 dans Windy avant d’activer le nouveau format dans le flux de production**. Aucun envoi de 0.9.1 à Windy n’est confirmé à ce stade ; `main` conserve le parseur précédent avec ses diagnostics. Voir [PUBLICATION.md](PUBLICATION.md) pour l’ordre de publication.

Les erreurs réseau transitoires et les erreurs Git sont désormais réessayées jusqu’à trois fois, à vingt secondes d’intervalle, avec une nouvelle restauration de la sauvegarde à chaque essai. Les erreurs de validation ne sont pas réessayées automatiquement et les positions déjà publiées sont conservées. Les journaux exposent seulement des étapes, des catégories et des compteurs, sans texte reçu du FTP ni identifiants de connexion.

Les notifications d’échec et de retour au succès ne sont pas activées. L’alerte par défaut en cas de désactivation automatique de la tâche est conservée.

## Jeton GitHub et renouvellement

Le propriétaire a créé puis saisi lui-même un jeton GitHub limité à ce dépôt dans le champ d’autorisation de cron-job.org. Les réglages demandés sont :

- Propriétaire : `PatCodeur`.
- Accès aux dépôts : **Only select repositories**, puis seulement `windy-route-du-rhum`.
- Permissions du dépôt : **Actions — Read and write** ; **Metadata — Read-only**.
- Durée : **90 jours**. L’échéance renvoyée est le **31 janvier 2027 à 23:00 UTC**, soit le **1er février à 00:00 à Paris**. Renouveler le jeton et remplacer sa valeur dans cron-job.org **avant le 1er février 2027**.

Ne jamais placer le jeton dans ce dépôt ni dans une conversation. Les identifiants FTP restent dans les secrets GitHub Actions ; cron-job.org utilise le jeton seulement pour demander le lancement du workflow.

## Configuration enregistrée

| Paramètre | Valeur |
| --- | --- |
| Nom | Route du Rhum — actualisation horaire |
| Numéro de tâche | `8782527` |
| URL | `https://api.github.com/repos/PatCodeur/windy-route-du-rhum/actions/workflows/update-positions.yml/dispatches` |
| Méthode | `POST` |
| Fuseau horaire | `Europe/Paris` |
| Programmation | Toutes les heures, à la **minute 10** |
| Corps de la requête | `{"ref":"main"}` |

En-têtes :

| Nom | Valeur |
| --- | --- |
| `Accept` | `application/vnd.github+json` |
| `Content-Type` | `application/json` |
| `X-GitHub-Api-Version` | `2026-03-10` |
| `Authorization` | `Bearer ` suivi du jeton, saisi directement par son propriétaire |

## Contrôles à conserver

1. Consulter l’historique cron-job.org : la requête de déclenchement doit être acceptée par GitHub.
2. Ouvrir [les exécutions du workflow](https://github.com/PatCodeur/windy-route-du-rhum/actions/workflows/update-positions.yml) : le lancement correspondant doit réussir jusqu’à la publication Pages. Un déclenchement externe apparaît comme `workflow_dispatch`.
3. Vérifier le [statut public](https://patcodeur.github.io/windy-route-du-rhum/live/status.json) : `retrievedAt` doit avancer ; `publishedNewest` indique l’heure de la position la plus récente. Cette dernière n’avance que si le serveur source fournit de nouvelles observations.
4. Vérifier dans Windy le dernier relevé et le nombre de bateaux. Le plugin relit le flux public toutes les cinq minutes ; utiliser **Dernier relevé** pour quitter un rejeu volontaire d’anciennes positions.

Une réponse HTTP réussie de cron-job.org confirme l’acceptation du déclenchement ; elle ne prouve pas à elle seule la réussite de l’actualisation GitHub. Les éventuelles notifications d’échec du service surveillent cette requête HTTP. Le contrôle du statut public vérifie la fraîcheur réelle du flux.

Ce service fonctionne même lorsque l’ordinateur personnel est éteint. Il est gratuit et permet les requêtes POST avec en-têtes et corps personnalisés ; il ne garantit pas contractuellement la ponctualité de chaque lancement. Les tâches planifiées GitHub peuvent aussi être retardées ou abandonnées en période de forte charge.

Sources : [documentation GitHub du déclenchement d’un workflow](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event), [limites des tâches planifiées GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), [fonctions et limites de cron-job.org](https://cron-job.org/en/faq/).
