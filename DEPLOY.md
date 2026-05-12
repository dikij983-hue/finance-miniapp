# Деплой MVP (HTTPS обязателен для Telegram Mini App)

**Бесплатно без своего сервера (Neon + Render + Cloudflare Pages):** см. [DEPLOY_FREE.md](DEPLOY_FREE.md).

## Docker (свой сервер или VPS)

1. На сервере установите [Docker](https://docs.docker.com/engine/install/) и Docker Compose plugin.
2. Склонируйте/скопируйте папку `finance-miniapp`, перейдите в неё.
3. `cp docker-compose.env.example .env` и отредактируйте `BOT_TOKEN`, `JWT_SECRET`, `POSTGRES_PASSWORD`.
4. Запуск: `docker compose up -d --build`
5. Откройте в браузере `http://ВАШ_IP:8080` (или порт из `HTTP_PORT`). Мини-апп в Telegram требует **HTTPS** — поставьте перед контейнером [Caddy](https://caddyserver.com/) или Nginx с Let’s Encrypt и проксируйте на `127.0.0.1:8080`.

Фронт ходит на API по пути **`/api/`** (один домен). В BotFather укажите URL **HTTPS** до корня сайта (например `https://finance.example.com`).

Подробности без Docker — см. разделы ниже.

---

## 1. База данных

Создайте базу PostgreSQL (Neon, Supabase, Railway и т.д.), скопируйте `DATABASE_URL`.

## 2. API (Node)

1. Скопируйте [.env.example](.env.example) в `apps/api/.env` и заполните `DATABASE_URL`, `BOT_TOKEN`, `JWT_SECRET` (≥16 символов).
2. Локально: `npm run db:migrate -w=@finance/api` из корня репозитория.
3. Сборка: `npm run build -w=@finance/api`.
4. Запуск: `node apps/api/dist/index.js` (задайте `PORT`, по умолчанию 3000).
5. На продакшене разместите процесс за HTTPS (Railway, Fly.io, Render, VPS + Caddy). Запомните публичный URL API, например `https://api.example.com`.

### Внешний API и агент (опционально)

В том же `.env` задайте `API_BEARER_KEY`, `API_USER_TELEGRAM_ID` (числовой id Telegram — тот же пользователь, что заходит в мини-апп), при необходимости `OPENAI_API_KEY`.

- `GET /ext/summary?from=ISO&to=ISO` — агрегаты в отчётной валюте пользователя.
- `GET /ext/transactions?from=&to=`
- `POST /ext/agent/insights` — JSON `{ "from"?, "to"? }`, ответ с полями `bullets`, `warnings`.

## 3. Фронт (статика)

1. `apps/web/.env.production`: `VITE_API_URL=https://api.example.com` (без завершающего слэша).
2. `npm run build -w=@finance/web`.
3. Выложите содержимое `apps/web/dist` на любой HTTPS-хостинг статики (Cloudflare Pages, Netlify, S3+CloudFront). URL фронта, например `https://finance.example.com`.

## 4. Telegram

1. [@BotFather](https://t.me/BotFather): `/newbot`, получите `BOT_TOKEN`.
2. BotFather → ваш бот → **Bot Settings** → **Menu Button** / **Configure Mini App** — укажите HTTPS URL фронта (`https://finance.example.com`).
3. В настройках мини-аппа укажите домен фронта в списке разрешённых (BotFather подскажет при первой публикации).

## 5. Проверка

Откройте бота в Telegram → кнопка меню / мини-апп. После входа должны подтянуться счета (пустой список — создайте первый счёт в UI).

Локальная разработка без HTTPS: используйте туннель (ngrok, cloudflared) для фронта и при необходимости для API, зарегистрируйте выданный HTTPS-домен в BotFather.
