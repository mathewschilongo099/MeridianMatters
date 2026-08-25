// Admin dashboard: talks directly to the GitHub REST API from the browser.
// The token lives only in localStorage on this device.
(function () {
  const OWNER = 'mathewschilongo099';
  const REPO = 'MeridianMatters';
  const BRANCH = 'main';
  const ARTICLES_PATH = 'data/articles.json';
  const CATEGORIES_PATH = 'data/categories.json';
  const SETTINGS_PATH = 'data/settings.json';
  const PAGES_PATH = 'data/pages.json';
  const GENERATE_WORKFLOW_NAME = 'Generate Articles';
  const TOKEN_KEY = 'mm_admin_token';

  // ---- DOM refs ----
  const loginSection = document.getElementById('login-section');
  const dashboardSection = document.getElementById('dashboard-section');
  const tokenInput = document.getElementById('token-input');
  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const msgArea = document.getElementById('msg-area');

  const tabsEl = document.getElementById('admin-tabs');
  const statGrid = document.getElementById('stat-grid');
  const activityFeed = document.getElementById('activity-feed');

  const generateBtn = document.getElementById('generate-btn');
  const newBtn = document.getElementById('new-btn');
  const statusText = document.getElementById('status-text');
  const listEl = document.getElementById('admin-list');

  const editPanel = document.getElementById('edit-panel');
  const editPanelTitle = document.getElementById('edit-panel-title');
  const fTitle = document.getElementById('f-title');
  const fSlug = document.getElementById('f-slug');
  const fSummary = document.getElementById('f-summary');
  const fContent = document.getElementById('f-content');
  const fCategory = document.getElementById('f-category');
  const fSubcategory = document.getElementById('f-subcategory');
  const fTags = document.getElementById('f-tags');
  const fAuthor = document.getElementById('f-author');
  const fImage = document.getElementById('f-image');
  const fStatus = document.getElementById('f-status');
  const fScheduledWrap = document.getElementById('f-scheduled-wrap');
  const fScheduledDate = document.getElementById('f-scheduled-date');
  const fFeatured = document.getElementById('f-featured');
  const fBreaking = document.getElementById('f-breaking');
  const fPinned = document.getElementById('f-pinned');
  const fMetaTitle = document.getElementById('f-meta-title');
  const fMetaDescription = document.getElementById('f-meta-description');
  const saveBtn = document.getElementById('save-btn');
  const duplicateBtn = document.getElementById('duplicate-btn');
  const cancelBtn = document.getElementById('cancel-btn');

  const catListEl = document.getElementById('cat-list');
  const catEditPanel = document.getElementById('cat-edit-panel');
  const catEditTitle = document.getElementById('cat-edit-title');
  const cName = document.getElementById('c-name');
  const cId = document.getElementById('c-id');
  const cDescription = document.getElementById('c-description');
  const cImage = document.getElementById('c-image');
  const cSubcategories = document.getElementById('c-subcategories');
  const newCatBtn = document.getElementById('new-cat-btn');
  const catSaveBtn = document.getElementById('cat-save-btn');
  const catCancelBtn = document.getElementById('cat-cancel-btn');

  const pageListEl = document.getElementById('page-list');
  const pageEditPanel = document.getElementById('page-edit-panel');
  const pageEditTitle = document.getElementById('page-edit-title');
  const pTitle = document.getElementById('p-title');
  const pId = document.getElementById('p-id');
  const pContent = document.getElementById('p-content');
  const newPageBtn = document.getElementById('new-page-btn');
  const pageSaveBtn = document.getElementById('page-save-btn');
  const pageCancelBtn = document.getElementById('page-cancel-btn');

  const sSiteName = document.getElementById('s-site-name');
  const sTagline = document.getElementById('s-tagline');
  const sLogo = document.getElementById('s-logo');
  const sAccent = document.getElementById('s-accent');
  const sMaintenance = document.getElementById('s-maintenance');
  const sMaintenanceMsg = document.getElementById('s-maintenance-msg');
  const settingsSaveBtn = document.getElementById('settings-save-btn');

  // ---- State ----
  let articles = [];
  let categories = [];
  let settings = {};
  let pages = [];
  let shas = { articles: null, categories: null, settings: null, pages: null };
  let editingId = null;      // article being edited, or 'NEW'
  let editingCatId = null;   // category being edited, or 'NEW'
  let editingPageId = null;  // page being edited, or 'NEW'

  function getToken() { return localStorage.getItem(TOKEN_KEY); }

  function showMsg(text, type) {
    msgArea.innerHTML = `<div class="msg ${type}">${text}</div>`;
    if (type === 'success') setTimeout(() => { msgArea.innerHTML = ''; }, 4000);
  }

  function ghHeaders() {
    return {
      Authorization: `Bearer ${getToken()}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    };
  }

  function slugify(str) {
    return (str || '')
      .toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  // ---- Generic GitHub Contents API read/write ----

  async function ghGetFile(path) {
    const res = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`,
      { headers: ghHeaders() }
    );
    if (res.status === 401) throw new Error('Token rejected — check it has Contents: Read and write on this repo.');
    if (res.status === 404) return null; // file doesn't exist yet
    if (!res.ok) throw new Error(`Failed to load ${path} (status ${res.status})`);
    const data = await res.json();
    const decoded = decodeURIComponent(escape(atob(data.content)));
    return { json: JSON.parse(decoded), sha: data.sha };
  }

  async function ghPutFile(path, obj, sha, message) {
    const jsonStr = JSON.stringify(obj, null, 2);
    const encoded = btoa(unescape(encodeURIComponent(jsonStr)));
    const body = { message, content: encoded, branch: BRANCH };
    if (sha) body.sha = sha;

    const res = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`,
      { method: 'PUT', headers: ghHeaders(), body: JSON.stringify(body) }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Save to ${path} failed (status ${res.status})`);
    }
    const data = await res.json();
    return data.content.sha;
  }

  async function saveArticles(message) {
    shas.articles = await ghPutFile(ARTICLES_PATH, { articles }, shas.articles, message);
  }
  async function saveCategories(message) {
    shas.categories = await ghPutFile(CATEGORIES_PATH, { categories }, shas.categories, message);
  }
  async function saveSettings(message) {
    shas.settings = await ghPutFile(SETTINGS_PATH, settings, shas.settings, message);
  }
  async function savePages(message) {
    shas.pages = await ghPutFile(PAGES_PATH, { pages }, shas.pages, message);
  }

  // ---- Load everything ----

  async function loadAll() {
    const [articlesRes, categoriesRes, settingsRes, pagesRes] = await Promise.all([
      ghGetFile(ARTICLES_PATH),
      ghGetFile(CATEGORIES_PATH),
      ghGetFile(SETTINGS_PATH),
      ghGetFile(PAGES_PATH),
    ]);

    articles = articlesRes ? (articlesRes.json.articles || []) : [];
    shas.articles = articlesRes ? articlesRes.sha : null;

    categories = categoriesRes ? (categoriesRes.json.categories || []) : [];
    shas.categories = categoriesRes ? categoriesRes.sha : null;

    settings = settingsRes ? settingsRes.json : {
      siteName: 'MeridianMatters', tagline: '', logoUrl: '', accentColor: '#0ea5e9',
      maintenanceMode: false, maintenanceMessage: '',
    };
    shas.settings = settingsRes ? settingsRes.sha : null;

    pages = pagesRes ? (pagesRes.json.pages || []) : [];
    shas.pages = pagesRes ? pagesRes.sha : null;

    // Collect all missing-file warnings into one message instead of
    // overwriting each other — previously only the LAST warning was ever
    // visible, silently hiding earlier ones.
    const missing = [];
    if (!categoriesRes) missing.push('data/categories.json');
    if (!settingsRes) missing.push('data/settings.json');
    if (!pagesRes) missing.push('data/pages.json');
    if (missing.length) {
      showMsg(`Missing from the repo (will be created on first save in each tab): ${missing.join(', ')}`, 'error');
    }
  }

  // ---- Tabs ----

  if (tabsEl) tabsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (!btn) return;
    tabsEl.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'overview') renderOverview();
  });

  // ---- Overview / Dashboard ----

  function renderStatCards() {
    const counts = { draft: 0, review: 0, scheduled: 0, published: 0 };
    articles.forEach(a => {
      const s = a.status || 'published'; // legacy articles with no status = published
      if (counts[s] !== undefined) counts[s]++;
    });

    const cards = [
      { label: 'Total Articles', num: articles.length },
      { label: 'Published', num: counts.published },
      { label: 'Draft', num: counts.draft },
      { label: 'In Review', num: counts.review },
      { label: 'Scheduled', num: counts.scheduled },
      { label: 'Categories', num: categories.length },
    ];

    statGrid.innerHTML = cards.map(c => `
      <div class="stat-card">
        <span class="num">${c.num}</span>
        <span class="label">${c.label}</span>
      </div>
    `).join('') + `
      <div class="stat-card cta">
        <span class="label">📊 Page views need Google Analytics — ask to have it wired up</span>
      </div>
    `;
  }

  async function renderActivityFeed() {
    activityFeed.innerHTML = '<p class="empty">Loading…</p>';
    try {
      const res = await fetch(
        `https://api.github.com/repos/${OWNER}/${REPO}/commits?path=${ARTICLES_PATH}&per_page=10`,
        { headers: ghHeaders() }
      );
      if (!res.ok) throw new Error('Could not load activity');
      const commits = await res.json();

      if (!commits.length) {
        activityFeed.innerHTML = '<p class="empty">No activity yet.</p>';
        return;
      }

      activityFeed.innerHTML = commits.map(c => {
        const msg = (c.commit.message || '').split('\n')[0];
        const author = c.commit.author?.name || 'Unknown';
        const date = new Date(c.commit.author?.date || Date.now()).toLocaleString('en-US', {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        });
        return `
          <div class="activity-row">
            <span class="msg-text">${msg}</span>
            <span class="meta">${author} · ${date}</span>
          </div>
        `;
      }).join('');
    } catch (err) {
      activityFeed.innerHTML = `<p class="empty">${err.message}</p>`;
    }
  }

  function renderOverview() {
    renderStatCards();
    renderActivityFeed();
  }

  // ---- Trigger AI generation ----

  async function triggerGeneration() {
    generateBtn.disabled = true;
    generateBtn.textContent = 'Starting…';
    try {
      const listRes = await fetch(
        `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows`,
        { headers: ghHeaders() }
      );
      if (!listRes.ok) throw new Error('Could not list workflows — check the token has Actions: Read and write.');
      const listData = await listRes.json();
      const all = listData.workflows || [];
      const normalize = (s) => (s || '').trim().toLowerCase();
      const workflow = all.find(w => normalize(w.name) === normalize(GENERATE_WORKFLOW_NAME));

      if (!workflow) {
        const available = all.map(w => `"${w.name}"`).join(', ') || 'none';
        throw new Error(`No workflow matching "${GENERATE_WORKFLOW_NAME}" found. Workflows visible to this token: ${available}.`);
      }

      const dispatchRes = await fetch(
        `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${workflow.id}/dispatches`,
        { method: 'POST', headers: ghHeaders(), body: JSON.stringify({ ref: BRANCH }) }
      );

      if (dispatchRes.status === 204) {
        showMsg('Article generation started. Refresh in 1-2 minutes to see it.', 'success');
      } else if (dispatchRes.status === 422) {
        throw new Error('This workflow has no manual trigger. Add "workflow_dispatch: {}" under "on:" in its yaml file.');
      } else {
        throw new Error(`Dispatch failed (status ${dispatchRes.status})`);
      }
    } catch (err) {
      showMsg(err.message, 'error');
    } finally {
      generateBtn.disabled = false;
      generateBtn.textContent = '+ Generate with AI';
    }
  }

  // ---- Articles list ----

  function categoryLabel(id) {
    const cat = categories.find(c => c.id === id);
    return cat ? cat.name : id;
  }

  function populateCategorySelect() {
    fCategory.innerHTML = categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('')
      || '<option value="news">Global News</option>';
  }

  function populateSubcategorySelect(categoryId) {
    const cat = categories.find(c => c.id === categoryId);
    const subs = cat ? (cat.subcategories || []) : [];
    fSubcategory.innerHTML = '<option value="">— none —</option>' +
      subs.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  }

  if (fCategory) fCategory.addEventListener('change', () => populateSubcategorySelect(fCategory.value));
  if (fStatus) fStatus.addEventListener('change', () => {
    fScheduledWrap.style.display = fStatus.value === 'scheduled' ? 'block' : 'none';
  });

  function renderList() {
    if (!articles.length) {
      listEl.innerHTML = '<p class="empty">No articles yet.</p>';
      statusText.textContent = '0 articles';
      return;
    }
    const sorted = [...articles].sort((a, b) => new Date(b.date || b.scheduledDate || 0) - new Date(a.date || a.scheduledDate || 0));
    statusText.textContent = `${articles.length} article${articles.length === 1 ? '' : 's'}`;

    listEl.innerHTML = sorted.map(a => {
      const status = a.status || 'published';
      return `
      <div class="admin-row" data-id="${a.id}">
        <div class="info">
          <span class="cat">${categoryLabel(a.category)}</span>
          <h3>${a.title}</h3>
          <div class="meta">
            <span class="badge status-${status}">${status}</span>
            ${a.breaking ? '<span class="badge flag-breaking">Breaking</span>' : ''}
            ${a.pinned ? '<span class="badge flag-pinned">Pinned</span>' : ''}
            ${a.date || a.scheduledDate || ''} · By ${a.author || 'Unknown'}
          </div>
        </div>
        <div class="actions">
          <button class="btn secondary" data-action="edit" data-id="${a.id}">Edit</button>
          <button class="btn secondary" data-action="duplicate" data-id="${a.id}">Duplicate</button>
          <button class="btn secondary" data-action="feature" data-id="${a.id}">${a.featured ? 'Unfeature' : 'Feature'}</button>
          <button class="btn danger" data-action="delete" data-id="${a.id}">Delete</button>
        </div>
      </div>
    `;
    }).join('');
  }

  if (listEl) listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    if (action === 'edit') openEdit(id);
    if (action === 'delete') handleDelete(id);
    if (action === 'feature') handleToggleFeature(id);
    if (action === 'duplicate') handleDuplicate(id);
  });

  function fillForm(article) {
    fTitle.value = article.title || '';
    fSlug.value = article.id || '';
    fSummary.value = article.summary || '';
    fContent.value = article.content || '';
    populateCategorySelect();
    fCategory.value = article.category || (categories[0] && categories[0].id) || 'news';
    populateSubcategorySelect(fCategory.value);
    fSubcategory.value = article.subcategory || '';
    fTags.value = (article.tags || []).join(', ');
    fAuthor.value = article.author || '';
    fImage.value = article.image || '';
    fStatus.value = article.status || 'published';
    fScheduledWrap.style.display = fStatus.value === 'scheduled' ? 'block' : 'none';
    fScheduledDate.value = article.scheduledDate || '';
    fFeatured.checked = !!article.featured;
    fBreaking.checked = !!article.breaking;
    fPinned.checked = !!article.pinned;
    fMetaTitle.value = article.metaTitle || '';
    fMetaDescription.value = article.metaDescription || '';
  }

  function openEdit(id) {
    const article = articles.find(a => a.id === id);
    if (!article) return;
    editingId = id;
    editPanelTitle.textContent = 'Edit Article';
    duplicateBtn.style.display = 'none';
    fillForm(article);
    editPanel.classList.add('open');
    editPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function openNew() {
    editingId = 'NEW';
    editPanelTitle.textContent = 'New Article';
    duplicateBtn.style.display = 'none';
    fillForm({ status: 'draft' });
    fSlug.value = '';
    editPanel.classList.add('open');
    editPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    fTitle.focus();
  }

  async function handleDuplicate(id) {
    const article = articles.find(a => a.id === id);
    if (!article) return;
    let newId = slugify(article.title) + '-copy';
    if (articles.some(a => a.id === newId)) newId += '-' + Date.now().toString(36).slice(-4);

    const copy = { ...article, id: newId, title: article.title + ' (Copy)', status: 'draft', featured: false };
    articles.push(copy);
    try {
      await saveArticles(`Admin: duplicate "${article.title}"`);
      showMsg('Duplicated as a new draft.', 'success');
      renderList();
    } catch (err) {
      showMsg(err.message, 'error');
    }
  }

  if (cancelBtn) cancelBtn.addEventListener('click', () => {
    editPanel.classList.remove('open');
    editingId = null;
  });

  if (saveBtn) saveBtn.addEventListener('click', async () => {
    if (!editingId) return;
    const title = fTitle.value.trim();
    if (!title) { showMsg('Title is required.', 'error'); return; }

    const status = fStatus.value;
    const scheduledDate = fScheduledDate.value;
    const tags = fTags.value.split(',').map(t => t.trim()).filter(Boolean);

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const common = {
        title,
        summary: fSummary.value.trim(),
        content: fContent.value.trim(),
        category: fCategory.value,
        subcategory: fSubcategory.value || '',
        tags,
        author: fAuthor.value.trim() || 'MeridianMatters',
        image: fImage.value.trim(),
        status,
        scheduledDate: status === 'scheduled' ? scheduledDate : '',
        featured: fFeatured.checked,
        breaking: fBreaking.checked,
        pinned: fPinned.checked,
        metaTitle: fMetaTitle.value.trim(),
        metaDescription: fMetaDescription.value.trim(),
      };

      if (editingId === 'NEW') {
        let id = slugify(fSlug.value.trim() || title);
        if (articles.some(a => a.id === id)) id += '-' + Date.now().toString(36).slice(-4);
        const date = status === 'published' ? new Date().toISOString().split('T')[0] : (scheduledDate || '');
        articles.push({ id, date, ...common });
        await saveArticles(`Admin: create "${title}"`);
      } else {
        const idx = articles.findIndex(a => a.id === editingId);
        if (idx === -1) throw new Error('Article no longer exists — it may have been deleted elsewhere.');
        const newSlug = slugify(fSlug.value.trim() || title);
        let date = articles[idx].date;
        // If moving into "published" for the first time, stamp today's date.
        if (status === 'published' && articles[idx].status !== 'published' && !date) {
          date = new Date().toISOString().split('T')[0];
        }
        articles[idx] = { ...articles[idx], id: newSlug, date, ...common };
        await saveArticles(`Admin: update "${title}"`);
      }

      showMsg('Saved.', 'success');
      editPanel.classList.remove('open');
      editingId = null;
      renderList();
    } catch (err) {
      showMsg(err.message, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
  });

  async function handleDelete(id) {
    const article = articles.find(a => a.id === id);
    if (!article) return;
    if (!confirm(`Delete "${article.title}"? This cannot be undone.`)) return;
    try {
      articles = articles.filter(a => a.id !== id);
      await saveArticles(`Admin: delete "${article.title}"`);
      showMsg('Deleted.', 'success');
      renderList();
    } catch (err) {
      showMsg(err.message, 'error');
    }
  }

  async function handleToggleFeature(id) {
    const idx = articles.findIndex(a => a.id === id);
    if (idx === -1) return;
    try {
      articles[idx].featured = !articles[idx].featured;
      await saveArticles(`Admin: toggle featured on "${articles[idx].title}"`);
      showMsg('Updated.', 'success');
      renderList();
    } catch (err) {
      showMsg(err.message, 'error');
    }
  }

  // ---- Categories ----

  function renderCategories() {
    const sorted = [...categories].sort((a, b) => (a.order || 0) - (b.order || 0));
    if (!sorted.length) {
      catListEl.innerHTML = '<p class="empty">No categories yet.</p>';
      return;
    }
    catListEl.innerHTML = sorted.map((c, i) => `
      <div class="cat-row" data-id="${c.id}">
        <div class="cat-head">
          <div>
            <h3>${c.name}</h3>
            <p>${c.description || ''}</p>
          </div>
          <div class="cat-order-btns">
            <button data-cat-action="up" data-id="${c.id}" ${i === 0 ? 'disabled' : ''}>▲</button>
            <button data-cat-action="down" data-id="${c.id}" ${i === sorted.length - 1 ? 'disabled' : ''}>▼</button>
          </div>
        </div>
        ${(c.subcategories || []).length ? `
          <div class="sub-list">
            ${c.subcategories.map(s => `<div class="sub-item"><span>${s.name}</span></div>`).join('')}
          </div>` : ''}
        <div class="edit-actions" style="margin-top:0.75rem;">
          <button class="btn secondary" data-cat-action="edit" data-id="${c.id}">Edit</button>
          <button class="btn danger" data-cat-action="delete" data-id="${c.id}">Delete</button>
        </div>
      </div>
    `).join('');
  }

  if (catListEl) catListEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-cat-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.catAction;
    if (action === 'edit') openCatEdit(id);
    if (action === 'delete') handleCatDelete(id);
    if (action === 'up') handleCatReorder(id, -1);
    if (action === 'down') handleCatReorder(id, 1);
  });

  function openCatEdit(id) {
    const cat = categories.find(c => c.id === id);
    if (!cat) return;
    editingCatId = id;
    catEditTitle.textContent = 'Edit Category';
    cName.value = cat.name || '';
    cId.value = cat.id || '';
    cDescription.value = cat.description || '';
    cImage.value = cat.image || '';
    cSubcategories.value = (cat.subcategories || []).map(s => s.name).join(', ');
    catEditPanel.classList.add('open');
    catEditPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (newCatBtn) newCatBtn.addEventListener('click', () => {
    editingCatId = 'NEW';
    catEditTitle.textContent = 'New Category';
    cName.value = ''; cId.value = ''; cDescription.value = ''; cImage.value = ''; cSubcategories.value = '';
    catEditPanel.classList.add('open');
    catEditPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    cName.focus();
  });

  if (catCancelBtn) catCancelBtn.addEventListener('click', () => {
    catEditPanel.classList.remove('open');
    editingCatId = null;
  });

  if (catSaveBtn) catSaveBtn.addEventListener('click', async () => {
    const name = cName.value.trim();
    if (!name) { showMsg('Category name is required.', 'error'); return; }

    const id = slugify(cId.value.trim() || name);
    const subcategories = cSubcategories.value.split(',').map(s => s.trim()).filter(Boolean)
      .map(s => ({ id: slugify(s), name: s }));

    catSaveBtn.disabled = true;
    try {
      if (editingCatId === 'NEW') {
        if (categories.some(c => c.id === id)) throw new Error('A category with that ID already exists.');
        categories.push({
          id, name, description: cDescription.value.trim(), image: cImage.value.trim(),
          order: categories.length + 1, subcategories,
        });
        await saveCategories(`Admin: create category "${name}"`);
      } else {
        const idx = categories.findIndex(c => c.id === editingCatId);
        if (idx === -1) throw new Error('Category no longer exists.');
        categories[idx] = { ...categories[idx], id, name, description: cDescription.value.trim(), image: cImage.value.trim(), subcategories };
        await saveCategories(`Admin: update category "${name}"`);
      }
      showMsg('Saved.', 'success');
      catEditPanel.classList.remove('open');
      editingCatId = null;
      renderCategories();
      populateCategorySelect();
    } catch (err) {
      showMsg(err.message, 'error');
    } finally {
      catSaveBtn.disabled = false;
    }
  });

  async function handleCatDelete(id) {
    const cat = categories.find(c => c.id === id);
    if (!cat) return;
    const inUse = articles.some(a => a.category === id);
    const warning = inUse
      ? `"${cat.name}" is used by existing articles. Deleting it won't delete those articles, but they'll show an unlabeled category. Continue?`
      : `Delete category "${cat.name}"?`;
    if (!confirm(warning)) return;
    try {
      categories = categories.filter(c => c.id !== id);
      await saveCategories(`Admin: delete category "${cat.name}"`);
      showMsg('Deleted.', 'success');
      renderCategories();
      populateCategorySelect();
    } catch (err) {
      showMsg(err.message, 'error');
    }
  }

  async function handleCatReorder(id, direction) {
    const sorted = [...categories].sort((a, b) => (a.order || 0) - (b.order || 0));
    const idx = sorted.findIndex(c => c.id === id);
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;

    [sorted[idx].order, sorted[swapIdx].order] = [sorted[swapIdx].order || swapIdx + 1, sorted[idx].order || idx + 1];
    categories = sorted;
    try {
      await saveCategories('Admin: reorder categories');
      renderCategories();
    } catch (err) {
      showMsg(err.message, 'error');
    }
  }

  // ---- Pages ----

  function renderPages() {
    if (!pageListEl) throw new Error('page-list element not found in the HTML — admin.html may be out of date');
    if (!pages.length) {
      pageListEl.innerHTML = '<p class="empty">No pages yet.</p>';
      return;
    }
    pageListEl.innerHTML = pages.map(p => `
      <div class="cat-row" data-id="${p.id}">
        <div class="cat-head">
          <div>
            <h3>${p.title}</h3>
            <p>/page.html?slug=${p.id}</p>
          </div>
        </div>
        <div class="edit-actions" style="margin-top:0.75rem;">
          <button class="btn secondary" data-page-action="edit" data-id="${p.id}">Edit</button>
          <button class="btn danger" data-page-action="delete" data-id="${p.id}">Delete</button>
        </div>
      </div>
    `).join('');
  }

  if (pageListEl) pageListEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-page-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.pageAction;
    if (action === 'edit') openPageEdit(id);
    if (action === 'delete') handlePageDelete(id);
  });

  function openPageEdit(id) {
    const page = pages.find(p => p.id === id);
    if (!page) return;
    editingPageId = id;
    pageEditTitle.textContent = 'Edit Page';
    pTitle.value = page.title || '';
    pId.value = page.id || '';
    pContent.value = page.content || '';
    pageEditPanel.classList.add('open');
    pageEditPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (newPageBtn) newPageBtn.addEventListener('click', () => {
    editingPageId = 'NEW';
    pageEditTitle.textContent = 'New Page';
    pTitle.value = ''; pId.value = ''; pContent.value = '';
    pageEditPanel.classList.add('open');
    pageEditPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    pTitle.focus();
  });

  if (pageCancelBtn) pageCancelBtn.addEventListener('click', () => {
    pageEditPanel.classList.remove('open');
    editingPageId = null;
  });

  if (pageSaveBtn) pageSaveBtn.addEventListener('click', async () => {
    const title = pTitle.value.trim();
    if (!title) { showMsg('Page title is required.', 'error'); return; }
    const id = slugify(pId.value.trim() || title);
    const content = pContent.value.trim();

    pageSaveBtn.disabled = true;
    try {
      if (editingPageId === 'NEW') {
        if (pages.some(p => p.id === id)) throw new Error('A page with that ID already exists.');
        pages.push({ id, title, content, order: pages.length + 1 });
        await savePages(`Admin: create page "${title}"`);
      } else {
        const idx = pages.findIndex(p => p.id === editingPageId);
        if (idx === -1) throw new Error('Page no longer exists.');
        pages[idx] = { ...pages[idx], id, title, content };
        await savePages(`Admin: update page "${title}"`);
      }
      showMsg('Saved.', 'success');
      pageEditPanel.classList.remove('open');
      editingPageId = null;
      renderPages();
    } catch (err) {
      showMsg(err.message, 'error');
    } finally {
      pageSaveBtn.disabled = false;
    }
  });

  async function handlePageDelete(id) {
    const page = pages.find(p => p.id === id);
    if (!page) return;
    if (!confirm(`Delete "${page.title}"? This cannot be undone.`)) return;
    try {
      pages = pages.filter(p => p.id !== id);
      await savePages(`Admin: delete page "${page.title}"`);
      showMsg('Deleted.', 'success');
      renderPages();
    } catch (err) {
      showMsg(err.message, 'error');
    }
  }

  // ---- Settings ----

  function fillSettingsForm() {
    sSiteName.value = settings.siteName || '';
    sTagline.value = settings.tagline || '';
    sLogo.value = settings.logoUrl || '';
    sAccent.value = settings.accentColor || '#0ea5e9';
    sMaintenance.checked = !!settings.maintenanceMode;
    sMaintenanceMsg.value = settings.maintenanceMessage || '';
  }

  if (settingsSaveBtn) settingsSaveBtn.addEventListener('click', async () => {
    settingsSaveBtn.disabled = true;
    settingsSaveBtn.textContent = 'Saving…';
    try {
      settings = {
        siteName: sSiteName.value.trim(),
        tagline: sTagline.value.trim(),
        logoUrl: sLogo.value.trim(),
        accentColor: sAccent.value,
        maintenanceMode: sMaintenance.checked,
        maintenanceMessage: sMaintenanceMsg.value.trim(),
      };
      await saveSettings('Admin: update site settings');
      showMsg('Settings saved. Changes apply on next page load across the site.', 'success');
    } catch (err) {
      showMsg(err.message, 'error');
    } finally {
      settingsSaveBtn.disabled = false;
      settingsSaveBtn.textContent = 'Save Settings';
    }
  });

  // ---- Auth flow ----

  // Runs a render step in isolation — if one tab's rendering throws (a bug
  // in that tab specifically), it no longer takes down the whole session
  // or hides the other tabs, which were working fine.
  function safeRender(label, fn) {
    try {
      fn();
    } catch (err) {
      console.error(`${label} failed to render:`, err);
      showMsg(`${label} failed to load: ${err.message}`, 'error');
    }
  }

  async function connect() {
    try {
      await loadAll();
      loginSection.style.display = 'none';
      dashboardSection.style.display = 'block';
      logoutBtn.style.display = 'inline-flex';
      populateCategorySelect();
    } catch (err) {
      showMsg(err.message, 'error');
      localStorage.removeItem(TOKEN_KEY);
      return;
    }

    // Each tab renders independently now — a failure in one won't wipe
    // the session or block the others from showing correctly.
    safeRender('Dashboard', renderOverview);
    safeRender('Articles', renderList);
    safeRender('Categories', renderCategories);
    safeRender('Settings', fillSettingsForm);
    safeRender('Pages', renderPages);
  }

  loginBtn.addEventListener('click', () => {
    const token = tokenInput.value.trim();
    if (!token) return;
    localStorage.setItem(TOKEN_KEY, token);
    connect();
  });

  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem(TOKEN_KEY);
    dashboardSection.style.display = 'none';
    logoutBtn.style.display = 'none';
    loginSection.style.display = 'block';
    tokenInput.value = '';
  });

  if (generateBtn) generateBtn.addEventListener('click', triggerGeneration);
  if (newBtn) newBtn.addEventListener('click', openNew);

  document.addEventListener('DOMContentLoaded', () => {
    if (getToken()) connect();
  });
})();
