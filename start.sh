#!/bin/bash
cd /home/z/my-project
export NODE_OPTIONS="--max-old-space-size=4096"
while true; do
  node node_modules/.bin/next dev -p 3000 2>&1
  sleep 2
done
