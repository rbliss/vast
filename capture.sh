#!/bin/bash
# Automated benchmark screenshot capture.
# Usage: ./capture.sh [label]
#
# Navigates Chrome to the benchmark page with ?capture=label,
# which auto-triggers __benchmarkCapture() after the terrain loads.
# Screenshots are saved to verification/ with the given label.
#
# The page auto-captures all 4 benchmark camera views:
#   reference-wide, reference-oblique, reference-escarpment, reference-piedmont

LABEL="${1:-snapshot}"
URL="https://beyond-all-reason:8080/?capture=${LABEL}"

echo "[capture] Label: $LABEL"
echo "[capture] Navigate Chrome to: $URL"
echo "[capture] The page will auto-capture after terrain loads (~30-45s)"
echo ""
echo "[capture] Waiting for captures to appear..."

# Wait for the capture files to show up
EXPECTED=4
TIMEOUT=120
ELAPSED=0

while [ $ELAPSED -lt $TIMEOUT ]; do
  COUNT=$(ls verification/*${LABEL}*.png 2>/dev/null | wc -l)
  if [ "$COUNT" -ge "$EXPECTED" ]; then
    echo "[capture] All $COUNT captures complete!"
    echo ""
    ls -lt verification/*${LABEL}*.png
    exit 0
  fi
  sleep 3
  ELAPSED=$((ELAPSED + 3))
  if [ $((ELAPSED % 15)) -eq 0 ]; then
    echo "[capture] ... $COUNT/$EXPECTED captured (${ELAPSED}s elapsed)"
  fi
done

echo "[capture] Timeout after ${TIMEOUT}s. Got $COUNT/$EXPECTED captures."
ls -lt verification/*${LABEL}*.png 2>/dev/null
