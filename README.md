# CMS Analytics Studio

Instagram and YouTube analytics in one dashboard, plus keyword auto-replies for Instagram.

- **Frontend:** React 19 + Vite + TypeScript (`src/`)
- **Backend:** Express (`server/`), PostgreSQL, node-cron jobs
- **Data:** Instagram API (Instagram Login), YouTube Data + Analytics APIs

📘 **New users:** see the [User Guide](docs/user-guide/README.md) for how to use the app.

Public pages (served from `public/`, live after deploy):
- **Landing page:** `/` (`welcome/index.html`, motion in `src/welcome/`; images in `public/welcome/img/`; `/welcome/` redirects here)
- **User manual:** `/manual/` (`public/manual/index.html`, built from the guide with `node scripts/build-user-manual-html.cjs`; needs pandoc)

## Run locally

```bash
cp .env.example .env     # then fill it in
npm install
npm run dev              # Vite on :5173, API on :5001
```

| Command | What it does |
|---|---|
| `npm run dev` | Frontend and backend together |
| `npm run build` | Type-check and build the frontend into `dist/` |
| `npm start` | Run the server (also serves `dist/`) |
| `npm test` | Unit tests (Vitest) |
| `npm run lint` | ESLint |
| `npm run webhook:simulate -- --account <igId> --type comment --text link` | Send a correctly signed fake Instagram webhook to your local server |

## Scripts workspace (ScriptVault)

The **Scripts** tab is the ScriptVault app inside CMS. It has:
- **folders** (one level) to group scripts by project, for example one folder per movie. Folders sit in a row at the top of the library; scripts in no folder show right below in the normal Board/List views
- a script library with search, status and category filters, and bulk delete
- an editor
- goals that count the scripts linked to them
- to-dos
- a dashboard with a week/month calendar
- Excel import/export

Everything is stored per user in Postgres (`script_*` tables in `server/schema.sql`). The API is in `server/routes/scripts.js`.

**AI assistant:** each user adds their own Gemini, Claude, Groq or OpenRouter key in **Scripts → Settings → AI providers**.
- A key is tested before it is saved, then stored encrypted with `SCRIPTS_SECRET_KEY` and never sent back to the browser.
- AI calls go from the server, limited to 30 per user every 10 minutes.
- Content niches set the audience and language, and drive the daily trend idea.
- The prompts are in `server/services/scripts/aiPrompts.js`.

There are no file attachments or voice notes, so nothing is stored in cloud storage.

## Instagram auto-replies ("comment or DM `link`, get the URL")

Open **Auto-replies** from the profile menu. Rules (keywords, message, link) are managed there.

How it works: Instagram sends comments and messages to `POST /api/webhooks/instagram`. The server checks Meta's signature, finds the first matching rule, and replies with the link: a **private reply** for comments (one per comment, within 7 days) or a **direct message** for DMs (within 24 hours). Every attempt, including Instagram's error code on failure, is shown in the Activity log.

### Different rules for different reels and posts

Each rule applies to **Everything**, **All reels**, **All posts**, or **One specific reel or post** (chosen from a thumbnail picker). The most specific rule wins, so a rule for one reel overrides the all-reels rule, which overrides the general one. Reel and post rules answer comments only, because a direct message can't be tied to a post. On the Instagram **Content** tab, every post has a *Set up auto-reply* link that opens the form already pointed at it.

### One-time setup

1. Set `INSTAGRAM_APP_SECRET` (Meta → Instagram → API setup with Instagram login → *Instagram app secret*; this is what signs the webhooks), `META_APP_SECRET` and `WEBHOOK_VERIFY_TOKEN` on the server (see `.env.example`). A `403 signature does not match` in the logs means the wrong secret.
2. In **Meta for Developers → your app → Instagram → API setup with Instagram login → Configure webhooks**:
   - Callback URL: `https://<your-server>/api/webhooks/instagram` (the Auto-replies page shows the exact address)
   - Verify token: the same value as `WEBHOOK_VERIFY_TOKEN`
   - Turn on the **comments** and **messages** fields.
3. On the Auto-replies page press **Subscribe** for each Instagram account.
4. The token must include `instagram_business_manage_messages` and `instagram_business_manage_comments`.

### Test safely first

```bash
AUTOMATION_DRY_RUN=true npm run dev
npm run webhook:simulate -- --account <your Instagram account id> --type comment --text "link please"
```

Dry-run records the message that *would* be sent (see the Activity log) and sends nothing.

To receive real webhooks on your laptop, expose it with a tunnel (`cloudflared tunnel --url http://localhost:5001`) and use a separate Meta test app, since one app has a single callback URL.

### Google Cloud Run

The webhook handler replies *before* answering Meta, because Cloud Run throttles CPU after a response. The built-in cron jobs (nightly sync, stories every 6 hours) also need the process to stay alive, so deploy with:

```bash
gcloud run deploy cms \
  --source . --region europe-west1 \
  --min-instances=1 --no-cpu-throttling \
  --set-env-vars=NODE_ENV=production \
  --set-secrets=META_APP_SECRET=META_APP_SECRET:latest,WEBHOOK_VERIFY_TOKEN=WEBHOOK_VERIFY_TOKEN:latest,JWT_SECRET=JWT_SECRET:latest,PGPASSWORD=PGPASSWORD:latest
```

Set the remaining variables (`PGHOST`, `PGUSER`, ...) the same way. Cloud Run gives you an `https://` address; Meta requires HTTPS.

Notes: Meta only delivers events for ordinary users once your app is **Live**; in Development mode only people with a role on the app trigger webhooks. Instagram tokens expire after about 60 days, and the Auto-replies setup check shows the error when that happens.
