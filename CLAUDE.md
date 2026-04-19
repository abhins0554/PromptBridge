# PromptBridge — Claude Code Reference

## Project identity
- **Name**: PromptBridge (package name: `promptbridge`)
- **Version**: 2.0.0
- **Entry point**: `bot.js`
- **Start**: `npm start` · **Dev (watch)**: `npm run dev`

## Architecture overview

```
bot.js                        Entry point — wires platforms + dashboard
core/
  context.js                  BotContext abstract interface
  dispatcher.js               All business logic (platform-agnostic)
platforms/
  telegram/
    index.js                  Telegraf bot setup + allowlist middleware
    context.js                TelegramContext / TelegramCallbackContext
    attachments.js            Telegram file download helpers
  discord/
    index.js                  Discord client setup + slash commands
    context.js                DiscordContext / DiscordInteractionContext
    attachments.js            Discord attachment download helpers
  slack/
    index.js                  Slack Bolt Socket Mode app setup
    context.js                SlackContext
    attachments.js            Slack attachment download helpers
  teams/
    index.js                  Teams Bot Framework adapter setup + message processing
    context.js                TeamsContext — adaptive cards + activity handling
    attachments.js            Teams attachment download helpers
  github/
    index.js                  GitHub webhook listener (optional) — parses comments, routes commands
    polling.js                GitHub polling agent — polls allowed repos for /claude /cursor commands
    context.js                GitHubContext — posts responses as issue/PR comments
    attachments.js            GitHub attachment utilities (stub)
  email/
    index.js                  EmailContext (buffers msgs → sends one email)
    inbound.js                IMAP listener — IDLE loop, retry backoff, attachment saving
lib/
  config.js                   Config loader: .env (bootstrap) + data/settings.json (runtime)
  runner.js                   Spawns claude / cursor-agent CLI processes
  store.js                    JSON persistence for projects + sessions
  changes.js                  Git diff / mtime artifact detection
  format.js                   Markdown→HTML, chunking, escape helpers
  models.js                   Model presets (Claude / Cursor)
  server.js                   Express dashboard + REST API
  logger.js                   Leveled logger
public/index.html             Single-file dashboard SPA
data/
  projects.json               Configured projects
  sessions.json               Per-chat session state
  settings.json               Dashboard-configured runtime settings (SMTP, agent paths…)
  scratch/                    Default freeform Q&A working directory
```

## Key patterns

### Platform contract (`core/context.js`)
Every platform wraps its native event and implements `BotContext`:
- `sendMarkdown(md)` → returns messageId
- `sendText(text)` → returns messageId
- `editMessage(messageId, md)` → updates a sent message
- `showTyping()` → fire-and-forget indicator
- `sendFile(filePath, caption)` → upload from disk
- `sendWithButtons(md, buttonRows)` → md + `[[{label, id}]]`
- `acknowledgeAction(text?)` → for button callbacks
- `updateButtonMessage(md, buttonRows)` → edit button message in-place

### Dispatcher (`core/dispatcher.js`)
- **Never imports Telegram or Email modules** — only calls BotContext methods
- All business logic lives here: `executeRun`, progress tracker, command handlers, model/project menus
- Exports: `handleCommand`, `handleText`, `handleFiles`, `handleCallbackAction`, `runOnce`, `getAttachmentCwd`, `getInflight`, `COMMANDS`
- `runOnce(ctx, {projectId, prompt, agent})` — fresh run with no session state (used by email/dashboard triggers)

### Config system (`lib/config.js`)
- `.env` → bootstrap only (PORT, DASHBOARD_TOKEN, LOG_LEVEL)
- `data/settings.json` → all runtime config (Telegram/Discord/Slack/Teams/GitHub tokens + allowlists, agent paths, SMTP, timeouts, freeformCwd)
- Telegram token/allowlist: `settings.json` takes precedence; `.env` BOT_TOKEN/ALLOWED_USERS still work as legacy fallback
- Discord token/allowlist: `settings.json` takes precedence; `.env` DISCORD_BOT_TOKEN / DISCORD_ALLOWED_USERS / DISCORD_ALLOWED_USER_IDS still work as legacy fallback
- Slack token/allowlist: `settings.json` takes precedence; `.env` SLACK_BOT_TOKEN / SLACK_APP_TOKEN / SLACK_ALLOWED_USERS / SLACK_ALLOWED_USER_IDS still work as legacy fallback
- Teams token/allowlist: `settings.json` takes precedence; `.env` TEAMS_APP_ID / TEAMS_APP_PASSWORD / TEAMS_ALLOWED_USERS / TEAMS_ALLOWED_USER_IDS still work as legacy fallback
- GitHub token/allowlist/repos: `settings.json` takes precedence; `.env` GITHUB_TOKEN / GITHUB_WEBHOOK_SECRET / GITHUB_ALLOWED_REPOS / GITHUB_ALLOWED_USERS / GITHUB_ALLOWED_USER_IDS still work as legacy fallback
- Settings edited via dashboard → `PUT /api/settings` → `saveSettings()` + `reloadConfig()` + auto-restart Telegram/Discord/Slack/Teams clients if bot settings changed
- GitHub polling: every 120s checks allowed repos for `/claude` or `/cursor` commands in issue/PR comments; no webhook setup needed, uses only PAT token
- `config.get()` has a 3-second TTL so changes propagate automatically
- `runner.js` calls `require('./config').get()` fresh inside each `runClaude`/`runCursor` call

### Email platform (`platforms/email/`)
- `EmailContext` buffers all `sendMarkdown`/`sendText`/`sendFile` calls in memory
- `editMessage` updates the buffer slot in-place (so only final state is emailed)
- After the run: caller calls `ctx.flush(subject)` to send one consolidated email
- Buttons are silently dropped (email has no interactive elements)
- Dashboard trigger: `POST /api/run/email` in `lib/server.js`
- Inbound IMAP: `inbound.js` — IDLE loop, `exists` event, exponential backoff reconnect
  - Trigger format in email body: `hi /claude <prompt>` or `hi /cursor <prompt>`
  - Email attachments saved to `freeformCwd/.bot-inbox/` then passed to Claude via enriched prompt (identical structure to `handleFiles` in dispatcher)
  - Inline images (`att.related === true`) skipped; 25 MB per-attachment size limit

### Adding a new platform
1. Create `platforms/<name>/context.js` implementing `BotContext`
2. Create `platforms/<name>/index.js` to wire your platform's SDK
3. Call `handleCommand / handleText / handleFiles / handleCallbackAction` from `core/dispatcher`
4. No changes needed to `core/` or `lib/`

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | Health + version (public) |
| GET | `/api/projects` | List projects |
| POST | `/api/projects` | Create project |
| PUT | `/api/projects/:id` | Update project |
| DELETE | `/api/projects/:id` | Delete project |
| GET | `/api/models` | Claude + Cursor model presets |
| GET | `/api/sessions` | All chat sessions |
| DELETE | `/api/sessions/:chatId/:projectId` | Clear a session |
| GET | `/api/settings` | Runtime settings (SMTP pass masked) |
| PUT | `/api/settings` | Update runtime settings |
| POST | `/api/settings/email/test` | Test SMTP connection |
| POST | `/api/settings/imap/test` | Test IMAP connection |
| POST | `/api/run/email` | Trigger agent run + email result |

## Data files

| File | Managed by | Notes |
|------|-----------|-------|
| `data/projects.json` | `lib/store.js` | Auto-created |
| `data/sessions.json` | `lib/store.js` | Auto-created |
| `data/settings.json` | `lib/config.js` + dashboard | Created on first save |

## Environment variables (bootstrap only)

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `PORT` | No | 3000 | Dashboard HTTP port |
| `DASHBOARD_TOKEN` | No | — | API auth bearer token |
| `LOG_LEVEL` | No | info | debug/info/warn/error |
| `BOT_TOKEN` | No | — | Legacy fallback — set in dashboard instead |
| `ALLOWED_USERS` | No | — | Legacy fallback — set in dashboard instead |
| `ALLOWED_USER_IDS` | No | — | Legacy fallback — set in dashboard instead |
| `DISCORD_BOT_TOKEN` | No | — | Legacy fallback — set in dashboard instead |
| `DISCORD_ALLOWED_USERS` | No | — | Legacy fallback — set in dashboard instead |
| `DISCORD_ALLOWED_USER_IDS` | No | — | Legacy fallback — set in dashboard instead |
| `SLACK_BOT_TOKEN` | No | — | Legacy fallback — set in dashboard instead |
| `SLACK_APP_TOKEN` | No | — | Legacy fallback — set in dashboard instead |
| `SLACK_ALLOWED_USERS` | No | — | Legacy fallback — set in dashboard instead |
| `SLACK_ALLOWED_USER_IDS` | No | — | Legacy fallback — set in dashboard instead |
| `TEAMS_APP_ID` | No | — | Legacy fallback — set in dashboard instead |
| `TEAMS_APP_PASSWORD` | No | — | Legacy fallback — set in dashboard instead |
| `TEAMS_ALLOWED_USERS` | No | — | Legacy fallback — set in dashboard instead |
| `TEAMS_ALLOWED_USER_IDS` | No | — | Legacy fallback — set in dashboard instead |
| `GITHUB_TOKEN` | No | — | Legacy fallback — set in dashboard instead |
| `GITHUB_WEBHOOK_SECRET` | No | — | Legacy fallback — set in dashboard instead |
| `GITHUB_ALLOWED_REPOS` | No | — | Legacy fallback — set in dashboard instead |
| `GITHUB_ALLOWED_USERS` | No | — | Legacy fallback — set in dashboard instead |
| `GITHUB_ALLOWED_USER_IDS` | No | — | Legacy fallback — set in dashboard instead |

All settings including Telegram, Discord, Slack, Teams, and GitHub tokens + allowlists are configured via the dashboard Settings tab and stored in `data/settings.json`.

### GitHub polling integration
- **Polling-based** — no webhook setup required; bot automatically checks allowed repos every 120 seconds
- **Config settings:** `github.token` (PAT), `github.allowedRepos` (comma-separated or empty for all public), `github.allowedUsers` (usernames), `github.allowedUserIds` (numeric IDs)
- **allowedRepos format:** array of strings like `["owner/repo", "owner/repo2"]` — parsed from comma-separated string in dashboard or `.env` `GITHUB_ALLOWED_REPOS`
- **Lifecycle:** polling starts automatically 4s after bot startup; stops cleanly on shutdown
- **Rate limiting:** respects GitHub's 30 req/min search API limit by checking every 120s; for multiple repos, specifying allowedRepos keeps queries efficient
