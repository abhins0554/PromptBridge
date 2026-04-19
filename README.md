<div align="center">

<img src="public/logo.png" alt="PromptBridge Logo" width="120" style="border-radius: 20px; margin-bottom: 20px;" />

# 🌉 PromptBridge

**Multi-platform AI agent orchestrator**

Drive **Claude Code** and **Cursor** agents from **Telegram**, **Discord**, **Slack**, **Teams**, **GitHub**, **Email**, or any platform you wire in — with a zero-config web dashboard.

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.17-brightgreen?logo=node.js)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platforms](https://img.shields.io/badge/Platforms-Telegram%20%7C%20Discord%20%7C%20Slack%20%7C%20Teams%20%7C%20Email-blueviolet)](#platforms)
[![Powered by Claude](https://img.shields.io/badge/Powered%20by-Claude%20Code-orange)](https://claude.ai/code)

</div>

---

## What is PromptBridge?

PromptBridge lets you control AI coding agents from anywhere — your phone, Discord, Slack, Teams, GitHub, your inbox, or a browser. Send a prompt via Telegram, Discord, Slack, Teams, GitHub issue/PR comments, or email, and get a full agent-powered response with file attachments, git diffs, and generated artifacts delivered back to you automatically.

<div align="center">
<pre><code>You (Telegram / Discord / Slack / Teams / GitHub / Email)
        │
        ▼
  PromptBridge
  ┌──────────────────────────────────────────────┐
  │  Dashboard  ·  REST API                      │
  │  ┌──────────┐  ┌──────────┐  ┌────────────┐ │
  │  │ Telegram │  │ Discord  │  │  GitHub    │ │
  │  │ Adapter  │  │ Adapter  │  │  Polling   │ │
  │  └────┬─────┘  └────┬─────┘  └──────┬─────┘ │
  │       │             │               │       │
  │  ┌─────────┐  ┌──────────┐  ┌────────────┐  │
  │  │  Slack  │  │   Teams  │  │   Email    │  │
  │  │ Adapter │  │ Adapter  │  │  Adapter   │  │
  │  └────┬────┘  └────┬─────┘  └────────┬───┘  │
  │       └──────┬─────┴──────┬──────────┘      │
  │        Dispatcher          │                │
  │   (platform-agnostic)      │                │
  └────────────────┬───────────────────────────┘
                   │
          ┌────────┴────────┐
          │                 │
     Claude Code         Cursor
      (claude CLI)   (cursor-agent CLI)
</code></pre>
</div>

---

## Features

- **Telegram bot** — send prompts, receive AI responses, manage projects, get file artifacts
- **Discord bot** — use slash commands, buttons, plain channel messages, and attachments
- **Slack app** — use slash commands, channel/thread replies, buttons, and file attachments
- **Microsoft Teams bot** — use adaptive cards, team/group/personal chat, and file attachments
- **GitHub integration** — mention `/claude` in issue/PR comments, bot responds as comments
- **Email triggers** — send `hi /claude <prompt>` to your inbox, get a reply with results
- **Email attachments** — attach files to your email; the agent reads them just like Telegram
- **Inbound IMAP** — real-time email monitoring with IDLE push and exponential-backoff reconnect
- **Web dashboard** — configure everything at `http://localhost:3000` — no restarts needed
- **Multi-project** — switch between configured codebases per chat session
- **Session continuity** — agents remember conversation context across messages
- **Git-aware** — sends file diffs and changed artifacts after each run
- **Hot-reload settings** — change Telegram/Discord/Teams/GitHub tokens, SMTP, or agent paths; active clients restart automatically
- **Extensible** — platform-agnostic core makes it easy to add any messaging platform

---

## Quick Start

### Prerequisites

- **Node.js ≥ 18.17**
- **[Claude Code CLI](https://claude.ai/code)** (`claude`) on PATH — for Claude agent support
- **Cursor agent** (`cursor-agent`) on PATH — optional, for Cursor support

### Install

```bash
git clone https://github.com/abhins0554/PromptBridge.git
cd PromptBridge
npm install
```

### Configure

```bash
cp .env.example .env
```

`.env` only needs bootstrap values (port, dashboard auth token). Everything else is set in the dashboard.

### Run

```bash
npm start          # production
npm run dev        # development — auto-restarts on file changes
```

### Set up Telegram

1. Open **http://localhost:3000** → **Settings** tab → **Telegram** section
2. Paste your bot token (get one from [@BotFather](https://t.me/BotFather))
3. Enter allowed Telegram usernames or user IDs
4. Click **Save Settings** — bot starts automatically, no restart needed

### Set up Discord

1. Create a Discord application + bot in the Discord developer portal
2. Enable the **Message Content Intent**
3. Open **http://localhost:3000** → **Settings** tab → **Discord Bot** section
4. Paste your bot token and allowed usernames or user IDs
5. Click **Save Settings** — the client connects and registers slash commands

### Set up Slack

1. Create a Slack app from scratch in the [Slack API dashboard](https://api.slack.com/apps)
2. Enable **Socket Mode** and generate an **App Token** (`xapp-...`)
3. Add **Bot Token Scopes**: `chat:write`, `files:write`, `app_mentions:read`, `message.*:read`
4. Open **http://localhost:3000** → **Settings** tab → **Slack App** section
5. Paste your **Bot Token** and **App Token**, and add allowed usernames or user IDs
6. Click **Save Settings** — Socket Mode connects and listens for interactions

### Set up Microsoft Teams

1. Create a bot in the [Azure Bot Service](https://portal.azure.com)
2. Register the bot with Microsoft Bot Framework
3. Generate an **App ID** and **App Password** (client secret)
4. Configure the messaging endpoint to: `https://your-domain.com/api/messages`
5. Open **http://localhost:3000** → **Settings** tab → **Teams App** section
6. Paste your **App ID** and **App Password**, and add allowed usernames or user IDs
7. Click **Save Settings** — Teams bot connects and listens for messages
8. Add the bot to your Teams teams/groups — it will work in personal, group, and team chats

### Set up GitHub

1. Create a Personal Access Token at [github.com/settings/tokens/new](https://github.com/settings/tokens/new)
   - Scope: `repo` for private repos, `public_repo` for public repos only
2. Open **http://localhost:3000** → **Settings** tab → **GitHub Integration** section
3. Paste your PAT in **Personal Access Token (PAT)** field
4. (Optional) List allowed repositories to poll — comma-separated format: `owner/repo, owner/repo2`
   - Leave blank to search all public repos (not recommended for rate limits)
   - For efficiency with GitHub's search rate limit (30 req/min), specify your repos
5. Add allowed GitHub usernames or user IDs (leave blank to allow all users)
6. Click **Save Settings** — polling starts automatically (checks every 120 seconds)
7. Users can now mention `/claude` or `/cursor` in issue/PR comments, and the bot will respond within 2 minutes

**Note:** GitHub integration uses polling (no webhook setup needed). Every 2 minutes, the bot searches your allowed repos for `/claude` or `/cursor` mentions in issue/PR comments and responds directly.

---

## Dashboard

The dashboard is the primary configuration interface. All runtime settings are stored in `data/settings.json` — never in code.

| Tab | Purpose |
|-----|---------|
| **Projects** | Add, edit, delete project directories with agent + model settings |
| **Email Run** | Trigger an agent run from the browser and receive the response by email |
| **Sessions** | View and clear per-chat conversation sessions |
| **Settings** | Telegram, Discord, Slack, Teams, GitHub bot tokens and allowlists; agent executables; Claude permission mode; SMTP/IMAP for email |

---

## Platforms

### Telegram

| Command | Description |
|---------|-------------|
| `/claude <prompt>` | Ask Claude Code anything |
| `/cursor <prompt>` | Ask Cursor agent anything |
| `/projects` | List and switch active project |
| `/use <name>` | Activate a project |
| `/current` | Show active project and session ID |
| `/model` | Switch model for Q&A or active project |
| `/reset` | Clear session history |
| `/cancel` | Abort a running agent |
| `/dashboard` | Dashboard URL |
| `/help` | Show help |

Plain text (no slash) runs the active project's agent. Send a file with a `/claude` or `/cursor` caption to have the agent read it.

### Discord

Use slash commands with the same command surface as Telegram:

| Command | Description |
|---------|-------------|
| `/claude <prompt>` | Ask Claude Code anything |
| `/cursor <prompt>` | Ask Cursor agent anything |
| `/projects` | List and switch active project |
| `/use <project>` | Activate a project for the current channel |
| `/current` | Show active project and session ID |
| `/model` | Switch model for Q&A or active project |
| `/reset` | Clear session history |
| `/cancel` | Abort a running agent |
| `/dashboard` | Dashboard URL |
| `/help` | Show help |

Plain channel messages run the active project's agent. Send attachments with a `/claude` or `/cursor` message to have the agent read them from disk.

### Slack

Slack uses **message-based interactions** via Socket Mode. Send commands as regular messages in channels or DMs:

| Command | Description |
|---------|-------------|
| `/claude <prompt>` | Ask Claude Code anything |
| `/cursor <prompt>` | Ask Cursor agent anything |
| `/projects` | List and switch active project |
| `/use <project>` | Activate a project for the current channel |
| `/current` | Show active project and session ID |
| `/model` | Switch model for Q&A or active project |
| `/reset` | Clear session history |
| `/cancel` | Abort a running agent |
| `/dashboard` | Dashboard URL |
| `/help` | Show help |

Send messages with file attachments; the agent will read them from disk. Responses include any generated files as attachments.

### Microsoft Teams

Teams uses **adaptive cards** for rich interactions. Send commands as regular messages in personal, group, or team chats:

| Command | Description |
|---------|-------------|
| `/claude <prompt>` | Ask Claude Code anything |
| `/cursor <prompt>` | Ask Cursor agent anything |
| `/projects` | List and switch active project (displays as adaptive card) |
| `/use <project>` | Activate a project for the current chat |
| `/current` | Show active project and session ID |
| `/model` | Switch model for Q&A or active project |
| `/reset` | Clear session history |
| `/cancel` | Abort a running agent |
| `/dashboard` | Dashboard URL |
| `/help` | Show help |

Teams supports **adaptive card buttons** for interactive menus. Send files with your message; the agent will read them from disk. Responses include generated files as downloadable attachments.

### GitHub

Mention `/claude` or `/cursor` in **issue comments** or **pull request comments** to trigger the agent. The bot responds directly to the same issue/PR via polling (every 120 seconds):

| Command | Description |
|---------|-------------|
| `/claude <prompt>` | Ask Claude Code in an issue/PR comment |
| `/cursor <prompt>` | Ask Cursor agent in an issue/PR comment |
| `/help` | Show available commands |

**Example:** In a pull request comment, type:
```
/claude please analyze this code and suggest improvements
```

The bot will:
1. Poll the repo every 2 minutes for your `/claude` or `/cursor` mentions
2. Fetch the issue/PR description and all comments
3. Run Claude/Cursor with the full context
4. Post the response as a reply comment on the same issue/PR

**Polling:** The bot checks allowed repos every 120 seconds. Specify repos in Settings → GitHub Integration → Allowed Repositories to optimize API rate limits.

**Session awareness:** The bot maintains conversation state per issue/PR, so follow-up `/claude` commands in the same thread include all previous context.

### Email

Send a trigger email to your configured inbox:

```
Subject: Any subject

hi /claude explain the architecture of this codebase

---
```

Or attach files — the agent will read them from disk, same as Telegram:

```
Subject: Code review

hi /claude review the attached file and suggest improvements

[attachment: myfile.py]
```

The reply arrives as a standard email with any generated files as attachments.

**Email setup:**

1. Open **Settings** → enable **Inbound Email (IMAP)** and fill in IMAP + SMTP credentials
2. Click **Test SMTP Connection** to verify
3. Save — the IMAP listener starts automatically

**Example values for Gmail:**

| Field | Value |
|-------|-------|
| SMTP Host | `smtp.gmail.com` |
| SMTP Port | `587` |
| IMAP Host | `imap.gmail.com` |
| IMAP Port | `993` |
| Username | `you@gmail.com` |
| Password | App password (not your account password) |

---

## Configuration

### Environment variables (bootstrap only)

`.env` is only needed for bootstrap values. Everything else is configured in the dashboard.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | Dashboard HTTP port |
| `DASHBOARD_TOKEN` | No | — | Bearer token to protect the dashboard API |
| `LOG_LEVEL` | No | `info` | `debug` / `info` / `warn` / `error` |
| `BOT_TOKEN` | No | — | Legacy — set in dashboard instead |
| `ALLOWED_USERS` | No | — | Legacy — set in dashboard instead |
| `DISCORD_BOT_TOKEN` | No | — | Legacy — set in dashboard instead |
| `DISCORD_ALLOWED_USERS` | No | — | Legacy — set in dashboard instead |
| `DISCORD_ALLOWED_USER_IDS` | No | — | Legacy — set in dashboard instead |
| `SLACK_BOT_TOKEN` | No | — | Legacy — set in dashboard instead |
| `SLACK_APP_TOKEN` | No | — | Legacy — set in dashboard instead |
| `SLACK_ALLOWED_USERS` | No | — | Legacy — set in dashboard instead |
| `SLACK_ALLOWED_USER_IDS` | No | — | Legacy — set in dashboard instead |
| `TEAMS_APP_ID` | No | — | Legacy — set in dashboard instead |
| `TEAMS_APP_PASSWORD` | No | — | Legacy — set in dashboard instead |
| `TEAMS_ALLOWED_USERS` | No | — | Legacy — set in dashboard instead |
| `TEAMS_ALLOWED_USER_IDS` | No | — | Legacy — set in dashboard instead |
| `GITHUB_TOKEN` | No | — | Legacy — set in dashboard instead |
| `GITHUB_WEBHOOK_SECRET` | No | — | Legacy — set in dashboard instead |
| `GITHUB_ALLOWED_USERS` | No | — | Legacy — set in dashboard instead |
| `GITHUB_ALLOWED_USER_IDS` | No | — | Legacy — set in dashboard instead |

### Dashboard settings (stored in `data/settings.json`)

| Setting | Description |
|---------|-------------|
| Telegram bot token | From [@BotFather](https://t.me/BotFather) |
| Telegram allowlist | Usernames/user IDs for Telegram access |
| Discord bot token | From the Discord developer portal |
| Discord allowlist | Usernames/user IDs for Discord access |
| Slack bot token | Bot User OAuth Token (`xoxb-...`) from Slack app |
| Slack app token | Socket Mode App Token (`xapp-...`) from Slack app |
| Slack allowlist | Usernames/user IDs for Slack access |
| Teams app ID | Microsoft Bot Framework App ID |
| Teams app password | Microsoft Bot Framework App Password (client secret) |
| Teams allowlist | Usernames/user IDs for Teams access |
| GitHub PAT | Personal Access Token with `repo` scope from github.com/settings/tokens |
| GitHub allowed repos | Comma-separated repos to poll (e.g., `owner/repo, owner/repo2`); leave blank for all public repos |
| GitHub allowlist | Usernames/user IDs for GitHub access (leave blank to allow all) |
| Claude executable | Path to `claude` CLI (default: `claude`) |
| Cursor executable | Path to `cursor-agent` CLI (default: `cursor-agent`) |
| Permission mode | `bypassPermissions` / `acceptEdits` / `plan` / `default` |
| Agent timeout | Max seconds per run (default: 3600) |
| SMTP settings | Outbound email for results |
| IMAP settings | Inbound email monitoring |
| Allowed email senders | Allowlist for inbound email triggers |

---

## Project Structure

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
    context.js                SlackContext — message + interaction handling
    attachments.js            Slack attachment download helpers
  teams/
    index.js                  Teams Bot Framework adapter + message processing
    context.js                TeamsContext — adaptive cards + activity handling
    attachments.js            Teams attachment download helpers
  github/
    index.js                  GitHub webhook listener — parses comments, routes commands
    context.js                GitHubContext — posts responses as issue/PR comments
    attachments.js            GitHub attachment utilities
  email/
    index.js                  EmailContext — buffers messages → sends one email
    inbound.js                IMAP listener — real-time email monitoring
lib/
  config.js                   Config loader (.env bootstrap + settings.json runtime)
  runner.js                   Spawns claude / cursor-agent CLI processes
  store.js                    JSON persistence for projects + sessions
  changes.js                  Git diff + artifact detection
  format.js                   Markdown → HTML + chunking helpers
  models.js                   Model presets (Claude / Cursor)
  server.js                   Express dashboard + REST API
  logger.js                   Leveled structured logger
public/index.html             Single-file dashboard SPA
data/                         Runtime state — auto-created, gitignored
```

---

## REST API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/status` | Public | Health check + version |
| `GET` | `/api/projects` | Required | List projects |
| `POST` | `/api/projects` | Required | Create project |
| `PUT` | `/api/projects/:id` | Required | Update project |
| `DELETE` | `/api/projects/:id` | Required | Delete project |
| `GET` | `/api/models` | Required | Claude + Cursor model presets |
| `GET` | `/api/sessions` | Required | All chat sessions |
| `DELETE` | `/api/sessions/:chatId/:projectId` | Required | Clear a session |
| `GET` | `/api/settings` | Required | Runtime settings (secrets masked) |
| `PUT` | `/api/settings` | Required | Update runtime settings |
| `POST` | `/api/settings/email/test` | Required | Test SMTP connection |
| `POST` | `/api/settings/imap/test` | Required | Test IMAP connection |
| `POST` | `/api/run/email` | Required | Trigger agent run + email result |

When `DASHBOARD_TOKEN` is set, include `Authorization: Bearer <token>` on every request.

---

## Adding a New Platform

1. Create `platforms/<name>/context.js` extending `BotContext` from `core/context.js`
2. Implement `sendMarkdown`, `sendText`, `editMessage`, `sendFile`, `sendWithButtons`, etc.
3. Create `platforms/<name>/index.js` to wire your platform's SDK events to the dispatcher
4. Call `handleCommand`, `handleText`, `handleFiles`, or `handleCallbackAction` from `core/dispatcher`
5. Import and start it alongside Telegram in `bot.js`

No changes to `core/` or `lib/` are needed.

---

## Security

- Dashboard API is protected by a bearer token (`DASHBOARD_TOKEN`)
- IP-based lockout after repeated failed authentication attempts
- Telegram access is restricted to an explicit username/user-ID allowlist
- Email triggers are restricted to an allowed-sender list
- All secrets (SMTP passwords, IMAP passwords, bot tokens) are stored in `data/settings.json` which is gitignored and masked in API responses
- `.env` is gitignored and never committed

---

## License

MIT — see [LICENSE](LICENSE)

---

<div align="center">
Built with ❤️ · Powered by <a href="https://claude.ai/code">Claude Code</a>
</div>
