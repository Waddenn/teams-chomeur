# Teams Keyword Alerts

Extension Chromium Manifest V3 qui surveille les sous-titres Microsoft Teams et declenche une notification quand un mot-cle configure apparait.

## Installation

1. Ouvrir `chrome://extensions` ou `edge://extensions`.
2. Activer le mode developpeur.
3. Cliquer sur `Load unpacked` / `Charger l'extension non empaquetee`.
4. Selectionner ce dossier : `/var/home/tom/Dev/teams-chomeur`.

## Utilisation

- Ouvrir Teams dans Chromium sur `https://teams.cloud.microsoft`.
- Activer les sous-titres Teams dans la reunion.
- Cliquer sur l'icone de l'extension pour modifier les mots-cles.
- Mettre un mot par ligne, par exemple `pause`, `appel`, `exercice`, ou un prenom.

L'extension notifie quand une nouvelle mention distincte apparait. Les rerenders identiques de Teams sont dedupliques automatiquement.
Les reglages sont stockes localement dans le navigateur, sans synchronisation Chrome.

L'extension utilise des selecteurs Teams connus pour lire les sous-titres et affiche un avertissement dans le popup si aucun sous-titre actif n'est detecte.

## Debug

Si les notifications ne sortent pas :

- verifier que les notifications du navigateur sont autorisees par le systeme ;
- verifier que l'extension est active sur la page Teams ;
- verifier que les sous-titres Teams sont actives ;
- apres un rechargement de l'extension en developpement, recharger aussi l'onglet Teams.
