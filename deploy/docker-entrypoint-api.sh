#!/bin/sh
set -e
if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL is required"
  exit 1
fi
echo "Running migrations..."
node dist/migrate.js
exec node dist/index.js
