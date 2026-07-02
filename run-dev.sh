#!/bin/bash
cd /home/z/my-project
export NODE_OPTIONS="--max-old-space-size=4096"
while true; do
  echo "[$(date '+%H:%M:%S')] Starting dev server..."
  node node_modules/.bin/next dev -p 3000 2>&1
  EXIT=$?
  echo "[$(date '+%H:%M:%S')] Exited with code $EXIT, restarting in 3s..."
  sleep 3
done
