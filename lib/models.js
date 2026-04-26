const CLAUDE_PRESETS = [
  { id: 'opus', label: 'Opus (most capable)' },
  { id: 'sonnet', label: 'Sonnet (balanced)' },
  { id: 'haiku', label: 'Haiku (fast)' },
  { id: 'claude-opus-4-7', label: 'Opus 4.7' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
];

const CURSOR_PRESETS = [
  { id: 'auto', label: 'Auto' },
  { id: 'claude-4-sonnet', label: 'Claude 4 Sonnet' },
  { id: 'claude-4-opus', label: 'Claude 4 Opus' },
  { id: 'gpt-5', label: 'GPT-5' },
  { id: 'grok-4', label: 'Grok 4' },
];

const CODEX_PRESETS = [
  { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' },
  { id: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max' },
  { id: 'gpt-5.1-codex', label: 'GPT-5.1 Codex' },
  { id: 'gpt-5-codex', label: 'GPT-5 Codex' },
];

const OPENCODE_PRESETS = [
  { id: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'anthropic/claude-opus-4-7', label: 'Claude Opus 4.7' },
  { id: 'openai/gpt-4o', label: 'GPT-4o' },
  { id: 'openai/o3', label: 'o3' },
  { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
];

function presetsFor(agent) {
  if (agent === 'cursor') return CURSOR_PRESETS;
  if (agent === 'codex') return CODEX_PRESETS;
  if (agent === 'opencode') return OPENCODE_PRESETS;
  return CLAUDE_PRESETS;
}

function sanitizeModel(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s.length > 64) return null;
  if (!/^[A-Za-z0-9._:/@+\-\[\]]+$/.test(s)) return null;
  return s;
}

module.exports = { CLAUDE_PRESETS, CURSOR_PRESETS, CODEX_PRESETS, OPENCODE_PRESETS, presetsFor, sanitizeModel };
