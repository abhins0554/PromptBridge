const fs = require('fs');
const { projects, sessions } = require('../lib/store');
const { runClaude, runCursor, runCodex } = require('../lib/runner');
const { snapshot, diffFromSnapshot, collectArtifacts } = require('../lib/changes');
const { truncate, formatSize } = require('../lib/format');
const { make } = require('../lib/logger');
const config = require('../lib/config').get();
const { presetsFor, sanitizeModel } = require('../lib/models');

const log = make('dispatcher');

// chatId → AbortController; shared across all platform instances
const inflight = new Map();

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtDuration(ms) {
  if (!ms || ms < 1000) return `${ms || 0}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function buildProjectContextHeader(p) {
  return (
    `Project: ${p.name}\nWorking directory: ${p.cwd}\n` +
    `Work strictly inside this working directory. Do not modify files elsewhere.\n` +
    `You have file system and shell tools available. ALWAYS use them to inspect, ` +
    `read, or modify files — do not just describe what you would do, actually do it.\n`
  );
}

function helpText() {
  return [
    '**PromptBridge**',
    '',
    '**Ask (no project needed)**',
    '• `/claude <prompt>` — ask Claude Code anything',
    '• `/cursor <prompt>` — ask Cursor agent anything',
    '• `/codex <prompt>` — ask Codex anything',
    '',
    '**Project work**',
    "• `/projects` — list & switch",
    '• `/use <name>` — activate a project',
    '• `/current` — active project + session',
    "• Plain text (no slash) runs the active project's agent",
    '',
    '**Session & Model**',
    '• `/reset` — clear sessions for this chat (project + Q&A)',
    '• `/model` — switch model for Q&A or active project',
    '• `/cancel` — abort running agent',
    '',
    '**Admin**',
    '• `/dashboard` — open web UI',
    '• `/help` — this menu',
  ].join('\n');
}

// ─── Menu builders (deduplicated) ────────────────────────────────────────────

function buildModelMenu(chatId) {
  const s = sessions.get(chatId);
  const p = s.projectId ? projects.get(s.projectId) : null;
  const fcl = sessions.getFreeformModel(chatId, 'claude');
  const fcu = sessions.getFreeformModel(chatId, 'cursor');
  const fco = sessions.getFreeformModel(chatId, 'codex');

  const lines = ['**🎛 Model settings**', ''];
  lines.push(`• Q&A Claude: \`${fcl || 'default'}\``);
  lines.push(`• Q&A Cursor: \`${fcu || 'default'}\``);
  lines.push(`• Q&A Codex: \`${fco || 'default'}\``);
  if (p) {
    lines.push(`• Project **${p.name}** [${p.agent}]: \`${p.model || 'default'}\``);
  } else {
    lines.push('_(no active project — /use or /projects)_');
  }

  const buttons = [
    [
      { label: '🤖 Q&A Claude ▾', id: 'm:pick:fcl' },
      { label: '🤖 Q&A Cursor ▾', id: 'm:pick:fcu' },
      { label: '🤖 Q&A Codex ▾', id: 'm:pick:fco' },
    ],
  ];
  if (p) buttons.push([{ label: `📁 Project "${truncate(p.name, 16)}" ▾`, id: 'm:pick:proj' }]);

  return { text: lines.join('\n'), buttons };
}

function buildProjectsMenu(chatId) {
  const all = projects.list();
  const activeId = sessions.get(chatId).projectId;

  const lines = ['**Projects**  _(tap to activate)_'];
  for (const p of all) {
    lines.push(`${p.id === activeId ? '●' : '○'} **${p.name}** [${p.agent}]`);
    lines.push(`   \`${p.cwd}\``);
  }

  const buttonRows = [];
  for (let i = 0; i < all.length; i += 2) {
    buttonRows.push(
      all.slice(i, i + 2).map((p) => ({
        label: `${p.id === activeId ? '● ' : ''}${p.name} [${p.agent}]`,
        id: `use:${p.id}`,
      })),
    );
  }

  return { text: lines.join('\n'), buttonRows };
}

function getScopePresets(chatId, scope) {
  if (scope === 'fcl') return presetsFor('claude');
  if (scope === 'fcu') return presetsFor('cursor');
  if (scope === 'fco') return presetsFor('codex');
  if (scope === 'proj') {
    const s = sessions.get(chatId);
    const p = s.projectId ? projects.get(s.projectId) : null;
    return p ? presetsFor(p.agent) : [];
  }
  return [];
}

function scopeLabel(scope) {
  if (scope === 'fcl') return 'Q&A Claude';
  if (scope === 'fcu') return 'Q&A Cursor';
  if (scope === 'fco') return 'Q&A Codex';
  return 'active project';
}

// ─── Progress tracker ─────────────────────────────────────────────────────────

function createProgressTracker(ctx, messageId, agent, scope) {
  const startedAt = Date.now();
  const tools = [];
  const toolCounts = new Map();
  let latestText = '';
  let latestTool = null;
  let pending = false;
  let inflightRender = false;

  async function render() {
    if (inflightRender) { pending = true; return; }
    inflightRender = true;
    pending = false;
    const elapsed = fmtDuration(Date.now() - startedAt);
    const toolList = [...toolCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, n]) => `${name}×${n}`)
      .join(', ');
    const lines = [
      `⚙️ **${agent}** on **${scope}**`,
      `⏱️ ${elapsed}  ·  🔧 ${tools.length} tool calls`,
    ];
    if (toolList) lines.push(`_${toolList}_`);
    if (latestTool) lines.push(`▶ \`${truncate(latestTool, 80)}\``);
    if (latestText) lines.push(`💬 ${truncate(latestText, 140)}`);
    try {
      await ctx.editMessage(messageId, lines.join('\n'));
    } catch {}
    finally {
      inflightRender = false;
      if (pending) render();
    }
  }

  const timer = setInterval(render, 3500);

  return {
    onEvent(ev) {
      if (ev.kind === 'assistant') {
        for (const sub of ev.events) {
          if (sub.kind === 'tool') {
            tools.push(sub.name);
            toolCounts.set(sub.name, (toolCounts.get(sub.name) || 0) + 1);
            latestTool = `${sub.name} ${sub.target || ''}`.trim();
          } else if (sub.kind === 'text') {
            latestText = sub.text;
          } else if (sub.kind === 'thinking') {
            latestText = '… ' + sub.text;
          }
        }
      } else if (ev.kind === 'cursor_lines') {
        latestText = `cursor streaming (${ev.count} lines)`;
      } else if (ev.kind === 'codex_lines') {
        latestText = `codex streaming (${ev.count} lines)`;
      }
    },
    finalize() {
      clearInterval(timer);
      return { elapsedMs: Date.now() - startedAt, tools, toolCounts };
    },
  };
}

// ─── Artifact sender ──────────────────────────────────────────────────────────

async function sendArtifacts(ctx, cwd, baseline) {
  const artifacts = await collectArtifacts(cwd, baseline).catch((err) => {
    log.warn('artifact scan failed', { err: err.message });
    return [];
  });
  if (!artifacts.length) return;

  const sendable = artifacts.filter((a) => !a.tooLarge);
  const tooBig = artifacts.filter((a) => a.tooLarge);

  if (sendable.length) {
    await ctx.sendText(`📎 Sending ${sendable.length} file${sendable.length === 1 ? '' : 's'}…`);
  }
  for (const a of sendable) {
    try {
      await ctx.sendFile(a.path, `📎 ${a.rel}  ·  ${formatSize(a.size)}`);
    } catch (err) {
      log.warn('send file failed', { file: a.name, err: err.message });
      await ctx.sendText(`⚠️ Could not send ${a.rel}: ${err.message}`);
    }
  }
  if (tooBig.length) {
    const lines = tooBig.map((a) => `• ${a.rel} (${formatSize(a.size)})`);
    await ctx.sendText(
      `⚠️ ${tooBig.length} file${tooBig.length === 1 ? '' : 's'} skipped — too large to upload:\n` +
        lines.join('\n'),
    );
  }
}

// ─── Core run executor ───────────────────────────────────────────────────────

async function executeRun(ctx, opts) {
  const { prompt, agent, cwd, scope, systemPrompt, sessionId, saveSessionId, onSuccessTail, model } = opts;

  if (inflight.has(ctx.chatId)) {
    return ctx.sendText('Already running. Send /cancel first.');
  }
  const ac = new AbortController();
  inflight.set(ctx.chatId, ac);

  ctx.showTyping();
  const typingTimer = setInterval(() => ctx.showTyping(), 4000);

  const modelSuffix = model ? `  ·  \`${model}\`` : '';
  const statusMsgId = await ctx.sendMarkdown(`⚙️ **${agent}** on **${scope}**${modelSuffix}…`);
  const tracker = createProgressTracker(ctx, statusMsgId, agent, scope);
  const baseline = await snapshot(cwd).catch(() => null);

  log.info('run starting', {
    scope,
    agent,
    chat: ctx.chatId,
    resume: !!sessionId,
    prompt: truncate(prompt, 80),
  });

  try {
    const fn = agent === 'cursor' ? runCursor : agent === 'codex' ? runCodex : runClaude;
    const { text, sessionId: newId } = await fn({
      prompt,
      cwd,
      systemPrompt,
      sessionId,
      model,
      signal: ac.signal,
      tag: `${agent}:${scope}`,
      onProgress: (ev) => tracker.onEvent(ev),
    });

    if (newId && saveSessionId) saveSessionId(newId);
    const summary = tracker.finalize();
    log.info('run done', {
      scope,
      agent,
      chars: text.length,
      tools: summary.tools.length,
      elapsed: fmtDuration(summary.elapsedMs),
    });

    const topTools = [...summary.toolCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([n, c]) => `${n}×${c}`)
      .join(', ');
    const finalStatus =
      `✅ **${agent}** on **${scope}**  ·  ${fmtDuration(summary.elapsedMs)}` +
      (summary.tools.length ? `  ·  🔧 ${summary.tools.length}` : '') +
      (topTools ? `\n_${topTools}_` : '');

    try { await ctx.editMessage(statusMsgId, finalStatus); } catch {}

    await ctx.sendMarkdown(text);
    if (baseline) {
      const diffText = await diffFromSnapshot(cwd, baseline).catch(() => null);
      if (diffText) await ctx.sendMarkdown('```\n' + diffText + '\n```');
      await sendArtifacts(ctx, cwd, baseline);
    }
    if (onSuccessTail) await onSuccessTail();
  } catch (e) {
    tracker.finalize();
    if (ac.signal.aborted) {
      try {
        await ctx.editMessage(statusMsgId, `🛑 Cancelled **${agent}** on **${scope}**`);
      } catch {
        await ctx.sendText('Cancelled.');
      }
    } else {
      log.error('run failed', { scope, agent, err: e.message });
      await ctx.sendMarkdown(`❌ **Error**\n\`\`\`\n${truncate(e.message, 3800)}\n\`\`\``);
    }
  } finally {
    clearInterval(typingTimer);
    inflight.delete(ctx.chatId);
  }
}

// ─── Project / freeform runners ───────────────────────────────────────────────

async function handleProjectPrompt(ctx, prompt, agentOverride) {
  const s = sessions.get(ctx.chatId);
  if (!s.projectId) return ctx.sendText('No active project. Use /projects to pick one.');
  const p = projects.get(s.projectId);
  if (!p) return ctx.sendText('Active project missing. Use /projects.');

  const agent = agentOverride || p.agent;
  const contextHeader = buildProjectContextHeader(p);

  return executeRun(ctx, {
    prompt,
    agent,
    cwd: p.cwd,
    scope: p.name,
    systemPrompt: p.systemPrompt ? `${contextHeader}\n${p.systemPrompt}` : contextHeader,
    sessionId: s.sessionIds[p.id],
    saveSessionId: (id) => sessions.setSessionId(ctx.chatId, p.id, id),
    model: p.model || null,
    onSuccessTail: () =>
      ctx.sendWithButtons('What next?', [
        [
          { label: '🔄 Reset session', id: 'reset' },
          { label: '📋 Current', id: 'current' },
        ],
      ]),
  });
}

async function handleFreeform(ctx, prompt, agent) {
  return executeRun(ctx, {
    prompt,
    agent,
    cwd: require('../lib/config').get().freeformCwd,
    scope: 'Q&A',
    systemPrompt: undefined,
    sessionId: sessions.getFreeformId(ctx.chatId, agent),
    saveSessionId: (id) => sessions.setFreeformId(ctx.chatId, agent, id),
    model: sessions.getFreeformModel(ctx.chatId, agent),
  });
}

// ─── One-shot run (no session state) — for dashboard / email triggers ────────

async function runOnce(ctx, { projectId, prompt, agent } = {}) {
  const cfg = require('../lib/config').get();
  if (projectId) {
    const p = projects.get(projectId);
    if (!p) throw new Error(`Project not found: ${projectId}`);
    const agt = agent || p.agent;
    const header = buildProjectContextHeader(p);
    return executeRun(ctx, {
      prompt,
      agent: agt,
      cwd: p.cwd,
      scope: p.name,
      systemPrompt: p.systemPrompt ? `${header}\n${p.systemPrompt}` : header,
      sessionId: null,
      saveSessionId: null,
      model: p.model || null,
    });
  }
  return executeRun(ctx, {
    prompt,
    agent: agent || 'claude',
    cwd: cfg.freeformCwd,
    scope: 'Q&A',
    systemPrompt: undefined,
    sessionId: null,
    saveSessionId: null,
    model: null,
  });
}

// ─── Public: cwd resolution for file attachments ─────────────────────────────

function getAttachmentCwd(chatId, agentOverride) {
  if (agentOverride) return { cwd: require('../lib/config').get().freeformCwd };
  const s = sessions.get(chatId);
  if (!s.projectId) return { error: 'no-project' };
  const p = projects.get(s.projectId);
  if (!p) return { error: 'project-missing' };
  return { cwd: p.cwd };
}

// ─── Command handler ──────────────────────────────────────────────────────────

async function handleCommand(ctx, command, arg) {
  switch (command) {
    case 'start':
    case 'help':
      return ctx.sendMarkdown(helpText());

    case 'dashboard':
      return ctx.sendText(`Dashboard: ${require('../lib/config').get().dashboardUrl}`);

    case 'projects': {
      const all = projects.list();
      if (!all.length) return ctx.sendText('No projects yet. Open /dashboard to add one.');
      const { text, buttonRows } = buildProjectsMenu(ctx.chatId);
      return ctx.sendWithButtons(text, buttonRows);
    }

    case 'use': {
      if (!arg) return ctx.sendText('Usage: /use <project-name>');
      const p = projects.findByName(arg) || projects.get(arg);
      if (!p) return ctx.sendText(`Project not found: ${arg}`);
      sessions.setActiveProject(ctx.chatId, p.id);
      return ctx.sendMarkdown(`✅ Active: **${p.name}** [${p.agent}]\n\`${p.cwd}\``);
    }

    case 'current': {
      const s = sessions.get(ctx.chatId);
      if (!s.projectId) return ctx.sendText('No active project. Use /projects to pick one.');
      const p = projects.get(s.projectId);
      if (!p) return ctx.sendText('Active project no longer exists. Use /projects.');
      return ctx.sendMarkdown(
        [
          `**${p.name}** [${p.agent}]`,
          `\`${p.cwd}\``,
          `Model: \`${p.model || 'default'}\``,
          `Session: \`${s.sessionIds[p.id] || '(new)'}\``,
        ].join('\n'),
      );
    }

    case 'model': {
      const { text, buttons } = buildModelMenu(ctx.chatId);
      return ctx.sendWithButtons(text, buttons);
    }

    case 'reset': {
      const s = sessions.get(ctx.chatId);
      const cleared = [];
      if (s.projectId && s.sessionIds?.[s.projectId]) {
        sessions.reset(ctx.chatId, s.projectId);
        const p = projects.get(s.projectId);
        cleared.push(`project **${p?.name || s.projectId}**`);
      }
      if (sessions.resetFreeform(ctx.chatId)) cleared.push('Q&A (/claude /cursor /codex)');
      if (!cleared.length) return ctx.sendText('Nothing to reset.');
      return ctx.sendMarkdown('🔄 Cleared: ' + cleared.join(', '));
    }

    case 'cancel': {
      const ac = inflight.get(ctx.chatId);
      if (!ac) return ctx.sendText('Nothing running.');
      ac.abort();
      return;
    }

    case 'claude': {
      if (!arg) return ctx.sendText('Usage: /claude <prompt>');
      return handleFreeform(ctx, arg, 'claude');
    }

    case 'cursor': {
      if (!arg) return ctx.sendText('Usage: /cursor <prompt>');
      return handleFreeform(ctx, arg, 'cursor');
    }

    case 'codex': {
      if (!arg) return ctx.sendText('Usage: /codex <prompt>');
      return handleFreeform(ctx, arg, 'codex');
    }

    default:
      return ctx.sendText(`Unknown command: /${command}`);
  }
}

// ─── Text handler ─────────────────────────────────────────────────────────────

async function handleText(ctx, text) {
  if (!text || text.startsWith('/')) return;
  return handleProjectPrompt(ctx, text);
}

// ─── File handler ─────────────────────────────────────────────────────────────

async function handleFiles(ctx, files, promptText, agentOverride) {
  const ok = files.filter((f) => f.path);
  if (!ok.length) return;

  const fileLines = ok
    .map((f) => `- ${f.path} (${formatSize(f.size)}${f.mime ? `, ${f.mime}` : ''})`)
    .join('\n');
  const enriched =
    `The user attached ${ok.length} file${ok.length === 1 ? '' : 's'} via chat. ` +
    `They are saved inside the working directory at:\n${fileLines}\n\n` +
    `Use your file-reading tools (Read, Bash, etc.) to open and analyze them as needed. ` +
    `Do not copy or duplicate them — read them in place.\n\n` +
    `User prompt: ${promptText}`;

  if (agentOverride) return handleFreeform(ctx, enriched, agentOverride);
  return handleProjectPrompt(ctx, enriched);
}

// ─── Callback / button action handler ────────────────────────────────────────

async function handleCallbackAction(ctx, action) {
  if (action === 'reset') {
    await ctx.acknowledgeAction();
    return handleCommand(ctx, 'reset', '');
  }

  if (action === 'current') {
    await ctx.acknowledgeAction();
    return handleCommand(ctx, 'current', '');
  }

  if (action.startsWith('use:')) {
    const id = action.slice(4);
    const p = projects.get(id);
    if (!p) { await ctx.acknowledgeAction('Project not found'); return; }
    sessions.setActiveProject(ctx.chatId, p.id);
    await ctx.acknowledgeAction(`Active: ${p.name}`);
    const { text, buttonRows } = buildProjectsMenu(ctx.chatId);
    try { await ctx.updateButtonMessage(text, buttonRows); } catch {}
    return ctx.sendMarkdown(`✅ Active: **${p.name}** [${p.agent}]`);
  }

  if (action === 'm:menu') {
    await ctx.acknowledgeAction();
    const { text, buttons } = buildModelMenu(ctx.chatId);
    try { await ctx.updateButtonMessage(text, buttons); } catch {}
    return;
  }

  const pickMatch = action.match(/^m:pick:(fcl|fcu|fco|proj)$/);
  if (pickMatch) {
    const scope = pickMatch[1];
    const presets = getScopePresets(ctx.chatId, scope);
    if (!presets.length) { await ctx.acknowledgeAction('No active project'); return; }
    await ctx.acknowledgeAction();
    const rows = [];
    for (let i = 0; i < presets.length; i += 2) {
      rows.push(
        presets.slice(i, i + 2).map((m) => ({ label: m.label, id: `m:set:${scope}:${m.id}` })),
      );
    }
    rows.push([{ label: '🔄 Use default', id: `m:set:${scope}:_default` }]);
    rows.push([{ label: '« Back', id: 'm:menu' }]);
    const label = scopeLabel(scope);
    try { await ctx.updateButtonMessage(`Pick model for **${label}**:`, rows); }
    catch { await ctx.sendWithButtons(`Pick model for ${label}:`, rows); }
    return;
  }

  const setMatch = action.match(/^m:set:(fcl|fcu|fco|proj):(.+)$/);
  if (setMatch) {
    const scope = setMatch[1];
    const raw = setMatch[2];
    const modelId = raw === '_default' ? null : sanitizeModel(raw);
    if (raw !== '_default' && !modelId) { await ctx.acknowledgeAction('Invalid model'); return; }

    if (scope === 'fcl') sessions.setFreeformModel(ctx.chatId, 'claude', modelId);
    else if (scope === 'fcu') sessions.setFreeformModel(ctx.chatId, 'cursor', modelId);
    else if (scope === 'fco') sessions.setFreeformModel(ctx.chatId, 'codex', modelId);
    else if (scope === 'proj') {
      const s = sessions.get(ctx.chatId);
      if (!s.projectId) { await ctx.acknowledgeAction('No active project'); return; }
      try { projects.update(s.projectId, { model: modelId || '' }); }
      catch (err) { await ctx.acknowledgeAction(err.message); return; }
    }

    await ctx.acknowledgeAction(`Set to ${modelId || 'default'}`);
    const { text, buttons } = buildModelMenu(ctx.chatId);
    try { await ctx.updateButtonMessage(text, buttons); } catch {}
    return;
  }

  await ctx.acknowledgeAction();
}

// ─── Exports ──────────────────────────────────────────────────────────────────

const COMMANDS = [
  { command: 'projects', description: 'List configured projects' },
  { command: 'use', description: 'Set active project for this chat' },
  { command: 'current', description: 'Show active project + session' },
  { command: 'reset', description: 'Start a fresh session' },
  { command: 'model', description: 'Pick model for Q&A or active project' },
  { command: 'claude', description: 'Ask Claude (no project needed): /claude <prompt>' },
  { command: 'cursor', description: 'Ask Cursor (no project needed): /cursor <prompt>' },
  { command: 'codex', description: 'Ask Codex (no project needed): /codex <prompt>' },
  { command: 'cancel', description: 'Abort the running agent' },
  { command: 'dashboard', description: 'Open the web dashboard' },
  { command: 'help', description: 'Show help' },
];

module.exports = {
  handleCommand,
  handleText,
  handleFiles,
  handleCallbackAction,
  runOnce,
  getAttachmentCwd,
  getInflight: () => inflight,
  COMMANDS,
};
