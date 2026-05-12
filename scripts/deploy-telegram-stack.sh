#!/usr/bin/env bash
# Полный цикл: Static Site на Render (если нет) + ожидание деплоя + setChatMenuButton в Telegram.
#
# Требуется: .env.render с RENDER_API_KEY=...
# BOT_TOKEN: либо в .env.telegram (предпочтительно), либо скрипт попробует взять из Render
#   env-vars API веб-сервиса API (Render отдаёт значения открытым текстом — не логируйте ответ).
#
# Переменные (опционально):
#   RENDER_OWNER_ID     — workspace id (tea-...); иначе берётся первый owner из API
#   RENDER_API_URL      — публичный URL API для VITE_API_URL; иначе ищется сервис name=finance-miniapp
#   STATIC_SITE_NAME    — по умолчанию finance-miniapp-web
#   WEB_APP_BUTTON_TEXT — подпись кнопки в Telegram, по умолчанию «Финучёт»
#   RENDER_REPO_URL     — git URL репо (по умолчанию github dikij983-hue/finance-miniapp)
#
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v jq >/dev/null 2>&1; then
  echo "Нужен jq: brew install jq"
  exit 1
fi

load_render_key() {
  if [ ! -f .env.render ]; then
    echo "Создайте .env.render (см. .env.render.example) с RENDER_API_KEY="
    exit 1
  fi
  set -a
  # shellcheck disable=SC1091
  . ./.env.render
  set +a
  if [ -z "${RENDER_API_KEY:-}" ]; then
    echo "В .env.render задайте RENDER_API_KEY"
    exit 1
  fi
}

load_bot_token() {
  if [ -f .env.telegram ]; then
    set -a
    # shellcheck disable=SC1091
    . ./.env.telegram
    set +a
  fi
  if [ -n "${BOT_TOKEN:-}" ]; then
    return 0
  fi
  echo "BOT_TOKEN не найден в .env.telegram — пробуем Render API env-vars (см. предупреждение в шапке скрипта)…"
  local api_id
  api_id="$(curl -sS -H "Authorization: Bearer $RENDER_API_KEY" -H "Accept: application/json" \
    "https://api.render.com/v1/services?ownerId=${RENDER_OWNER_ID}&limit=50" |
    jq -r '.[] | select(.service.name=="finance-miniapp" and .service.type=="web_service") | .service.id' | head -1)"
  if [ -z "$api_id" ]; then
    echo "Не найден web_service finance-miniapp. Задайте BOT_TOKEN в .env.telegram"
    exit 1
  fi
  BOT_TOKEN="$(curl -sS -H "Authorization: Bearer $RENDER_API_KEY" -H "Accept: application/json" \
    "https://api.render.com/v1/services/${api_id}/env-vars" |
    jq -r '.[] | select(.envVar.key=="BOT_TOKEN") | .envVar.value' | head -1)"
  if [ -z "${BOT_TOKEN:-}" ]; then
    echo "BOT_TOKEN пуст. Добавьте .env.telegram с BOT_TOKEN=..."
    exit 1
  fi
}

api_get() {
  curl -sS -H "Authorization: Bearer $RENDER_API_KEY" -H "Accept: application/json" "$1"
}

api_post() {
  curl -sS -X POST -H "Authorization: Bearer $RENDER_API_KEY" -H "Accept: application/json" \
    -H "Content-Type: application/json" -d "$2" "$1"
}

RENDER_OWNER_ID="${RENDER_OWNER_ID:-}"
RENDER_API_URL="${RENDER_API_URL:-}"
STATIC_SITE_NAME="${STATIC_SITE_NAME:-finance-miniapp-web}"
WEB_APP_BUTTON_TEXT="${WEB_APP_BUTTON_TEXT:-Финучёт}"
RENDER_REPO_URL="${RENDER_REPO_URL:-https://github.com/dikij983-hue/finance-miniapp}"

load_render_key

if [ -z "$RENDER_OWNER_ID" ]; then
  RENDER_OWNER_ID="$(api_get "https://api.render.com/v1/owners?limit=5" | jq -r '.[0].owner.id')"
fi
echo "ownerId=$RENDER_OWNER_ID"

if [ -z "$RENDER_API_URL" ]; then
  RENDER_API_URL="$(api_get "https://api.render.com/v1/services?ownerId=${RENDER_OWNER_ID}&limit=50" |
    jq -r '.[] | select(.service.name=="finance-miniapp" and .service.type=="web_service") | .service.serviceDetails.url' | head -1)"
fi
if [ -z "$RENDER_API_URL" ] || [ "$RENDER_API_URL" = "null" ]; then
  echo "Не удалось определить RENDER_API_URL. Задайте переменную окружения RENDER_API_URL=https://....onrender.com"
  exit 1
fi
echo "API URL (для Vite)=$RENDER_API_URL"

STATIC_ID="$(api_get "https://api.render.com/v1/services?ownerId=${RENDER_OWNER_ID}&limit=50" |
  jq -r --arg n "$STATIC_SITE_NAME" '.[] | select(.service.name==$n and .service.type=="static_site") | .service.id' | head -1)"

if [ -z "$STATIC_ID" ]; then
  echo "Создаём Static Site $STATIC_SITE_NAME…"
  BODY="$(jq -n \
    --arg owner "$RENDER_OWNER_ID" \
    --arg api "$RENDER_API_URL" \
    --arg name "$STATIC_SITE_NAME" \
    --arg repo "$RENDER_REPO_URL" \
    '{
      type: "static_site",
      name: $name,
      ownerId: $owner,
      repo: $repo,
      branch: "main",
      autoDeploy: "yes",
      serviceDetails: {
        buildCommand: "npm ci && npm run build -w=@finance/web",
        publishPath: "apps/web/dist"
      },
      envVars: [{key: "VITE_API_URL", value: $api}]
    }')"
  resp="$(api_post "https://api.render.com/v1/services" "$BODY")"
  STATIC_ID="$(echo "$resp" | jq -r '.service.id // empty')"
  if [ -z "$STATIC_ID" ] || [ "$STATIC_ID" = "null" ]; then
    echo "Ошибка создания сервиса:"
    echo "$resp" | jq .
    exit 1
  fi
  echo "Создан сервис id=$STATIC_ID"
else
  echo "Static Site уже есть: id=$STATIC_ID"
fi

STATIC_URL="$(api_get "https://api.render.com/v1/services/${STATIC_ID}" | jq -r '.serviceDetails.url // empty')"
echo "Ожидаем деплой…"

for round in $(seq 1 90); do
  st="$(api_get "https://api.render.com/v1/services/${STATIC_ID}/deploys?limit=1" | jq -r '.[0].deploy.status')"
  echo "  deploy status: $st"
  case "$st" in
    live|deactivated) break ;;
    build_failed|update_failed|canceled)
      echo "Деплой провалился."
      api_get "https://api.render.com/v1/services/${STATIC_ID}/deploys?limit=1" | jq .
      exit 1
      ;;
  esac
  sleep 10
done

STATIC_URL="$(api_get "https://api.render.com/v1/services/${STATIC_ID}" | jq -r '.serviceDetails.url // empty')"
echo "Статика: $STATIC_URL"

load_bot_token

tg_resp="$(curl -sS -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setChatMenuButton" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg url "$STATIC_URL" --arg text "$WEB_APP_BUTTON_TEXT" \
    '{menu_button:{type:"web_app", text:$text, web_app:{url:$url}}}')")"

echo "$tg_resp" | jq .
if [ "$(echo "$tg_resp" | jq -r '.ok')" != "true" ]; then
  echo "Если ошибка про домен — в @BotFather добавьте домен статики для Mini App."
  exit 1
fi

echo "Готово. Откройте бота в Telegram и кнопку меню (Финучёт)."
