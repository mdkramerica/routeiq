/**
 * Dashboard app logic — tabs, today, accounts, plan, profile
 */

(function () {
  const auth = requireAuth();
  if (!auth) return;
  const { token, user } = auth;

  initOfflineDetection();

  // ══════════════════════════════════════════════════════════════════════════
  // TAB NAVIGATION
  // ══════════════════════════════════════════════════════════════════════════
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');

  function switchTab(name) {
    const tab = document.querySelector(`.tab[data-tab="${name}"]`);
    if (tab) tab.click();
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach((t) => t.classList.remove('active'));
      tabContents.forEach((tc) => tc.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${target}`).classList.add('active');
      if (target === 'accounts') {
        showAccountsListView();
      }
    });
  });

  // Set topbar date
  document.getElementById('topbar-date').textContent = new Date().toLocaleDateString(
    'en-US',
    { weekday: 'short', month: 'short', day: 'numeric' }
  );

  // ══════════════════════════════════════════════════════════════════════════
  // TODAY TAB
  // ══════════════════════════════════════════════════════════════════════════
  let todayStops = [];

  async function loadToday() {
    const container = document.getElementById('today-stops');
    container.innerHTML =
      '<div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div>';

    try {
      const res = await apiFetch('/api/route/today');
      if (!res) return;
      const data = await res.json();
      todayStops = data.stops || [];

      if (!todayStops.length) {
        container.innerHTML =
          '<div class="empty-state"><p>No route planned for today.</p><button class="btn btn-accent" id="plan-route-cta">Plan a Route</button></div>';
        document.getElementById('plan-route-cta').addEventListener('click', () => switchTab('plan'));
        document.getElementById('start-route-btn').style.display = 'none';
        document.getElementById('today-sub').textContent = 'No stops scheduled';
        return;
      }

      document.getElementById('today-sub').textContent = `${todayStops.length} stops`;
      document.getElementById('start-route-btn').style.display = 'block';
      container.innerHTML = todayStops
        .map(
          (s, i) => `
        <div class="card stop-card" data-id="${esc(s.id)}">
          <div class="stop-header">
            <div class="stop-num">${i + 1}</div>
            <div>
              <div class="stop-name">${esc(s.name)}</div>
              <div class="stop-meta">${s.contact_name ? esc(s.contact_name) + ' · ' : ''}Last visit: ${formatDate(s.last_visited)}</div>
            </div>
          </div>
          <div class="stop-actions">
            <button class="btn btn-green btn-sm" data-action="visit" data-id="${esc(s.id)}">Mark Visited</button>
            <button class="btn btn-outline btn-sm" data-action="brief" data-id="${esc(s.id)}">Brief</button>
            <button class="btn btn-outline btn-sm" data-action="voice" data-id="${esc(s.id)}" data-name="${escAttr(s.name)}">Voice Log</button>
          </div>
          <div class="brief-box" id="brief-${esc(s.id)}"></div>
        </div>`
        )
        .join('');

      container.addEventListener('click', handleStopAction);
    } catch (err) {
      console.error('loadToday error:', err);
      container.innerHTML =
        '<div class="empty-state"><p>Could not load today\'s route.</p></div>';
      document.getElementById('today-sub').textContent = '';
    }
  }

  async function handleStopAction(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const id = btn.dataset.id;

    if (action === 'visit') {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>';
      await apiFetch(`/api/accounts/${id}/visit`, { method: 'POST' });
      btn.textContent = 'Visited';
      btn.classList.remove('btn-green');
      btn.classList.add('btn-outline');
      btn.style.opacity = '0.6';
      toast('Visit logged');
    } else if (action === 'brief') {
      const box = document.getElementById(`brief-${id}`);
      if (box.style.display === 'block') {
        box.style.display = 'none';
        return;
      }
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>';
      try {
        const res = await apiFetch('/api/brief/generate', {
          method: 'POST',
          body: JSON.stringify({ accountId: id }),
        });
        if (!res) return;
        const data = await res.json();
        box.innerHTML = `<div class="brief-tag">AI Walk-in Brief</div>${esc(data.brief)}`;
        box.style.display = 'block';
      } catch {
        toast('Could not generate brief');
      }
      btn.disabled = false;
      btn.textContent = 'Brief';
    } else if (action === 'voice') {
      openVoiceLog(id, btn.dataset.name);
    }
  }

  document.getElementById('start-route-btn').addEventListener('click', () => {
    if (!todayStops.length) return;
    const waypoints = todayStops.filter((s) => s.lat && s.lng);
    if (!waypoints.length) {
      toast('No geocoded stops');
      return;
    }
    const origin = `${waypoints[0].lat},${waypoints[0].lng}`;
    const dest = `${waypoints[waypoints.length - 1].lat},${waypoints[waypoints.length - 1].lng}`;
    const mid = waypoints
      .slice(1, -1)
      .map((s) => `${s.lat},${s.lng}`)
      .join('|');
    let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}`;
    if (mid) url += `&waypoints=${mid}`;
    window.open(url, '_blank');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ACCOUNTS TAB
  // ══════════════════════════════════════════════════════════════════════════
  let allAccounts = [];
  let accountsLoaded = null;

  function showAccountsListView() {
    document.getElementById('accounts-list-view').style.display = 'block';
    document.getElementById('account-detail').style.display = 'none';
    document.getElementById('add-form').style.display = 'none';
    document.getElementById('import-form-view').style.display = 'none';
  }

  function showAddForm() {
    document.getElementById('add-form').style.display = 'block';
    document.getElementById('import-form-view').style.display = 'none';
    document.getElementById('accounts-list-view').style.display = 'none';
    document.getElementById('account-detail').style.display = 'none';
    document.getElementById('add-error').style.display = 'none';
  }

  function showImportForm() {
    document.getElementById('import-form-view').style.display = 'block';
    document.getElementById('add-form').style.display = 'none';
    document.getElementById('accounts-list-view').style.display = 'none';
    document.getElementById('account-detail').style.display = 'none';
    document.getElementById('import-error').style.display = 'none';
  }

  // Wire up buttons
  document.getElementById('btn-add-account').addEventListener('click', showAddForm);
  document.getElementById('btn-import-csv').addEventListener('click', showImportForm);
  document.getElementById('btn-cancel-add').addEventListener('click', showAccountsListView);
  document.getElementById('btn-cancel-import').addEventListener('click', showAccountsListView);

  async function loadAccounts() {
    if (accountsLoaded) return accountsLoaded;
    accountsLoaded = _loadAccounts();
    return accountsLoaded;
  }

  async function _loadAccounts() {
    try {
      const res = await apiFetch('/api/accounts');
      if (!res) return;
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        console.error('loadAccounts API error:', res.status, errData);
        throw new Error(errData.error || 'Failed to load accounts');
      }
      const data = await res.json();
      allAccounts = data.accounts || data;
      if (!Array.isArray(allAccounts)) allAccounts = [];
      renderAccountsList(allAccounts);
    } catch (err) {
      console.error('loadAccounts error:', err);
      document.getElementById('accounts-list').innerHTML =
        '<div class="empty-state"><p>Could not load accounts. Check your connection and refresh.</p></div>';
    }
  }

  function renderAccountsList(accounts) {
    const list = document.getElementById('accounts-list');
    if (!accounts.length) {
      list.innerHTML =
        '<div class="empty-state" style="padding:2rem 1rem;"><p>No accounts yet.</p><p style="font-size:0.8rem;">Use the buttons above to add an account or import from CSV.</p></div>';
      return;
    }
    list.innerHTML = accounts
      .map(
        (a) => `
      <div class="account-item" data-id="${esc(a.id)}">
        <div>
          <div class="account-name">${esc(a.name)} ${priorityBadge(a.priority)}</div>
          <div class="account-sub">${a.contact_name ? esc(a.contact_name) + ' · ' : ''}Last visit: ${formatDate(a.last_visited)}</div>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>`
      )
      .join('');

    list.querySelectorAll('.account-item').forEach((item) => {
      item.addEventListener('click', () => showAccountDetail(item.dataset.id));
    });
  }

  document.getElementById('account-search').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    renderAccountsList(
      allAccounts.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          (a.contact_name || '').toLowerCase().includes(q)
      )
    );
  });

  async function showAccountDetail(id) {
    const account = allAccounts.find((a) => a.id === id);
    if (!account) return;
    document.getElementById('accounts-list-view').style.display = 'none';
    document.getElementById('add-form').style.display = 'none';
    document.getElementById('import-form-view').style.display = 'none';
    const detail = document.getElementById('account-detail');
    detail.style.display = 'block';

    document.getElementById('detail-name').textContent = account.name;
    document.getElementById('detail-meta').innerHTML = `
      ${esc(account.contact_name) || 'No contact'} · ${esc(account.address) || 'No address'}<br/>
      Priority: ${priorityBadge(account.priority)} · Last visited: ${formatDate(account.last_visited)}
      ${account.notes ? '<br/>Notes: ' + esc(account.notes) : ''}
    `;

    const logsDiv = document.getElementById('detail-logs');
    logsDiv.innerHTML =
      '<div style="color:var(--muted); font-size:0.82rem;">Loading logs...</div>';
    try {
      const res = await apiFetch(`/api/accounts/${id}/logs`);
      if (!res) return;
      const logs = await res.json();
      if (!logs.length) {
        logsDiv.innerHTML =
          '<div style="color:var(--muted); font-size:0.82rem;">No call logs yet.</div>';
        return;
      }
      logsDiv.innerHTML = logs
        .map(
          (l) => `
        <div class="log-entry">
          <div class="log-date">${new Date(l.created_at).toLocaleString()}</div>
          <div class="log-summary">${esc(l.summary || l.transcript || '')}</div>
          ${l.outcome ? `<span class="log-outcome" style="background:rgba(108,99,255,0.12); color:var(--accent2);">${esc(l.outcome)}</span>` : ''}
        </div>`
        )
        .join('');
    } catch {
      logsDiv.innerHTML =
        '<div style="color:var(--muted); font-size:0.82rem;">Could not load logs.</div>';
    }
  }

  document.getElementById('detail-back').addEventListener('click', showAccountsListView);

  // ─── Add Account Form ──────────────────────────────────────────────────

  document.getElementById('add-account-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('add-error');
    errorEl.style.display = 'none';

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Saving...';

    try {
      const body = {
        name: document.getElementById('add-name').value.trim(),
        address: document.getElementById('add-address').value.trim(),
        contact_name: document.getElementById('add-contact').value.trim(),
        contact_email: document.getElementById('add-email').value.trim(),
        priority: parseInt(document.getElementById('add-priority').value, 10),
        notes: document.getElementById('add-notes').value.trim(),
      };

      if (!body.name) {
        errorEl.textContent = 'Account name is required.';
        errorEl.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Save Account';
        return;
      }

      const res = await apiFetch('/api/accounts', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      if (!res) return;

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to add account');
      }

      toast('Account added');
      document.getElementById('add-account-form').reset();
      showAccountsListView();
      accountsLoaded = null;
      await loadAccounts();
    } catch (err) {
      console.error('Add account error:', err);
      errorEl.textContent = err.message || 'Error adding account. Please try again.';
      errorEl.style.display = 'block';
    }

    submitBtn.disabled = false;
    submitBtn.textContent = 'Save Account';
  });

  // ─── CSV Import ────────────────────────────────────────────────────────

  const importForm = document.getElementById('import-form');
  if (importForm) {
    importForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = document.getElementById('import-error');
      errorEl.style.display = 'none';

      const fileInput = document.getElementById('import-file');
      if (!fileInput.files.length) {
        errorEl.textContent = 'Please select a CSV file first.';
        errorEl.style.display = 'block';
        return;
      }

      const formData = new FormData();
      formData.append('file', fileInput.files[0]);

      const btn = importForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Importing...';

      try {
        const res = await fetch(`${API}/api/accounts/import`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Import failed');
        }

        const data = await res.json();
        toast(`Imported ${data.imported} accounts`);
        fileInput.value = '';
        showAccountsListView();
        accountsLoaded = null;
        await loadAccounts();
      } catch (err) {
        console.error('CSV import error:', err);
        errorEl.textContent = err.message || 'Import failed. Please check your CSV file.';
        errorEl.style.display = 'block';
      }

      btn.disabled = false;
      btn.textContent = 'Upload & Import';
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PLAN TAB
  // ══════════════════════════════════════════════════════════════════════════
  const planDate = document.getElementById('plan-date');
  planDate.value = new Date().toISOString().split('T')[0];

  async function loadPlanAccounts() {
    const container = document.getElementById('plan-checklist');
    await loadAccounts();

    if (!allAccounts.length) {
      container.innerHTML =
        '<div style="padding:1rem; color:var(--muted); font-size:0.85rem; text-align:center;">No accounts yet. Add accounts first from the Accounts tab.</div>';
      return;
    }

    const today = new Date();
    container.innerHTML = allAccounts
      .map((a) => {
        let overdue = false;
        if (a.last_visited && a.visit_frequency_days) {
          const due = new Date(a.last_visited);
          due.setDate(due.getDate() + a.visit_frequency_days);
          overdue = due <= today;
        } else if (!a.last_visited) {
          overdue = true;
        }
        return `
        <label class="checklist-item ${overdue ? 'overdue' : ''}">
          <input type="checkbox" value="${esc(a.id)}" ${overdue ? 'checked' : ''} />
          <span>
            ${esc(a.name)} ${priorityBadge(a.priority)}
            ${overdue ? '<span class="overdue-tag">Overdue</span>' : ''}
          </span>
        </label>`;
      })
      .join('');
  }

  function getSelectedAccountIds() {
    return [
      ...document.querySelectorAll('#plan-checklist input[type="checkbox"]:checked'),
    ].map((cb) => cb.value);
  }

  document.getElementById('plan-optimize-btn').addEventListener('click', async () => {
    const ids = getSelectedAccountIds();
    if (!ids.length) {
      toast('Select at least one account');
      return;
    }
    const btn = document.getElementById('plan-optimize-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Optimizing';
    try {
      let startLat = 0;
      let startLng = 0;
      if (navigator.geolocation) {
        try {
          const pos = await new Promise((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
          );
          startLat = pos.coords.latitude;
          startLng = pos.coords.longitude;
        } catch {
          // Use default 0,0
        }
      }
      const res = await apiFetch('/api/route/optimize', {
        method: 'POST',
        body: JSON.stringify({
          accountIds: ids,
          startLat,
          startLng,
          plan_date: planDate.value,
        }),
      });
      if (!res) return;
      const data = await res.json();
      toast(`Route optimized: ${data.stops} stops, ${data.totalMiles} mi`);
    } catch {
      toast('Optimization failed');
    }
    btn.disabled = false;
    btn.textContent = 'Optimize';
  });

  document.getElementById('plan-briefs-btn').addEventListener('click', async () => {
    const ids = getSelectedAccountIds();
    if (!ids.length) {
      toast('Select at least one account');
      return;
    }
    const btn = document.getElementById('plan-briefs-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    try {
      const res = await apiFetch('/api/brief/batch', {
        method: 'POST',
        body: JSON.stringify({ accountIds: ids }),
      });
      if (!res) return;
      const data = await res.json();
      toast(`Generated ${data.generated} briefs`);
    } catch {
      toast('Brief generation failed');
    }
    btn.disabled = false;
    btn.textContent = 'Briefs';
  });

  document.getElementById('plan-save-btn').addEventListener('click', async () => {
    const ids = getSelectedAccountIds();
    if (!ids.length) {
      toast('Select at least one account');
      return;
    }
    const btn = document.getElementById('plan-save-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    try {
      await apiFetch('/api/route/plan', {
        method: 'POST',
        body: JSON.stringify({
          plan_date: planDate.value,
          account_ids: ids,
        }),
      });
      toast('Route plan saved');
    } catch {
      toast('Failed to save plan');
    }
    btn.disabled = false;
    btn.textContent = 'Save Plan';
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PROFILE TAB
  // ══════════════════════════════════════════════════════════════════════════
  function loadProfile() {
    if (!user) return;
    document.getElementById('profile-email').textContent = user.email || '';
    document.getElementById('profile-plan').textContent = user.plan || 'free';
    document.getElementById('profile-avatar').textContent = (user.email || '?')[0].toUpperCase();
  }

  document.getElementById('upgrade-btn').addEventListener('click', async () => {
    const btn = document.getElementById('upgrade-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Redirecting...';
    try {
      const planRadio = document.querySelector('input[name="upgrade-plan"]:checked');
      const plan = planRadio ? planRadio.value : 'solo';

      const res = await apiFetch('/api/stripe/checkout', {
        method: 'POST',
        body: JSON.stringify({ plan }),
      });
      if (!res) return;
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else toast('Could not start checkout');
    } catch {
      toast('Checkout failed');
    }
    btn.disabled = false;
    btn.textContent = 'Upgrade Plan';
  });

  document.getElementById('logout-btn').addEventListener('click', async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Proceed with local logout regardless
    }
    clearAuth();
    window.location.href = 'login.html';
  });

  // ══════════════════════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════════════════════
  loadToday();
  loadAccounts().then(() => loadPlanAccounts());
  loadProfile();
})();
