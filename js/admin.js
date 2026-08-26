// Admin dashboard: talks directly to the GitHub REST API from the browser.
// The token lives only in localStorage on this device — never sent anywhere
// except api.github.com, and never committed to the repo.
(function () {
  const OWNER = 'mathewschilongo099';
  const REPO = 'MeridianMatters';
  const BRANCH = 'main';
  const ARTICLES_PATH = 'data/articles.json';
  const GENERATE_WORKFLOW_NAME = 'Generate Articles';

  const TOKEN_KEY = 'mm_admin_token';

  const loginSection = document.getElementById('login-section');
  const dashboardSection = document.getElementById('dashboard-section');
  const tokenInput = document.getElementById('token-input');
  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const generateBtn = document.getElementById('generate-btn');
  const statusText = document.getElementById('status-text');
  const listEl = document.getElementById('admin-list');
  const msgArea = document.getElementById('msg-area');

  const editPanel = document.getElementById('edit-panel');
  const editPanelTitle = document.getElementById('edit-panel-title');
  const fTitle = document.getElementById('f-title');
  const fSummary = document.getElementById('f-summary');
  const fContent = document.getElementById('f-content');
  const fCategory = document.getElementById('f-category');
  const fAuthor = document.getElementById('f-author');
  const fImage = document.getElementById('f-image');
  const fFeatured = document.getElementById('f-featured');
  const saveBtn = document.getElementById('save-btn');
  const cancelBtn = document.getElementById('cancel-btn');

  let currentSha = null;   // sha of data/articles.json, required to PUT updates
  let articles = [];       // in-memory working copy
  let editingId = null;    // id of article currently being edited, or null = new

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function showMsg(text, type) {
    msgArea.innerHTML = `<div class="msg ${type}">${text}</div>`;
    if (type === 'success') {
      setTimeout(() => { msgArea.innerHTML = ''; }, 4000);
    }
  }

  function ghHeaders() {
    return {
      Authorization: `Bearer ${getToken()}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    };
  }

  // ---- Load / save data/articles.json via the Contents API ----

  async function loadArticles() {
    statusText.textContent = 'Loading articles…';
    const res = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/contents/${ARTICLES_PATH}?ref=${BRANCH}`,
      { headers: ghHeaders() }
    );

    if (res.status === 401) throw new Error('Token rejected — check it has Contents: Read and write on this repo.');
    if (!res.ok) throw new Error(`Failed to load articles.json (status ${res.status})`);

    const data = await res.json();
    currentSha = data.sha;
    const decoded = decodeURIComponent(escape(atob(data.content)));
    const parsed = JSON.parse(decoded);
    articles = parsed.articles || [];
  }

  async function saveArticles(commitMessage) {
    const payload = { articles };
    const jsonStr = JSON.stringify(payload, null, 2);
    const encoded = btoa(unescape(encodeURIComponent(jsonStr)));

    const res = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/contents/${ARTICLES_PATH}`,
      {
        method: 'PUT',
        headers: ghHeaders(),
        body: JSON.stringify({
          message: commitMessage,
          content: encoded,
          sha: currentSha,
          branch: BRANCH,
        }),
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Save failed (status ${res.status})`);
    }

    const data = await res.json();
    currentSha = data.content.sha; // must update sha for the next save
  }

  // ---- Trigger the article-generation workflow ----

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
      const workflow = (listData.workflows || []).find(w => w.name === GENERATE_WORKFLOW_NAME);

      if (!workflow) {
        throw new Error(`No workflow named "${GENERATE_WORKFLOW_NAME}" found. Check the name in your .github/workflows file matches.`);
      }

      const dispatchRes = await fetch(
        `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${workflow.id}/dispatches`,
        {
          method: 'POST',
          headers: ghHeaders(),
          body: JSON.stringify({ ref: BRANCH }),
        }
      );

      if (dispatchRes.status === 204) {
        showMsg('Article generation started. It usually takes 1-2 minutes to appear — refresh this page after that.', 'success');
      } else if (dispatchRes.status === 422) {
        throw new Error('This workflow does not have a manual trigger (workflow_dispatch) enabled. Add "workflow_dispatch: {}" under "on:" in the workflow file.');
      } else {
        throw new Error(`Dispatch failed (status ${dispatchRes.status})`);
      }
    } catch (err) {
      showMsg(err.message, 'error');
    } finally {
      generateBtn.disabled = false;
      generateBtn.textContent = '+ Generate New Article';
    }
  }

  // ---- Rendering ----

  const categoryMap = { news: 'Global News', sports: 'Sports', health: 'Health', finance: 'Finance' };

  function renderList() {
    if (!articles.length) {
      listEl.innerHTML = '<p class="empty">No articles yet.</p>';
      statusText.textContent = '0 articles';
      return;
    }

    const sorted = [...articles].sort((a, b) => new Date(b.date) - new Date(a.date));
    statusText.textContent = `${articles.length} article${articles.length === 1 ? '' : 's'}`;

    listEl.innerHTML = sorted.map(a => `
      <div class="admin-row" data-id="${a.id}">
        <div class="info">
          <span class="cat">${categoryMap[a.category] || a.category}</span>
          ${a.featured ? '<span class="featured-badge">★ Featured</span>' : ''}
          <h3>${a.title}</h3>
          <div class="meta">${a.date || ''} · By ${a.author || 'Unknown'}</div>
        </div>
        <div class="actions">
          <button class="btn secondary" data-action="edit" data-id="${a.id}">Edit</button>
          <button class="btn secondary" data-action="feature" data-id="${a.id}">${a.featured ? 'Unfeature' : 'Feature'}</button>
          <button class="btn danger" data-action="delete" data-id="${a.id}">Delete</button>
        </div>
      </div>
    `).join('');
  }

  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;

    if (action === 'edit') openEdit(id);
    if (action === 'delete') handleDelete(id);
    if (action === 'feature') handleToggleFeature(id);
  });

  function openEdit(id) {
    const article = articles.find(a => a.id === id);
    if (!article) return;
    editingId = id;
    editPanelTitle.textContent = 'Edit Article';
    fTitle.value = article.title || '';
    fSummary.value = article.summary || '';
    fContent.value = article.content || '';
    fCategory.value = article.category || 'news';
    fAuthor.value = article.author || '';
    fImage.value = article.image || '';
    fFeatured.checked = !!article.featured;
    editPanel.classList.add('open');
    editPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  cancelBtn.addEventListener('click', () => {
    editPanel.classList.remove('open');
    editingId = null;
  });

  saveBtn.addEventListener('click', async () => {
    if (!editingId) return;
    const idx = articles.findIndex(a => a.id === editingId);
    if (idx === -1) return;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      articles[idx] = {
        ...articles[idx],
        title: fTitle.value.trim(),
        summary: fSummary.value.trim(),
        content: fContent.value.trim(),
        category: fCategory.value,
        author: fAuthor.value.trim(),
        image: fImage.value.trim(),
        featured: fFeatured.checked,
      };
      await saveArticles(`Admin: update "${articles[idx].title}"`);
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

  // ---- Auth flow ----

  async function connect() {
    try {
      await loadArticles();
      loginSection.style.display = 'none';
      dashboardSection.style.display = 'block';
      logoutBtn.style.display = 'inline-flex';
      renderList();
    } catch (err) {
      // Give a clearer message for the offline case specifically, since
      // a bare "Failed to fetch" isn't obvious to a user staring at a
      // button that looks like it did nothing.
      if (err instanceof TypeError && !navigator.onLine) {
        showMsg('You appear to be offline. Connect to the internet and try again.', 'error');
      } else {
        showMsg(err.message, 'error');
      }
      localStorage.removeItem(TOKEN_KEY);
      throw err;
    }
  }

  loginBtn.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    if (!token) {
      showMsg('Enter a token first.', 'error');
      return;
    }
    localStorage.setItem(TOKEN_KEY, token);

    // Without this, clicking Connect while offline (or during any slow/
    // failed request) gave no visible feedback at all — the button just
    // sat there looking unresponsive until the fetch eventually rejected.
    loginBtn.disabled = true;
    loginBtn.textContent = 'Connecting…';
    try {
      await connect();
    } catch {
      // error already shown by connect()
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = 'Connect';
    }
  });

  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem(TOKEN_KEY);
    dashboardSection.style.display = 'none';
    logoutBtn.style.display = 'none';
    loginSection.style.display = 'block';
    tokenInput.value = '';
  });

  generateBtn.addEventListener('click', triggerGeneration);

  document.addEventListener('DOMContentLoaded', () => {
    if (getToken()) {
      connect().catch(() => {});
    }
  });
})();
