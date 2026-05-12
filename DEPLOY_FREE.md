# Бесплатный деплой (без Railway): Neon + Render + Cloudflare Pages

## Автоматизация на вашей машине (Render API + Telegram)

Если уже есть **`.env.render`** с `RENDER_API_KEY`, можно одним скриптом создать **Static Site** на Render (если ещё нет), дождаться билда и выставить кнопку мини-аппа в боте:

```bash
cd finance-miniapp
./scripts/deploy-telegram-stack.sh
```

Нужны **jq** и **curl**. `BOT_TOKEN` скрипт попробует взять из **`.env.telegram`** (шаблон: [`.env.telegram.example`](.env.telegram.example)), иначе — из **Render API** env-vars веб-сервиса API (Render отдаёт значения открытым текстом — не публикуйте вывод).

Похоже на Railway по идее (Git + переменные + автодеплой), **без оплаты** для личного MVP. Минусы: API на Render **засыпает** после ~15 минут простоя — первый запрос после паузы может идти **30–60 секунд**. Для учёта «когда открыл — подождал» обычно терпимо.

## 1. База — [Neon](https://neon.tech) (бесплатный Postgres)

1. Регистрация (можно через GitHub).
2. **Create project** → скопируйте **Connection string** (режим `psql` / **pooled** — подойдёт для serverless и для Render).
3. Строка вида `postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require` — это значение **`DATABASE_URL`** для API.

Миграции таблиц выполняются **при старте контейнера API** (скрипт в Docker), отдельно ничего гонять не нужно.

## 2. API — [Render](https://render.com) (бесплатный Web Service + Docker)

1. Зарегистрируйтесь на Render.
2. **New +** → **Blueprint** (или **Web Service**).
3. Подключите репозиторий с папкой `finance-miniapp` в **корне** репо (если репо — только этот проект, пути ниже верные; если монорепо — в настройках сервиса укажите **Root Directory** = `finance-miniapp`).
4. Если **Blueprint**: выберите ветку, Render подхватит [`render.yaml`](render.yaml).
5. Если **Web Service вручную**:
   - **Environment**: Docker  
   - **Dockerfile Path**: `Dockerfile.api`  
   - **Docker Context**: `.` (корень репозитория, где лежит `package-lock.json`)
6. В разделе **Environment** добавьте переменные (секреты вводите вручную, не коммитьте в Git):

| Key | Value |
|-----|--------|
| `DATABASE_URL` | строка из Neon |
| `BOT_TOKEN` | токен бота из BotFather |
| `JWT_SECRET` | любая длинная случайная строка **от 16 символов** |

Опционально: `API_BEARER_KEY`, `API_USER_TELEGRAM_ID`, `OPENAI_API_KEY` — как в `.env.example`.

7. Дождитесь деплоя. Скопируйте публичный URL сервиса, например `https://finance-api-xxxx.onrender.com` — это **`VITE_API_URL`** для фронта.

**CORS** в API уже разрешён с любых origin — запросы с Cloudflare Pages к Render пройдут.

## 3. Фронт — [Cloudflare Pages](https://pages.cloudflare.com)

1. **Workers & Pages** → **Create** → **Pages** → подключите **тот же** Git-репозиторий.
2. Настройки сборки:

| Поле | Значение (если корень репо = `finance-miniapp`) |
|------|---------------------------------------------------|
| **Build command** | `npm ci && npm run build -w=@finance/web` |
| **Build output directory** | `apps/web/dist` |

Если в Pages задаётся **Root directory** для монорепо — укажите `finance-miniapp`, тогда output может быть `apps/web/dist` относительно этого root.

3. **Environment variables** (для **Production**):

| Name | Value |
|------|--------|
| `VITE_API_URL` | `https://ваш-сервис.onrender.com` — **без** завершающего `/` |

Не используйте здесь `VITE_API_PREFIX=/api` — это только для нашего Docker с одним Nginx. Для Render + Pages нужен **полный URL API**.

4. Сохраните, дождитесь билда. URL вида `https://xxx.pages.dev` — это URL мини-аппа для **BotFather** (нужен **HTTPS**).

## 4. Telegram

В [@BotFather](https://t.me/BotFather) → ваш бот → **Bot Settings → Menu Button / Mini App** — укажите URL **Cloudflare Pages** (`https://….pages.dev` или свой домен на Cloudflare).

---

## Альтернативы (кратко)

| Сервис | Зачем |
|--------|--------|
| **Supabase** | вместо Neon — тоже бесплатный Postgres + дашборд |
| **Vercel** | вместо Cloudflare Pages — бесплатный хостинг статики, в билде задать `VITE_API_URL` |
| **Fly.io** | часто уже не «просто бесплатно», нужны кредиты — не рекомендую как первый вариант |

Если не хотите три сервиса: можно оставить **только Neon + Render** и собирать фронт локально с `VITE_API_URL=...` и заливать `dist` куда угодно (даже на бесплатный **Netlify Drop** drag-and-drop) — но Git + Pages удобнее для обновлений.
