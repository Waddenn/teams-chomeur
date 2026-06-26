# Teams Keyword Alerts

Extension Chromium Manifest V3 qui surveille les sous-titres Microsoft Teams et declenche une notification quand un mot-cle configure apparait.

## Installation

1. Ouvrir `chrome://extensions` ou `edge://extensions`.
2. Activer le mode developpeur.
3. Cliquer sur `Load unpacked` / `Charger l'extension non empaquetee`.
4. Selectionner ce dossier : `/var/home/tom/Dev/teams-chomeur`.

## Utilisation

- Ouvrir Teams dans Chromium sur `https://teams.cloud.microsoft`.
- L'extension maintient la preference Teams de sous-titres actifs quand elle est disponible.
- Cliquer sur l'icone de l'extension pour modifier les mots-cles.
- Mettre un mot par ligne, par exemple `pause`, `appel`, `exercice`, ou un prenom.
- Cocher une personne detectee pour recevoir une notification quand elle parle.

L'extension notifie quand une nouvelle mention distincte apparait. Les rerenders identiques de Teams sont dedupliques automatiquement.
Les personnes sont detectees depuis la liste visible des participants Teams. Les sous-titres servent a savoir qui parle.
Les reglages sont stockes localement dans le navigateur, sans synchronisation Chrome.

L'extension utilise des selecteurs Teams connus pour lire les sous-titres, puis une detection de secours si Teams change son DOM.

## Debug

Si les notifications ne sortent pas :

- verifier que les notifications du navigateur sont autorisees par le systeme ;
- verifier que l'extension est active sur la page Teams.
