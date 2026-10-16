#!/usr/bin/env bash
# Generates load from INSIDE the cluster so the HPA scales the backend.
# Watch it in another terminal:  kubectl get hpa -n inventory -w
# Usage: ./scripts/load-test.sh            (runs 3 minutes)
#        DURATION=300 ./scripts/load-test.sh
set -euo pipefail
DURATION="${DURATION:-180}"
kubectl create deployment load-generator -n inventory --image=busybox:1.36 --replicas=1 -- \
  sh -c 'while true; do wget -q -O /dev/null http://backend:3000/api/items; done'
echo "Load running for ${DURATION}s..."
sleep "$DURATION"
kubectl delete deployment load-generator -n inventory
echo "Load stopped. The HPA scales back down after ~5 minutes."
