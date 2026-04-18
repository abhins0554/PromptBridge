    const $ = (s) => document.querySelector(s);
    const TOKEN_KEY = 'promptbridge-token';
    
    // Initialize icons
    lucide.createIcons();

    function showToast(msg, kind) {
      const el = $('#toast');
      const textSpan = el.querySelector('.toast-text');
      const icon = el.querySelector('i');
      
      textSpan.textContent = msg;
      el.className = 'toast show ' + (kind === 'error' ? 'error' : kind === 'ok' ? 'ok' : '');
      
      // Update icon based on kind
      if(kind === 'ok') {
        icon.setAttribute('data-lucide', 'check-circle-2'); 
        icon.style.color = 'var(--success)';
      } else if (kind === 'error') {
        icon.setAttribute('data-lucide', 'alert-circle');
        icon.style.color = 'var(--danger)';
      } else {
        icon.setAttribute('data-lucide', 'info');
        icon.style.color = 'var(--text-main)';
      }
      lucide.createIcons(); // Re-render icon

      clearTimeout(showToast._t);
      showToast._t = setTimeout(() => el.classList.remove('show'), 3000);
    }
    
    // Alias toast to showToast to keep existing logic functioning cleanly
    const toast = showToast;

    function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
    function setToken(v) { localStorage.setItem(TOKEN_KEY, v); }

    async function api(path, opts = {}) {
      const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
      const tok = getToken();
      if (tok) headers['Authorization'] = 'Bearer ' + tok;
      const r = await fetch(path, { ...opts, headers });
      if (r.status === 401) { $('#auth').style.display = 'block'; throw new Error('Unauthorized'); }
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Request failed');
      return data;
    }

    function escape(s) {
      return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    function fmtUptime(sec) {
      if (sec < 60) return sec + 's';
      const m = Math.floor(sec / 60);
      if (m < 60) return m + 'm ' + (sec % 60) + 's';
      return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
    }

    // ── Status ──────────────────────────────────────────────────
    async function loadStatus() {
      try {
        const s = await fetch('/api/status').then((r) => r.json());
        const tg = s.botRunning
          ? '<span class="pill ok"><i data-lucide="check" style="width:12px;height:12px;"></i> bot ok</span>'
          : (s.telegramConfigured ? '<span class="pill warn">bot starting</span>' : '<span class="pill warn">bot unconfigured</span>');
        
        const auth = s.authRequired
          ? (getToken() ? '<span class="pill ok"><i data-lucide="lock" style="width:12px;height:12px;"></i> auth ok</span>' : '<span class="pill warn"><i data-lucide="unlock" style="width:12px;height:12px;"></i> locked</span>')
          : '<span class="pill warn">no auth</span>';
          
        const email = s.emailEnabled ? '<span class="pill ok"><i data-lucide="mail" style="width:12px;height:12px;"></i> email ok</span>' : '';
        
        $('#status').innerHTML = [tg, auth, email,
          '<span class="kv"><i data-lucide="tag" style="width:14px;height:14px;"></i> <b>v' + escape(s.version || '?') + '</b></span>',
          '<span class="kv"><i data-lucide="clock" style="width:14px;height:14px;"></i> up <b>' + fmtUptime(s.uptimeSec || 0) + '</b></span>',
          '<span class="kv"><i data-lucide="activity" style="width:14px;height:14px;"></i> inflight <b>' + (s.inflightChats || 0) + '</b></span>',
        ].filter(Boolean).join(' ');
        
        lucide.createIcons(); // render dynamical icons
        if (s.authRequired && !getToken()) $('#auth').style.display = 'block';
      } catch {
        $('#status').innerHTML = '<span class="pill warn">offline</span>';
      }
    }

    $('#token-save').addEventListener('click', async () => {
      const v = $('#token-input').value.trim();
      if (!v) return;
      setToken(v);
      try {
        await api('/api/projects');
        $('#auth').style.display = 'none';
        toast('Authenticated', 'ok');
        loadAll();
      } catch { toast('Invalid token', 'error'); }
    });

    // ── Sidebar & Responsive Mobile Menu ────────────────────────
    $('#mobile-menu-toggle').addEventListener('click', () => {
      $('#sidebar').classList.toggle('open');
    });

    // Handle clicks outside sidebar on mobile
    document.addEventListener('click', (e) => {
      if (window.innerWidth <= 768) {
        if (!e.target.closest('#sidebar') && !e.target.closest('#mobile-menu-toggle')) {
          $('#sidebar').classList.remove('open');
        }
      }
    });

    // ── Navigation Logic ─────────────────────────────────────────
    document.querySelectorAll('.nav-item').forEach((item) => {
      item.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
        item.classList.add('active');
        $('#panel-' + item.dataset.tab).classList.add('active');
        
        // Auto-close sidebar on mobile after clicking
        if (window.innerWidth <= 768) {
           $('#sidebar').classList.remove('open');
        }

        if (item.dataset.tab === 'sessions') loadSessions();
        if (item.dataset.tab === 'settings') loadSettings();
        if (item.dataset.tab === 'email-run') populateEmailProjectList();
      });
    });

    // ── Projects ─────────────────────────────────────────────────
    let projectCache = [];
    async function loadProjects() {
      const table = $('#projects-table');
      try { projectCache = await api('/api/projects'); } catch { return; }
      if (!projectCache.length) {
        table.innerHTML = '<tr><td class="empty">No projects yet. Add one quickly below!</td></tr>';
        return;
      }
      table.innerHTML =
        '<tr><th>Project Profile</th><th>Assigned Model</th><th>Agent Runtime</th><th style="text-align:right;">Actions</th></tr>' +
        projectCache.map((p) => `
          <tr>
            <td>
              <div style="font-weight:600; color:var(--text-main); font-size:15px; margin-bottom:4px;">${escape(p.name)}</div>
              <code style="font-size:11px; color:#93c5fd; background: rgba(0,0,0,0.3); border:none;">${escape(p.cwd)}</code>
              <div style="font-size:12px; color:var(--text-muted); margin-top:8px; max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                 ${p.systemPrompt ? escape(p.systemPrompt) : '<i>Default system prompt config</i>'}
              </div>
            </td>
            <td>
              ${p.model ? '<span class="pill" style="border-color: rgba(59, 130, 246, 0.3); background: rgba(59, 130, 246, 0.1); color: #93c5fd;">' + escape(p.model) + '</span>' : '<span style="color:var(--text-muted); font-size:13px; font-style:italic;">Smart Autoselect</span>'}
            </td>
            <td><span class="pill" style="background:#1e293b; border-color:#334155;">${escape(p.agent)}</span></td>
            <td style="text-align:right;">
              <div class="row" style="justify-content: flex-end;">
                <button class="ghost" data-edit="${p.id}" style="padding: 6px 10px; font-size: 13px;">Edit</button>
                <button class="danger" data-delete="${p.id}" style="padding: 6px 10px; font-size: 13px;">Delete</button>
              </div>
            </td>
          </tr>`).join('');
    }

    $('#projects-table').addEventListener('click', async (e) => {
      const editId = e.target.dataset.edit;
      const delId = e.target.dataset.delete;
      if (editId) {
        const p = projectCache.find((x) => x.id === editId);
        $('#id').value = p.id; $('#name').value = p.name; $('#cwd').value = p.cwd;
        $('#agent').value = p.agent; $('#model').value = p.model || '';
        $('#systemPrompt').value = p.systemPrompt || '';
        populateModelPresets();
        $('#form-title').innerHTML = '<i data-lucide="edit-3" style="width:20px;"></i> Edit Project: ' + escape(p.name);
        lucide.createIcons();
        $('#save-btn').innerHTML = '<i data-lucide="save" style="width:16px;"></i> Update Config';
        lucide.createIcons();
        // smoothly scroll to the top of the form area
        $('#project-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (delId) {
        if (!confirm('Warning: This will permanently delete the project configuration and wipe associated session memory. Proceed?')) return;
        try { await api('/api/projects/' + delId, { method: 'DELETE' }); toast('Project purged successfully', 'ok'); loadProjects(); }
        catch (err) { toast(err.message, 'error'); }
      }
    });

    function resetForm() {
      $('#project-form').reset(); $('#id').value = '';
      $('#form-title').innerHTML = '<i data-lucide="plus-circle" style="width:20px;"></i> Add Project';
      lucide.createIcons();
      $('#save-btn').innerHTML = '<i data-lucide="save" style="width:16px;"></i> Save Project';
      lucide.createIcons();
      populateModelPresets();
    }
    $('#cancel').addEventListener('click', resetForm);

    $('#project-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = $('#id').value;
      const data = { name: $('#name').value.trim(), cwd: $('#cwd').value.trim(), agent: $('#agent').value, model: $('#model').value.trim(), systemPrompt: $('#systemPrompt').value.trim() };
      try {
        await api(id ? '/api/projects/' + id : '/api/projects', { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) });
        toast(id ? 'Configuration updated' : 'Project registered successfully', 'ok'); 
        resetForm(); loadProjects();
      } catch (err) { toast(err.message, 'error'); }
    });

    let modelCache = null;
    async function ensureModelCache() {
      if (modelCache) return modelCache;
      try { modelCache = await api('/api/models'); } catch { modelCache = { claude: [], cursor: [] }; }
      return modelCache;
    }
    async function populateModelPresets() {
      const mc = await ensureModelCache();
      const presets = mc[$('#agent').value] || [];
      $('#model-presets').innerHTML = presets.map((m) => `<option value="${escape(m.id)}">${escape(m.label)}</option>`).join('');
    }
    $('#agent').addEventListener('change', populateModelPresets);

    // ── Email Run ─────────────────────────────────────────────────
    async function populateEmailProjectList() {
      const sel = $('#er-project');
      const current = sel.value;
      try {
        const list = projectCache.length ? projectCache : await api('/api/projects');
        sel.innerHTML = '<option value="">— Generic Q&A Playground —</option>' +
          list.map((p) => `<option value="${escape(p.id)}">${escape(p.name)} [${escape(p.agent)}]</option>`).join('');
        if (current) sel.value = current;
      } catch {}
    }

    $('#email-run-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#er-submit');
      const result = $('#er-result');
      
      const originalInner = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader-2" class="lucide-spin" style="width:16px;"></i> Processing Request…';
      lucide.createIcons();
      
      result.className = 'result-box';
      try {
        const data = {
          projectId: $('#er-project').value || null,
          agent: $('#er-agent').value,
          prompt: $('#er-prompt').value.trim(),
          to: $('#er-to').value.trim(),
        };
        const r = await api('/api/run/email', { method: 'POST', body: JSON.stringify(data) });
        result.innerHTML = '<i data-lucide="check-circle-2" style="width:16px; margin-bottom:-3px;"></i> ' + escape(r.message);
        result.className = 'result-box show';
        lucide.createIcons();
        toast('Request dispatched tracking ID created in console.', 'ok');
      } catch (err) {
        result.innerHTML = '<i data-lucide="alert-triangle" style="width:16px; margin-bottom:-3px;"></i> ' + escape(err.message);
        result.className = 'result-box show error';
        lucide.createIcons();
        toast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = originalInner;
        lucide.createIcons(); // Needed because innerHTML changed
      }
    });

    // ── Sessions ─────────────────────────────────────────────────
    async function loadSessions() {
      const table = $('#sessions-table');
      let s;
      try { s = await api('/api/sessions'); } catch { return; }
      const projects = projectCache.length ? projectCache : await api('/api/projects').catch(() => []);
      const projById = Object.fromEntries(projects.map((p) => [p.id, p]));
      const entries = Object.entries(s);
      
      if (!entries.length) { table.innerHTML = '<tr><td class="empty">No active contexts. History relies on fresh operations.</td></tr>'; return; }
      const rows = [];
      for (const [chatId, sess] of entries) {
        const activeName = sess.projectId && projById[sess.projectId]?.name || '— Generic Root —';
        const sids = Object.entries(sess.sessionIds || {});
        if (!sids.length) {
          rows.push(`<tr><td><code>${escape(chatId)}</code></td><td>${escape(activeName)}</td><td><span style="color:var(--text-muted); font-style:italic;">Orphan context</span></td><td></td></tr>`);
        }
        for (const [pid, sid] of sids) {
          const pname = projById[pid]?.name || 'Archive / Removed instance';
          const isActive = pid === sess.projectId;
          rows.push(`<tr>
            <td><code>${escape(chatId)}</code></td>
            <td style="font-weight: 500; color: ${isActive ? 'var(--accent)' : 'var(--text-main)'}">
              <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${isActive ? 'currentColor' : 'transparent'}; border:1px solid currentColor; margin-right:6px;"></span>
              ${escape(pname)}
            </td>
            <td><code style="background:transparent; border:none; padding:0; color:var(--text-muted);">${escape(sid.slice(0,24))}…</code></td>
            <td style="text-align:right;"><button class="ghost" data-clear="${escape(chatId)}|${escape(pid)}" style="padding: 6px 12px; font-size:13px;"><i data-lucide="trash-2" style="width:14px; pointer-events:none;"></i> Clear</button></td>
          </tr>`);
        }
      }
      table.innerHTML = '<tr><th>Interface Thread (Chat)</th><th>Target Project</th><th>Cryptometric ID Hash</th><th style="text-align:right;">Memory Controls</th></tr>' + rows.join('');
      lucide.createIcons(); // We injected trash-2 icons
    }

    $('#sessions-table').addEventListener('click', async (e) => {
      // Find closest button in case user clicked the span or icon inside
      const btn = e.target.closest('button[data-clear]');
      if (!btn) return;
      
      const arg = btn.dataset.clear;
      const [chatId, pid] = arg.split('|');
      if (!confirm('This resets agent\'s contextual memory for this pair. Proceed?')) return;
      try {
        await api(`/api/sessions/${encodeURIComponent(chatId)}/${encodeURIComponent(pid)}`, { method: 'DELETE' });
        toast('Contextual memory cleared', 'ok'); 
        loadSessions();
      } catch (err) { toast(err.message, 'error'); }
    });

    // ── Settings ─────────────────────────────────────────────────
    function toggleSmtpFields() {
      $('#smtp-fields').style.display = $('#s-emailEnabled').checked ? 'block' : 'none';
    }
    $('#s-emailEnabled').addEventListener('change', toggleSmtpFields);

    function toggleImapFields() {
      $('#imap-fields').style.display = $('#s-inboundEnabled').checked ? 'block' : 'none';
    }
    $('#s-inboundEnabled').addEventListener('change', toggleImapFields);

    async function loadSettings() {
      try {
        const s = await api('/api/settings');

        // Telegram
        const tg = s.telegram || {};
        $('#s-botToken').value = tg.botToken || '';
        $('#s-allowedUsers').value = tg.allowedUsers || '';
        $('#s-allowedUserIds').value = tg.allowedUserIds || '';

        // Agent
        $('#s-claudeCmd').value = s.claudeCmd || '';
        $('#s-cursorCmd').value = s.cursorCmd || '';
        $('#s-permissionMode').value = s.permissionMode || 'bypassPermissions';
        $('#s-agentTimeoutMs').value = s.agentTimeoutMs ? Math.round(s.agentTimeoutMs / 60000) : 60;
        $('#s-freeformCwd').value = s.freeformCwd || '';

        // Email SMTP
        const em = s.email || {};
        $('#s-emailEnabled').checked = !!em.enabled;
        $('#s-smtpHost').value = em.smtpHost || '';
        $('#s-smtpPort').value = em.smtpPort || 587;
        $('#s-smtpUser').value = em.smtpUser || '';
        $('#s-smtpPass').value = em.smtpPass || '';
        $('#s-smtpFrom').value = em.smtpFrom || '';
        $('#s-smtpSecure').checked = !!em.smtpSecure;
        toggleSmtpFields();

        // Email IMAP
        $('#s-inboundEnabled').checked = !!em.inboundEnabled;
        $('#s-imapHost').value = em.imapHost || '';
        $('#s-imapPort').value = em.imapPort || 993;
        $('#s-imapUser').value = em.imapUser || '';
        $('#s-imapPass').value = em.imapPass || '';
        $('#s-imapTls').checked = em.imapTls !== false;
        toggleImapFields();

        $('#s-allowedEmails').value = (s.allowedEmails || []).join(', ');

        // Bootstrap read-only + telegram status banner
        const st = await fetch('/api/status').then((r) => r.json()).catch(() => ({}));
        $('#ro-port').textContent = location.port || '80';
        $('#ro-dashToken').textContent = st.authRequired ? 'Enabled (Valid Token Provided)' : 'Unprotected Default Root Access';
        $('#tg-unconfigured').style.display = st.telegramConfigured ? 'none' : 'flex';
      } catch (err) { toast('Subsystem failure on parameter hydration: ' + err.message, 'error'); }
    }

    $('#settings-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const timeoutMin = parseFloat($('#s-agentTimeoutMs').value);
      const patch = {
        telegram: {
          botToken: $('#s-botToken').value,
          allowedUsers: $('#s-allowedUsers').value.trim(),
          allowedUserIds: $('#s-allowedUserIds').value.trim(),
        },
        claudeCmd: $('#s-claudeCmd').value.trim() || 'claude',
        cursorCmd: $('#s-cursorCmd').value.trim() || 'cursor-agent',
        permissionMode: $('#s-permissionMode').value,
        agentTimeoutMs: timeoutMin > 0 ? Math.round(timeoutMin * 60000) : 3600000,
        freeformCwd: $('#s-freeformCwd').value.trim(),
        email: {
          enabled: $('#s-emailEnabled').checked,
          smtpHost: $('#s-smtpHost').value.trim(),
          smtpPort: parseInt($('#s-smtpPort').value) || 587,
          smtpUser: $('#s-smtpUser').value.trim(),
          smtpPass: $('#s-smtpPass').value,
          smtpFrom: $('#s-smtpFrom').value.trim(),
          smtpSecure: $('#s-smtpSecure').checked,
          inboundEnabled: $('#s-inboundEnabled').checked,
          imapHost: $('#s-imapHost').value.trim(),
          imapPort: parseInt($('#s-imapPort').value) || 993,
          imapUser: $('#s-imapUser').value.trim(),
          imapPass: $('#s-imapPass').value,
          imapTls: $('#s-imapTls').checked,
        },
        allowedEmails: $('#s-allowedEmails').value.split(',').map(e => e.trim()).filter(Boolean),
      };
      
      const btn = e.target.querySelector('button[type="submit"]');
      const oldHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader-2" class="lucide-spin" style="width:16px;"></i> Applying...';
      lucide.createIcons();
      
      try {
        await api('/api/settings', { method: 'PUT', body: JSON.stringify(patch) });
        toast('Configuration persisted', 'ok');
        loadStatus();
        setTimeout(loadSettings, 1500);
      } catch (err) { 
        toast(err.message, 'error'); 
      } finally {
        btn.disabled = false;
        btn.innerHTML = oldHtml;
        lucide.createIcons();
      }
    });

    $('#test-smtp').addEventListener('click', async () => {
      const btn = $('#test-smtp');
      const oldHtml = btn.innerHTML;
      btn.disabled = true; 
      btn.innerHTML = '<i data-lucide="loader-2" class="lucide-spin" style="width:16px"></i> Testing…';
      lucide.createIcons();
      try {
        const r = await api('/api/settings/email/test', { method: 'POST' });
        toast(r.message, 'ok');
      } catch (err) { toast(err.message, 'error'); }
      finally { btn.disabled = false; btn.innerHTML = oldHtml; lucide.createIcons(); }
    });

    $('#test-imap').addEventListener('click', async () => {
      const btn = $('#test-imap');
      const oldHtml = btn.innerHTML;
      btn.disabled = true; 
      btn.innerHTML = '<i data-lucide="loader-2" class="lucide-spin" style="width:16px"></i> Testing…';
      lucide.createIcons();
      try {
        const r = await api('/api/settings/imap/test', { method: 'POST' });
        toast(r.message, 'ok');
      } catch (err) { toast(err.message, 'error'); }
      finally { btn.disabled = false; btn.innerHTML = oldHtml; lucide.createIcons(); }
    });

    // ── Global App Init ──────────────────────────────────────────
    
    // Auto-spin logic for animated icons (loader)
    const style = document.createElement('style');
    style.innerHTML = `
      .lucide-spin { animation: spin 2s linear infinite; }
      @keyframes spin { 100% { transform: rotate(360deg); } }
    `;
    document.head.appendChild(style);

    async function loadAll() {
      await loadStatus();
      await loadProjects();
      populateModelPresets();
      
      // If we land without auth and token exists, clear UI prompt.
      if(getToken()) {
        $('#auth').style.display = 'none';
      }
    }

    // Bootstrap app
    loadAll();
    
    // Regular health heartbeats
    setInterval(loadStatus, 10000);