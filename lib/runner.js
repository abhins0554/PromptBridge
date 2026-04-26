const spawn = require('cross-spawn');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { make } = require('./logger');

const MAX_LINE_BYTES = 2 * 1024 * 1024;

function streamLines(stream, onLine) {
  let buf = '';
  let dropped = false;
  stream.on('data', (chunk) => {
    buf += chunk.toString();
    if (buf.length > MAX_LINE_BYTES) {
      const cutAt = buf.lastIndexOf('\n');
      if (cutAt === -1) {
        dropped = true;
        buf = buf.slice(-64 * 1024);
        return;
      }
    }
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (line) onLine(line);
    }
  });
  return () => {
    if (buf) onLine(buf);
    if (dropped) onLine('[line buffer truncated: output exceeded limit]');
  };
}

function run(cmd, args, { cwd, signal, timeoutMs, onStdoutLine, onStderrLine } = {}) {
  const resolvedTimeout = timeoutMs ?? require('./config').get().agentTimeoutMs;
  return new Promise((resolve, reject) => {
    if (cwd) {
      if (!fs.existsSync(cwd)) {
        return reject(new Error(`Working directory does not exist: ${cwd}`));
      }
    }
    const child = spawn(cmd, args, { cwd, signal, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    let timer = null;
    if (resolvedTimeout > 0) {
      timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`${cmd} timed out after ${resolvedTimeout}ms`));
      }, resolvedTimeout);
    }

    const flushOut = streamLines(child.stdout, (line) => {
      stdout += line + '\n';
      if (onStdoutLine) onStdoutLine(line);
    });
    const flushErr = streamLines(child.stderr, (line) => {
      stderr += line + '\n';
      if (onStderrLine) onStderrLine(line);
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      if (err.code === 'ENOENT') {
        return reject(
          new Error(
            `'${cmd}' not found on PATH. Install it or set the executable path in Settings (CLAUDE_CMD / CURSOR_CMD / CODEX_CMD / OPENCODE_CMD).`,
          ),
        );
      }
      reject(err);
    });
    child.on('close', (code, killSignal) => {
      if (timer) clearTimeout(timer);
      flushOut();
      flushErr();
      if (signal?.aborted) return reject(new Error('Cancelled'));
      if (code !== 0) {
        return reject(
          new Error(stderr.trim() || `${cmd} exited ${code}${killSignal ? ` (${killSignal})` : ''}`),
        );
      }
      resolve(stdout);
    });
  });
}

function preview(s, n = 100) {
  const flat = String(s || '').replace(/\s+/g, ' ').trim();
  return flat.length > n ? flat.slice(0, n) + '…' : flat;
}

function normalizeClaudeEvent(ev) {
  if (!ev || typeof ev !== 'object') return null;
  switch (ev.type) {
    case 'system':
      if (ev.subtype === 'init') {
        return { kind: 'init', model: ev.model || 'unknown', tools: (ev.tools || []).length };
      }
      return { kind: 'system', subtype: ev.subtype || '' };
    case 'assistant': {
      const blocks = ev.message?.content || [];
      const events = [];
      for (const b of blocks) {
        if (b.type === 'text' && b.text) {
          events.push({ kind: 'text', text: preview(b.text) });
        } else if (b.type === 'tool_use') {
          const inp = b.input || {};
          const target =
            inp.file_path || inp.path || inp.command || inp.pattern || inp.url || inp.description || '';
          events.push({ kind: 'tool', name: b.name, target: preview(target, 80) });
        } else if (b.type === 'thinking') {
          events.push({ kind: 'thinking', text: preview(b.thinking) });
        }
      }
      return events.length ? { kind: 'assistant', events } : null;
    }
    case 'user': {
      const blocks = ev.message?.content || [];
      for (const b of blocks) {
        if (b.type === 'tool_result') {
          return { kind: 'tool_result', isError: !!b.is_error };
        }
      }
      return null;
    }
    case 'result':
      return {
        kind: 'result',
        subtype: ev.subtype || 'done',
        durationMs: ev.duration_ms,
        costUsd: ev.total_cost_usd,
      };
    default:
      return null;
  }
}

async function runClaude({ prompt, cwd, systemPrompt, sessionId, signal, timeoutMs, tag = 'claude', onProgress, model }) {
  // Read config fresh each call so dashboard changes (claudeCmd, permissionMode) take effect
  const config = require('./config').get();
  const log = make(tag);
  const args = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', config.permissionMode,
  ];
  if (model) args.push('--model', model);
  if (systemPrompt) args.push('--append-system-prompt', systemPrompt);
  if (sessionId) args.push('--resume', sessionId);

  let resultText = '';
  let resultSessionId = null;

  await run(config.claudeCmd, args, {
    cwd,
    signal,
    timeoutMs,
    onStdoutLine: (line) => {
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      if (ev.type === 'result') {
        resultText = ev.result || resultText;
        resultSessionId = ev.session_id || resultSessionId;
      }
      const norm = normalizeClaudeEvent(ev);
      if (!norm) return;
      log.debug(norm.kind, norm);
      if (onProgress) {
        try { onProgress(norm); } catch (err) { log.warn('progress handler error', { err: err.message }); }
      }
    },
    onStderrLine: (line) => log.warn('stderr', { line: preview(line, 240) }),
  });

  return { text: resultText || '(empty)', sessionId: resultSessionId };
}

async function runCursor({ prompt, cwd, systemPrompt, sessionId, signal, timeoutMs, tag = 'cursor', onProgress, model }) {
  const config = require('./config').get();
  const log = make(tag);
  const fullPrompt = systemPrompt ? `${systemPrompt}\n\n---\n\n${prompt}` : prompt;
  const resolvedModel = model || config.cursorModel;
  const args = ['--trust', '--model', resolvedModel, '-p', fullPrompt, '--output-format', 'text'];
  if (sessionId) args.push('--resume', sessionId);

  let linesSeen = 0;
  const out = await run(config.cursorCmd, args, {
    cwd,
    signal,
    timeoutMs,
    onStdoutLine: (line) => {
      linesSeen++;
      log.debug('stdout', { line: preview(line, 200) });
      if (onProgress && linesSeen % 5 === 0) {
        onProgress({ kind: 'cursor_lines', count: linesSeen });
      }
    },
    onStderrLine: (line) => log.warn('stderr', { line: preview(line, 240) }),
  });

  return { text: out.trim(), sessionId: null };
}

async function runCodex({ prompt, cwd, systemPrompt, signal, timeoutMs, tag = 'codex', onProgress, model }) {
  const config = require('./config').get();
  const log = make(tag);
  const fullPrompt = systemPrompt ? `${systemPrompt}\n\n---\n\n${prompt}` : prompt;
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptbridge-codex-'));
  const outputFile = path.join(outputDir, 'last-message.txt');
  const args = ['exec', '--skip-git-repo-check', '--output-last-message', outputFile];

  if (config.permissionMode === 'bypassPermissions') args.push('--dangerously-bypass-approvals-and-sandbox');
  else args.push('--full-auto');

  if (model) args.push('--model', model);
  args.push(fullPrompt);

  let linesSeen = 0;
  try {
    await run(config.codexCmd, args, {
      cwd,
      signal,
      timeoutMs,
      onStdoutLine: (line) => {
        linesSeen++;
        log.debug('stdout', { line: preview(line, 200) });
        if (onProgress && linesSeen % 5 === 0) {
          onProgress({ kind: 'codex_lines', count: linesSeen });
        }
      },
      onStderrLine: (line) => log.warn('stderr', { line: preview(line, 240) }),
    });

    const text = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8').trim() : '';
    return { text: text || '(empty)', sessionId: null };
  } finally {
    try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch {}
  }
}

async function runOpenCode({ prompt, cwd, systemPrompt, signal, timeoutMs, tag = 'opencode', onProgress, model }) {
  const config = require('./config').get();
  const log = make(tag);
  const fullPrompt = systemPrompt ? `${systemPrompt}\n\n---\n\n${prompt}` : prompt;
  const args = ['run'];
  if (model) args.push('--model', model);
  args.push(fullPrompt);

  let linesSeen = 0;
  const out = await run(config.opencodeCmd, args, {
    cwd,
    signal,
    timeoutMs,
    onStdoutLine: (line) => {
      linesSeen++;
      log.debug('stdout', { line: preview(line, 200) });
      if (onProgress && linesSeen % 5 === 0) {
        onProgress({ kind: 'opencode_lines', count: linesSeen });
      }
    },
    onStderrLine: (line) => log.warn('stderr', { line: preview(line, 240) }),
  });

  return { text: out.trim() || '(empty)', sessionId: null };
}

module.exports = { runClaude, runCursor, runCodex, runOpenCode };
