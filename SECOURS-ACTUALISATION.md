# Actualisation horaire : diagnostic et secours

## État de la correction 0.9.1 au 3 novembre 2026

**La reprise automatique est vérifiée.** Le paquet [0.9.1](https://windy-plugins.com/2439056/windy-plugin-rhum-personnel/0.9.1/plugin.min.js) est publié et installé. Le passage horaire naturel du **3 novembre à 12:10 UTC (13:10 à Paris)** a réussi, sans relance manuelle : [exécution 41633492203](https://github.com/PatCodeur/windy-route-du-rhum/actions/runs/41633492203). Le flux récupéré à **12:10:47 UTC** contient le dernier relevé à **12:00:18 UTC**, avec **114 bateaux dans le fichier source**. Le contrôle dans Windy confirme **115 dernières positions connues et 51 relevés**.

## Incidents observés et corrections

### Retard des déclenchements GitHub

Le 3 novembre, une seule exécution programmée GitHub a été observée à **01:36 UTC**, réussie, puis aucune autre jusqu’à 09:00 UTC. Le dernier relevé publié était celui de 01:02:54 UTC.

Le premier test cron-job.org a lancé l’[exécution 41609964985](https://github.com/PatCodeur/windy-route-du-rhum/actions/runs/41609964985), réussie : relevé **09:00:24 UTC**, **115 bateaux et 48 relevés** confirmés dans Windy.

### Rang source non numérique

Le premier passage horaire naturel du secours a eu lieu à **10:10 UTC (11:10 à Paris)**. GitHub a accepté la demande, mais l’[exécution 41617045601](https://github.com/PatCodeur/windy-route-du-rhum/actions/runs/41617045601) a échoué pendant le traitement du relevé.

Le diagnostic de l’[exécution 41620646088](https://github.com/PatCodeur/windy-route-du-rhum/actions/runs/41620646088), lancée à 10:36:14 UTC sur le commit `32285a0cce6399be7d45baf27474013f620de88e`, a confirmé :

```text
Dernier relevé reçu : rows=115; rankZero=0; rankNonNumeric=1; rankOversized=0.
Actualisation refusée (stage=latest-validation; category=rank-invalid).
```

Le FTP répondait avec **115 positions, dont une avec un rang non numérique**. Le contrôle trop strict du rang a conservé le flux précédent. Il ne permet pas d’attribuer un statut sportif au skipper. La version 0.9.1 accepte un rang textuel ou absent comme inconnu, affiché **— / Non communiqué**, tout en conservant la position. Elle ne calcule aucun rang de remplacement et conserve les contrôles des coordonnées, identifiants, heures, vitesses et caps.

Le plugin 0.9.0 refusait aussi un rang inconnu : installer 0.9.1 pour lire le flux corrigé. La liste et la fiche OCEANS n° 98 ont été contrôlées dans Windy : **Non communiqué** et **—**. Voir [PUBLICATION.md](PUBLICATION.md).

### Effectif variable du fichier source

La première relance après activation, [41625463979](https://github.com/PatCodeur/windy-route-du-rhum/actions/runs/41625463979), a encore échoué : le relevé FTP de 11 h contenait **114 bateaux**, alors que le seuil fixe était de 115. Le relais utilise désormais au moins **90 % du dernier effectif source validé**, pour les nouveaux relevés et les archives ; le premier chargement sans historique exige toujours 115 bateaux. Les contrôles de structure, identifiants, coordonnées, heures, vitesses et caps restent actifs.

Le bateau absent reste dans l’historique à sa **dernière position connue**, sans position inventée ni heure rajeunie. Le contrôle dans Windy a confirmé SODEBO ULTIM 3 n° 4 au point du **3 novembre à 09:45:18 UTC**, tandis que le dernier fichier fournit 114 positions de 11 h. Le statut distingue l’effectif du fichier source et la date la plus récente effectivement publiée ; il n’est plus écrasé par la dernière archive importée.

Les erreurs réseau et Git sont réessayées jusqu’à trois fois à vingt secondes d’intervalle, avec restauration de la sauvegarde. Une erreur de validation conserve les positions sans nouvel essai. Les journaux exposent des étapes, catégories et compteurs, sans contenu FTP ni identifiants.

## Configuration du secours

La tâche active **Route du Rhum — actualisation horaire**, n° **8782527**, complète la programmation GitHub à la minute 17. Le workflow sérialise les passages.

| Paramètre | Valeur |
| --- | --- |
| URL | `https://api.github.com/repos/PatCodeur/windy-route-du-rhum/actions/workflows/update-positions.yml/dispatches` |
| Méthode | `POST` |
| Corps | `{"ref":"main"}` |
| Fuseau | `Europe/Paris` |
| Fréquence | Toutes les heures à la minute 10 |

| En-tête | Valeur |
| --- | --- |
| `Accept` | `application/vnd.github+json` |
| `Content-Type` | `application/json` |
| `X-GitHub-Api-Version` | `2026-03-10` |
| `Authorization` | `Bearer ` suivi du jeton, saisi directement par son propriétaire |

Les notifications d’échec et de retour au succès ne sont pas activées. L’alerte de désactivation automatique est conservée. Une réponse HTTP réussie de cron-job.org confirme l’acceptation du déclenchement, pas le succès de la publication GitHub ; ses alertes surveillent cette requête HTTP.

## Jeton et renouvellement

Le propriétaire a créé et saisi lui-même un jeton limité à ce dépôt :

- Propriétaire : `PatCodeur`.
- Accès : **Only select repositories**, uniquement `windy-route-du-rhum`.
- Permissions : **Actions — Read and write**, **Metadata — Read-only**.
- Durée : **90 jours** ; échéance renvoyée le **31 janvier 2027 à 23:00 UTC**, soit le **1er février à 00:00 à Paris**.

Renouveler le jeton et remplacer sa valeur dans cron-job.org **avant le 1er février 2027**. Ne jamais l’ajouter au dépôt ou à une conversation. Les identifiants FTP restent dans les secrets GitHub ; le jeton conservé par cron-job.org sert à demander le lancement du workflow.

## Contrôler une actualisation complète

1. Vérifier dans l’historique cron-job.org l’acceptation de la demande par GitHub.
2. Ouvrir [les exécutions du workflow](https://github.com/PatCodeur/windy-route-du-rhum/actions/workflows/update-positions.yml) : le passage correspondant doit réussir jusqu’à Pages. Le déclenchement externe apparaît comme `workflow_dispatch`.
3. Lire le [statut public](https://patcodeur.github.io/windy-route-du-rhum/live/status.json) : `retrievedAt` doit avancer. `publishedNewest` indique la position la plus récente et n’avance que si le FTP fournit un nouveau relevé.
4. Dans Windy, installer le paquet 0.9.1, choisir **Dernier relevé**, puis vérifier la date UTC, le nombre de bateaux et les traces. Le plugin relit le flux toutes les cinq minutes ; un rejeu volontaire conserve l’instant sélectionné.

Le secours fonctionne ordinateur éteint. Le service gratuit accepte POST, en-têtes et corps personnalisés, mais ne garantit pas la ponctualité de chaque passage. Les tâches GitHub peuvent aussi être retardées ou abandonnées en période de charge. Sources : [déclenchement GitHub](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event), [limites de programmation GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), [FAQ cron-job.org](https://cron-job.org/en/faq/).

## Contrôle du chargement dans un autre onglet

Le 3 novembre à 13:41 à Paris, un autre onglet Windy affichait 0 / 0 et une erreur de chargement malgré le flux public valide. Réappliquer l’URL officielle **0.9.1 dans cet onglet**, attendre la confirmation d’installation puis rouvrir Route du Rhum a rétabli les 115 bateaux et le relevé 12:00:18 UTC. Le numéro de version auparavant chargé n’a pas été relevé ; cette récupération ne démontre pas une panne FTP. Vérifier l’installation dans chaque navigateur utilisé.
