// Theme toggle + mobile menu + dynamic articles + wire ticker
(function () {
  const html = document.documentElement;
  const themeToggle = document.getElementById('theme-toggle');
  const menuToggle = document.getElementById('menu-toggle');
  const navLinks = document.getElementById('nav-links');

  const saved = localStorage.getItem('theme');
  if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    html.setAttribute('data-theme', 'dark');
  }

  function updateIcon() {
    const isDark = html.getAttribute('data-theme') === 'dark';
    if (themeToggle) {
      themeToggle.innerHTML = isDark
        ? `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>`;
      themeToggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    }
  }

  updateIcon();

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const isDark = html.getAttribute('data-theme') === 'dark';
      if (isDark) {
        html.removeAttribute('data-theme');
        localStorage.setItem('theme', 'light');
      } else {
        html.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
      }
      updateIcon();
    });
  }

  if (menuToggle && navLinks) {
    menuToggle.addEventListener('click', () => {
      navLinks.classList.toggle('open');
      menuToggle.setAttribute('aria-expanded', navLinks.classList.contains('open'));
    });
    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('open');
        menuToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // ===== Dynamic Articles =====
  const categoryMap = {
    news: 'Global News',
    sports: 'Sports',
    health: 'Health',
    finance: 'Finance'
  };

  function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // Wire-style timestamp, e.g. "14:32 UTC"
  function formatWireTime(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d)) return '';
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }) + ' UTC';
  }

  function createArticleCard(article) {
    const categoryLabel = categoryMap[article.category] || article.category;
    const imageContent = article.image
      ? `<img src="${article.image}" alt="${article.imageAlt || article.title}" loading="lazy">`
      : (article.imageAlt || categoryLabel);

    return `
      <a href="article.html?id=${encodeURIComponent(article.id)}" class="article-card" data-id="${article.id}">
        <div class="article-image">${imageContent}</div>
        <div class="article-body">
          <span class="article-category">${categoryLabel}</span>
          <h3>${article.title}</h3>
          <p>${article.summary}</p>
          <div class="article-meta">
            <span>${formatDate(article.date)}</span>
            <span>·</span>
            <span>By ${article.author}</span>
          </div>
        </div>
      </a>
    `;
  }

  async function loadArticles() {
    try {
      const res = await fetch('data/articles.json?t=' + Date.now());
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      const all = data.articles || [];

      // Visibility rule: legacy articles with no "status" field are treated
      // as published (so nothing already live disappears). Draft/review
      // never show publicly. Scheduled articles become visible automatically
      // once their scheduledDate has passed, without needing a new commit.
      const now = new Date();
      return all.filter(a => {
        const status = a.status || 'published';
        if (status === 'published') return true;
        if (status === 'scheduled') {
          const when = a.scheduledDate ? new Date(a.scheduledDate) : null;
          return when && when <= now;
        }
        return false; // draft, review
      });
    } catch (err) {
      console.error(err);
      return [];
    }
  }

  async function loadSettings() {
    try {
      const res = await fetch('data/settings.json?t=' + Date.now());
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async function applySettings() {
    const settings = await loadSettings();
    if (!settings) return;

    if (settings.accentColor) {
      document.documentElement.style.setProperty('--accent', settings.accentColor);
    }
    if (settings.siteName && settings.siteName !== 'MeridianMatters') {
      document.querySelectorAll('.logo').forEach(el => {
        // Keep the two-tone styling but swap the text content safely.
        const mid = Math.ceil(settings.siteName.length / 2);
        el.innerHTML = `${settings.siteName.slice(0, mid)}<span>${settings.siteName.slice(mid)}</span>`;
      });
    }

    if (settings.maintenanceMode && !window.location.pathname.includes('admin')) {
      document.body.innerHTML = `
        <div style="min-height:100vh; display:flex; align-items:center; justify-content:center; text-align:center; padding:2rem; font-family: var(--font-body, sans-serif);">
          <div>
            <h1 style="font-family: var(--font-display, sans-serif); font-size:1.8rem; margin-bottom:1rem;">We'll be right back</h1>
            <p style="color:#5b6470;">${settings.maintenanceMessage || 'The site is temporarily down for maintenance.'}</p>
          </div>
        </div>
      `;
      throw new Error('maintenance-mode'); // halt further rendering on this page
    }
  }

  async function renderHomeArticles() {
    const container = document.getElementById('latest-articles');
    if (!container) return;
    const articles = await loadArticles();

    // The lead story already appears in the hero above — skip it here so
    // it isn't repeated, then show a denser list since each row is compact.
    const lead = articles.find(a => a.featured) || articles[0];
    const rest = articles
      .filter(a => a !== lead)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 8);

    container.innerHTML = rest.length
      ? rest.map(createArticleCard).join('')
      : '<p style="color:var(--text-muted);padding:1rem 0;">No articles yet.</p>';
  }

  async function renderCategoryArticles(category) {
    const container = document.getElementById('category-articles');
    if (!container) return;
    const articles = await loadArticles();
    const filtered = articles
      .filter(a => a.category === category)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    container.innerHTML = filtered.length
      ? filtered.map(createArticleCard).join('')
      : '<p style="color:var(--text-muted);padding:1rem 0;">No articles yet in this category.</p>';
  }

  async function renderHero() {
    const heroTitle = document.getElementById('hero-title');
    const heroSummary = document.getElementById('hero-summary');
    const heroMeta = document.getElementById('hero-meta');
    const heroLink = document.getElementById('hero-link');
    if (!heroTitle) return;

    const articles = await loadArticles();
    const featured = articles.find(a => a.featured) || articles[0];
    if (!featured) return;

    heroTitle.textContent = featured.title;
    if (heroSummary) heroSummary.textContent = featured.summary;
    if (heroLink) heroLink.href = `article.html?id=${encodeURIComponent(featured.id)}`;
    if (heroMeta) {
      heroMeta.innerHTML = `
        <span>${formatDate(featured.date)}</span>
        <span>·</span>
        <span>By ${featured.author}</span>
        <span>·</span>
        <span>${categoryMap[featured.category] || featured.category}</span>
      `;
    }
  }

  // ===== Wire Ticker (signature element) =====
  // Expects a container: <div class="wire-ticker" id="wire-ticker"></div>
  // placed right after the <header>. Builds itself from the same
  // articles.json the rest of the page uses — no extra data source needed.
  async function renderTicker() {
    const el = document.getElementById('wire-ticker');
    if (!el) return;

    const articles = await loadArticles();
    if (!articles.length) return;

    const latest = [...articles]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 8);

    const items = latest.map(a => {
      const label = (categoryMap[a.category] || a.category).toUpperCase();
      return `<a href="article.html?id=${encodeURIComponent(a.id)}">${label} — ${a.title}</a>`;
    });

    // Duplicate the list back-to-back so the CSS marquee (-50% translateX)
    // loops seamlessly with no visible seam or restart jump.
    const track = items.concat(items).join('<span class="sep">&nbsp;&nbsp;//&nbsp;&nbsp;</span>');

    el.innerHTML = `
      <span class="ticker-label"><span class="dot"></span><span class="txt">Live Wire</span></span>
      <span class="ticker-track">${track}</span>
    `;
  }

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      await applySettings();
    } catch (err) {
      if (err.message === 'maintenance-mode') return; // page replaced, stop here
    }

    renderTicker();

    const path = window.location.pathname;
    if (path.endsWith('index.html') || path.endsWith('/') || path === '') {
      renderHero();
      renderHomeArticles();
    } else if (path.includes('news')) {
      renderCategoryArticles('news');
    } else if (path.includes('sports')) {
      renderCategoryArticles('sports');
    } else if (path.includes('health')) {
      renderCategoryArticles('health');
    } else if (path.includes('finance')) {
      renderCategoryArticles('finance');
    }
  });
})();
