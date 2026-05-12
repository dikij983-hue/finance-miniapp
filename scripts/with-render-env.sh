#!/usr/bin/env sh
# Запуск любой команды с подхваченным RENDER_API_KEY из ../.env.render
# Пример: ./scripts/with-render-env.sh render services list
cd "$(dirname "$0")/.." || exit 1
if [ ! -f .env.render ]; then
  echo "Нет файла .env.render — скопируйте: cp .env.render.example .env.render и вставьте ключ."
  exit 1
fi
set -a
# shellcheck disable=SC1091
. ./.env.render
set +a
if [ -z "$RENDER_API_KEY" ]; then
  echo "В .env.render задайте RENDER_API_KEY=ваш_ключ"
  exit 1
fi
exec "$@"
