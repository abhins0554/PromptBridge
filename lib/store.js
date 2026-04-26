const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadOrInit(file, def) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    fs.writeFileSync(file, JSON.stringify(def, null, 2));
    return def;
  }
}

const state = {
  projects: loadOrInit(PROJECTS_FILE, []),
  sessions: loadOrInit(SESSIONS_FILE, {}),
};

const writeQueue = new Map();
function flush(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
function scheduleWrite(file, data) {
  const existing = writeQueue.get(file);
  if (existing) clearTimeout(existing);
  writeQueue.set(
    file,
    setTimeout(() => {
      writeQueue.delete(file);
      try {
        flush(file, data);
      } catch (err) {
        console.error(`Failed to persist ${path.basename(file)}:`, err.message);
      }
    }, 25),
  );
}
function flushSync(file, data) {
  const t = writeQueue.get(file);
  if (t) clearTimeout(t);
  writeQueue.delete(file);
  flush(file, data);
}

function nameTaken(name, exceptId) {
  const lower = String(name).toLowerCase();
  return state.projects.some((p) => p.name.toLowerCase() === lower && p.id !== exceptId);
}

const projects = {
  list: () => state.projects.slice(),
  get: (id) => state.projects.find((p) => p.id === id) || null,
  findByName: (name) => {
    const lower = String(name).toLowerCase();
    return state.projects.find((p) => p.name.toLowerCase() === lower) || null;
  },
  create: (data) => {
    if (!data?.name) throw new Error('name is required');
    if (nameTaken(data.name)) throw new Error(`Project name already exists: ${data.name}`);
    const project = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      systemPrompt: '',
      ...data,
    };
    state.projects.push(project);
    scheduleWrite(PROJECTS_FILE, state.projects);
    return project;
  },
  update: (id, data) => {
    const i = state.projects.findIndex((p) => p.id === id);
    if (i === -1) return null;
    if (data?.name && nameTaken(data.name, id)) {
      throw new Error(`Project name already exists: ${data.name}`);
    }
    state.projects[i] = { ...state.projects[i], ...data, id: state.projects[i].id };
    scheduleWrite(PROJECTS_FILE, state.projects);
    return state.projects[i];
  },
  remove: (id) => {
    const before = state.projects.length;
    state.projects = state.projects.filter((p) => p.id !== id);
    if (state.projects.length !== before) scheduleWrite(PROJECTS_FILE, state.projects);
  },
};

function ensureChat(chatId) {
  if (!state.sessions[chatId]) {
    state.sessions[chatId] = {
      projectId: null,
      sessionIds: {},
      freeform: {},
      freeformModel: {},
    };
  }
  const c = state.sessions[chatId];
  if (!c.sessionIds) c.sessionIds = {};
  if (!c.freeform) c.freeform = {};
  if (!c.freeformModel) c.freeformModel = {};
  return c;
}

const sessions = {
  all: () => ({ ...state.sessions }),
  get: (chatId) => state.sessions[chatId] || { projectId: null, sessionIds: {}, freeform: {} },
  setActiveProject: (chatId, projectId) => {
    const cur = ensureChat(chatId);
    cur.projectId = projectId;
    scheduleWrite(SESSIONS_FILE, state.sessions);
  },
  setSessionId: (chatId, projectId, sessionId) => {
    const cur = ensureChat(chatId);
    cur.sessionIds[projectId] = sessionId;
    scheduleWrite(SESSIONS_FILE, state.sessions);
  },
  reset: (chatId, projectId) => {
    const cur = state.sessions[chatId];
    if (cur?.sessionIds?.[projectId]) {
      delete cur.sessionIds[projectId];
      scheduleWrite(SESSIONS_FILE, state.sessions);
    }
  },
  getFreeformId: (chatId, agent) => state.sessions[chatId]?.freeform?.[agent] || null,
  setFreeformId: (chatId, agent, sessionId) => {
    const cur = ensureChat(chatId);
    cur.freeform[agent] = sessionId;
    scheduleWrite(SESSIONS_FILE, state.sessions);
  },
  resetFreeform: (chatId, agent) => {
    const cur = state.sessions[chatId];
    if (!cur?.freeform) return false;
    if (agent) {
      if (!cur.freeform[agent]) return false;
      delete cur.freeform[agent];
    } else {
      if (!Object.keys(cur.freeform).length) return false;
      cur.freeform = {};
    }
    scheduleWrite(SESSIONS_FILE, state.sessions);
    return true;
  },
  getFreeformModel: (chatId, agent) =>
    state.sessions[chatId]?.freeformModel?.[agent] || null,
  setFreeformModel: (chatId, agent, model) => {
    const cur = ensureChat(chatId);
    if (model) cur.freeformModel[agent] = model;
    else delete cur.freeformModel[agent];
    scheduleWrite(SESSIONS_FILE, state.sessions);
  },
  clearForProject: (projectId) => {
    let dirty = false;
    for (const s of Object.values(state.sessions)) {
      if (s.sessionIds?.[projectId]) {
        delete s.sessionIds[projectId];
        dirty = true;
      }
    }
    if (dirty) scheduleWrite(SESSIONS_FILE, state.sessions);
  },
};

function flushAll() {
  flushSync(PROJECTS_FILE, state.projects);
  flushSync(SESSIONS_FILE, state.sessions);
}

module.exports = { projects, sessions, flushAll };
