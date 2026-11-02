# Route du Rhum pour Windy

Plugin Windy pour afficher la flotte de la Route du Rhum, suivre les traces des bateaux, consulter leurs informations et rejouer les positions dans le temps avec la météo Windy.

Le dépôt public du projet est [PatCodeur/windy-route-du-rhum](https://github.com/PatCodeur/windy-route-du-rhum). Les relevés fournis dans `data/` servent au développement et aux tests. Le relais peut récupérer les nouveaux relevés et les archives FTP, valider les positions et produire un flux public sans identifiants FTP.

## Développement

Prévoir Node.js 22, npm et Python 3. Depuis le dossier du projet :

```sh
npm ci
npm start
```

La commande de développement construit le plugin et sert les fichiers en HTTPS sur le port local 9999. Pour une compilation seule :

```sh
npm run build
```

## Tests

```sh
npm test
npm run test:python
```

## Publication

Le guide [GITHUB-GRATUIT.md](GITHUB-GRATUIT.md) décrit la configuration des secrets GitHub, l’actualisation horaire, la conservation des archives et la publication du flux sur GitHub Pages. Le premier déploiement doit être vérifié avant de partager une adresse de flux.

Le guide [PUBLICATION.md](PUBLICATION.md) décrit ensuite la construction du paquet public et son envoi aux serveurs officiels Windy. L’envoi du plugin et son examen pour la galerie sont des étapes distinctes.

Les configurations privées, mots de passe, clés API et données de travail ne doivent pas être ajoutés au dépôt. Les notices des composants utilisés figurent dans [NOTICE.txt](NOTICE.txt).
