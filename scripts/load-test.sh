#!/usr/bin/env bash
# Generates traffic so you can watch Grafana graphs and the HPA scale.
# Usage: URL=http://localhost/api/items ./scripts/load-test.sh
URL="${URL:-http://localhost/api/items}"
echo "Hammering $URL for 2 minutes (Ctrl+C to stop)..."
end=$((SECONDS + 120))
while [ $SECONDS -lt $end ]; do
  for i in $(seq 1 20); do curl -s -o /dev/null "$URL" & done
  wait
done
echo "Done"
