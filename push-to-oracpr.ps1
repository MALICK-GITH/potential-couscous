# Script pour pousser tous les fichiers vers https://github.com/MALICK-GITH/oracpr.git

Set-Location $PSScriptRoot

# Ajouter tous les fichiers
git add -A

# Voir le statut
git status

# Créer un commit avec tous les changements
git commit -m "Mise à jour: tous les fichiers du projet"

# Pousser vers le dépôt oracpr
git push -u origin main

Write-Host "Terminé! Les fichiers ont été poussés vers https://github.com/MALICK-GITH/oracpr.git"
