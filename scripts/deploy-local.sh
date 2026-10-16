#!/usr/bin/env bash
# Deploys the images CI built for a commit onto your local minikube cluster.
# Usage: ./scripts/deploy-local.sh            (uses the latest commit on main)
#        ./scripts/deploy-local.sh <commit-sha>
set -euo pipefail
OWNER="${OWNER:-adityasingh-ops}"
SHA="${1:-$(git rev-parse origin/main)}"
echo "Deploying ghcr.io/$OWNER/inventory-*:$SHA"
helm upgrade --install inventory ./helm/inventory -n inventory --create-namespace \
  --set backend.image=ghcr.io/$OWNER/inventory-backend --set backend.tag=$SHA \
  --set frontend.image=ghcr.io/$OWNER/inventory-frontend --set frontend.tag=$SHA \
  --wait --timeout 5m
kubectl get pods -n inventory
