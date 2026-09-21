# files/uploads — les images validees des joueurs

Une image proposee par un joueur arrive dans la file de relecture avec son
**adresse**. Elle n est pas posable tant que le relecteur n a pas depose le
fichier **ici**, et renseigne son nom au moment de valider.

Pourquoi ce detour plutot que d afficher l adresse directement : le remplacement
de texture passe par `AddReplaceTexture`, dont la source doit etre une texture
d execution. La seule qu on sache construire sans surface DUI vient d un fichier
livre par la ressource — et une surface DUI, c est une page de navigateur rendue
a chaque image pour une texture qui ne bouge jamais.

Le detour a deux effets secondaires, et tous deux vont dans le bon sens :

- **plus aucune requete sortante depuis les clients.** Une adresse posee sur un
  mur etait chargee par le navigateur de chaque visiteur, ce qui donnait son
  adresse IP a l hebergeur — le bug du mugshot, section 6 de `docs/SECURITE.md` ;
- **la validation porte sur ce qui sera reellement affiche.** Une adresse peut
  changer de contenu apres avoir ete validee ; un fichier depose ici, non.

Format : `.webp` uniquement. Nom court, sans chemin ni accent.

Le manifeste ne livre que ce format : un `.png` ou un `.jpg` depose ici ne serait
pas servi au client, et l image validee resterait invisible sans la moindre
erreur. Convertissez avant de deposer.

`placeholder.webp` ne sert a rien d autre qu a garder ce dossier non vide : sans
un fichier au moins, le motif du manifeste ne correspond a rien et la ressource
se plaint au demarrage. Ne pas le supprimer.
