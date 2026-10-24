// MeridianMatters — theme, nav, search, dynamic articles, wire ticker, UX polish
(function () {
  const html = document.documentElement;
  const themeToggle = document.getElementById('theme-toggle');
  const menuToggle = document.getElementById('menu-toggle');
  const navLinks = document.getElementById('nav-links');
  const isAdmin = window.location.pathname.includes('admin');

  // ===== Helpers =====
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const categoryMap = {
    news: 'Global News',
    sports: 'Sports',
    health: 'Health',
    finance: 'Finance'
  };

  function formatDate(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d)) return '';
    const diff = Date.now() - d.getTime();
    const hours = Math.floor(diff / 3600000);
    if (diff >= 0 && hours < 1) return 'Just now';
    if (diff >= 0 && hours < 24) return hours + 'h ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function readingTime(article) {
    const text = article.content || '';
    if (!text) return '';
    const words = text.trim().split(/\s+/).length;
    return Math.max(1, Math.round(words / 220)) + ' min read';
  }

  function metaLine(a) {
    const parts = [formatDate(a.date), a.author ? 'By ' + esc(a.author) : '', readingTime(a)].filter(Boolean);
    return parts.map((p) => `<span>${p}</span>`).join('<span>·</span>');
  }

  // ===== Theme =====
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

  // ===== Mobile menu =====
  if (menuToggle && navLinks) {
    menuToggle.addEventListener('click', () => {
      navLinks.classList.toggle('open');
      menuToggle.setAttribute('aria-expanded', navLinks.classList.contains('open'));
    });
    navLinks.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('open');
        menuToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // ===== Active nav =====
  function setActiveNav(key) {
    document.querySelectorAll('.nav-links a').forEach((a) => {
      const href = (a.getAttribute('href') || '').replace('.html', '');
      const k = href === 'index' ? 'home' : href;
      const on = k === key;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function pageKey() {
    const path = window.location.pathname;
    if (path.includes('news')) return 'news';
    if (path.includes('sports')) return 'sports';
    if (path.includes('health')) return 'health';
    if (path.includes('finance')) return 'finance';
    if (path.includes('article') || path.includes('page') || path.includes('admin')) return null;
    return 'home';
  }

  // ===== Data loading =====
  function createArticleCard(article) {
    const categoryLabel = categoryMap[article.category] || article.category;
    const imageContent = article.image
      ? `<img src="${esc(article.image)}" alt="${esc(article.imageAlt || article.title)}" loading="lazy" decoding="async">`
      : esc(article.imageAlt || categoryLabel);

    return `
      <a href="article.html?id=${encodeURIComponent(article.id)}" class="article-card" data-id="${esc(article.id)}">
        <div class="article-image">${imageContent}</div>
        <div class="article-body">
          <span class="article-category">${esc(categoryLabel)}</span>
          <h3>${esc(article.title)}</h3>
          <p>${esc(article.summary)}</p>
          <div class="article-meta">${metaLine(article)}</div>
        </div>
      </a>
    `;
  }

  function skeletonCards(n) {
    return Array.from({ length: n }, () => `
      <div class="sk-card" aria-hidden="true">
        <div class="skeleton sk-thumb"></div>
        <div><div class="skeleton sk-line w60"></div><div class="skeleton sk-line lg"></div><div class="skeleton sk-line w80"></div></div>
      </div>`).join('');
  }

  // Cache the articles fetch so ticker, hero, list and search share one request.
  // 'no-cache' revalidates with the server (ETag) so new posts show immediately
  // without defeating the CDN cache the way a timestamp query string does.
  let articlesPromise = null;

  async function loadArticles() {
    if (articlesPromise) return articlesPromise;
    articlesPromise = (async () => {
      try {
        const res = await fetch('data/articles.json', { cache: 'no-cache' });
        if (!res.ok) throw new Error('Failed to load');
        const data = await res.json();
        const all = data.articles || [];

        const now = new Date();
        return all.filter((a) => {
          const status = a.status || 'published';
          if (status === 'published') return true;
          if (status === 'scheduled') {
            const when = a.scheduledDate ? new Date(a.scheduledDate) : null;
            return when && when <= now;
          }
          return false;
        });
      } catch (err) {
        console.error(err);
        return [];
      }
    })();
    return articlesPromise;
  }

  async function loadSettings() {
    try {
      const res = await fetch('data/settings.json', { cache: 'no-cache' });
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
      document.querySelectorAll('.logo').forEach((el) => {
        const mid = Math.ceil(settings.siteName.length / 2);
        el.innerHTML = `${esc(settings.siteName.slice(0, mid))}<span>${esc(settings.siteName.slice(mid))}</span>`;
      });
    }

    if (settings.maintenanceMode && !isAdmin) {
      document.body.innerHTML = `
        <div style="min-height:100vh; display:flex; align-items:center; justify-content:center; text-align:center; padding:2rem; font-family: var(--font-body, sans-serif);">
          <div>
            <h1 style="font-family: var(--font-display, sans-serif); font-size:1.8rem; margin-bottom:1rem;">We'll be right back</h1>
            <p style="color:#5b6470;">${esc(settings.maintenanceMessage || 'The site is temporarily down for maintenance.')}</p>
          </div>
        </div>
      `;
      throw new Error('maintenance-mode');
    }
  }

  // ===== Home =====
  async function renderHome() {
    const lead = document.getElementById('hero-lead');
    const rail = document.getElementById('hero-rail');
    const list = document.getElementById('latest-articles');
    if (!lead && !rail && !list) return;

    const articles = await loadArticles();
    const sorted = [...articles].sort((a, b) => new Date(b.date) - new Date(a.date));
    const featured = articles.find((a) => a.featured) || sorted[0];

    if (!featured) {
      if (lead) lead.innerHTML = '<p class="empty-state">No stories published yet. Check back soon.</p>';
      if (rail) rail.innerHTML = '';
      if (list) list.innerHTML = '<p class="empty-state">No articles yet.</p>';
      return;
    }

    const others = sorted.filter((a) => a !== featured);
    const railItems = others.slice(0, 4);
    const listItems = others.slice(4, 12);

    if (lead) {
      const label = categoryMap[featured.category] || featured.category;
      lead.innerHTML = `
        <span class="hero-badge">${esc(label)}</span>
        <a href="article.html?id=${encodeURIComponent(featured.id)}">
          ${featured.image ? `<div class="hero-image"><img src="${esc(featured.image)}" alt="${esc(featured.imageAlt || featured.title)}" fetchpriority="high" decoding="async"></div>` : ''}
          <h1>${esc(featured.title)}</h1>
          <p>${esc(featured.summary)}</p>
        </a>
        <div class="hero-meta">${metaLine(featured)}</div>
      `;
    }

    if (rail) {
      rail.innerHTML = railItems.length
        ? railItems.map((a) => `
          <a class="rail-item" href="article.html?id=${encodeURIComponent(a.id)}">
            <div>
              <span class="article-category">${esc(categoryMap[a.category] || a.category)}</span>
              <h3>${esc(a.title)}</h3>
              <div class="article-meta">${metaLine(a)}</div>
            </div>
          </a>`).join('')
        : '<p class="empty-state">More stories coming soon.</p>';
    }

    if (list) {
      list.innerHTML = listItems.length
        ? listItems.map(createArticleCard).join('')
        : '<p class="empty-state">More stories coming soon.</p>';
    }
  }

  async function renderCategoryArticles(category) {
    const container = document.getElementById('category-articles');
    if (!container) return;
    container.innerHTML = skeletonCards(5);
    const articles = await loadArticles();
    const filtered = articles
      .filter((a) => a.category === category)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    container.innerHTML = filtered.length
      ? filtered.map(createArticleCard).join('')
      : '<p class="empty-state">No articles yet in this category.</p>';
  }

  // ===== Wire Ticker =====
  async function renderTicker() {
    const el = document.getElementById('wire-ticker');
    if (!el) return;

    const articles = await loadArticles();
    if (!articles.length) return;

    const latest = [...articles]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 8);

    const items = latest.map((a) => {
      const label = (categoryMap[a.category] || a.category || '').toUpperCase();
      return `<a href="article.html?id=${encodeURIComponent(a.id)}">${esc(label)} — ${esc(a.title)}</a>`;
    });

    // Duplicate back-to-back so the -50% marquee loops without a seam.
    const track = items.concat(items).join('<span class="sep">&nbsp;&nbsp;//&nbsp;&nbsp;</span>');

    el.innerHTML = `
      <span class="ticker-label"><span class="dot"></span><span class="txt">Live Wire</span></span>
      <span class="ticker-track">${track}</span>
    `;
  }

  // ===== Pages (About / Contact / Privacy / custom) =====
  let pagesPromise = null;
  async function loadPages() {
    if (pagesPromise) return pagesPromise;
    pagesPromise = (async () => {
      try {
        const res = await fetch('data/pages.json', { cache: 'no-cache' });
        if (!res.ok) return [];
        const data = await res.json();
        return (data.pages || []).sort((a, b) => (a.order || 0) - (b.order || 0));
      } catch {
        return [];
      }
    })();
    return pagesPromise;
  }

  async function renderMoreMenu() {
    if (isAdmin) return;
    const navInner = document.querySelector('.site-header .nav-inner');
    if (!navInner || document.getElementById('more-toggle')) return;

    const pages = await loadPages();
    if (!pages.length) return;

    const wrap = document.createElement('div');
    wrap.className = 'more-menu-wrap';
    wrap.innerHTML = `
      <button class="more-toggle" id="more-toggle" aria-label="More" aria-expanded="false">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
        </svg>
      </button>
      <div class="more-menu" id="more-menu">
        ${pages.map((p) => `<a href="page.html?slug=${encodeURIComponent(p.id)}">${esc(p.title)}</a>`).join('')}
      </div>
    `;
    navInner.insertBefore(wrap, navInner.firstChild);

    const toggle = document.getElementById('more-toggle');
    const menu = document.getElementById('more-menu');
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = menu.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open);
    });
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) {
        menu.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  async function fixFooterLinks() {
    const footerLinksContainer = document.querySelector('.footer-links');
    if (!footerLinksContainer) return;

    // Keep only the Sections column; drop any legacy dead-link column.
    footerLinksContainer.querySelectorAll(':scope > div').forEach((col, i) => { if (i > 0) col.remove(); });

    const pages = await loadPages();
    if (!pages.length) return;

    const aboutCol = document.createElement('div');
    aboutCol.innerHTML = `
      <h4>About</h4>
      ${pages.map((p) => `<a href="page.html?slug=${encodeURIComponent(p.id)}">${esc(p.title)}</a>`).join('')}
    `;
    footerLinksContainer.appendChild(aboutCol);
  }

  function setFooterYear() {
    if (isAdmin) return; // admin keeps its own footer text
    const el = document.querySelector('.footer-bottom');
    if (el) el.textContent = `© ${new Date().getFullYear()} MeridianMatters. All rights reserved.`;
  }

  // ===== Search =====
  function initSearch() {
    if (isAdmin) return;
    const actions = document.querySelector('.nav-actions');
    if (!actions) return;

    const btn = document.createElement('button');
    btn.className = 'search-toggle';
    btn.setAttribute('aria-label', 'Search stories');
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path stroke-linecap="round" d="M21 21l-4.35-4.35"/></svg>`;
    actions.insertBefore(btn, actions.firstChild);

    const overlay = document.createElement('div');
    overlay.className = 'search-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="search-panel" role="dialog" aria-modal="true" aria-label="Search stories">
        <div class="search-field">
          <input type="search" id="search-input" placeholder="Search stories…" autocomplete="off" aria-label="Search stories">
          <button type="button" class="search-close" aria-label="Close search">Esc</button>
        </div>
        <div class="search-results" id="search-results"></div>
      </div>`;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('#search-input');
    const results = overlay.querySelector('#search-results');

    function row(a) {
      return `<a class="search-item" href="article.html?id=${encodeURIComponent(a.id)}">
        <span class="article-category">${esc(categoryMap[a.category] || a.category)}</span>
        <h4>${esc(a.title)}</h4>
        <div class="article-meta">${metaLine(a)}</div>
      </a>`;
    }

    async function render(q) {
      const articles = await loadArticles();
      const sorted = [...articles].sort((a, b) => new Date(b.date) - new Date(a.date));
      const terms = q.toLowerCase().split(/\s+/).filter(Boolean);

      if (!terms.length) {
        results.innerHTML = `<div class="search-hint">Latest stories</div>${sorted.slice(0, 5).map(row).join('')}`;
        return;
      }

      const hits = sorted.filter((a) => {
        const hay = [a.title, a.summary, a.author, categoryMap[a.category] || a.category].join(' ').toLowerCase();
        return terms.every((t) => hay.includes(t));
      }).slice(0, 8);

      results.innerHTML = hits.length
        ? `<div class="search-hint">${hits.length} result${hits.length === 1 ? '' : 's'}</div>${hits.map(row).join('')}`
        : `<div class="empty-state" style="padding:1.25rem 1rem;">No stories match “${esc(q)}”.</div>`;
    }

    let lastFocus = null;
    function open() {
      lastFocus = document.activeElement;
      overlay.hidden = false;
      document.body.style.overflow = 'hidden';
      input.value = '';
      render('');
      input.focus();
    }
    function close() {
      overlay.hidden = true;
      document.body.style.overflow = '';
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    btn.addEventListener('click', open);
    overlay.querySelector('.search-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    input.addEventListener('input', () => render(input.value));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !overlay.hidden) close();
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (e.key === '/' && overlay.hidden && !/INPUT|TEXTAREA|SELECT/.test(tag)) {
        e.preventDefault();
        open();
      }
    });
  }

  // ===== Scroll UX: header shadow, back-to-top, reading progress =====
  function initScrollUX() {
    const header = document.querySelector('.site-header');
    const progress = document.getElementById('read-progress');

    let toTop = null;
    if (!isAdmin) {
      toTop = document.createElement('button');
      toTop.className = 'to-top';
      toTop.setAttribute('aria-label', 'Back to top');
      toTop.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7"/></svg>`;
      toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
      document.body.appendChild(toTop);
    }

    let ticking = false;
    function onScroll() {
      const y = window.scrollY || document.documentElement.scrollTop;
      if (header) header.classList.toggle('scrolled', y > 8);
      if (toTop) toTop.classList.toggle('show', y > 600);
      if (progress) {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        progress.style.width = (max > 0 ? Math.min(100, (y / max) * 100) : 0) + '%';
      }
      ticking = false;
    }
    window.addEventListener('scroll', () => {
      if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
    }, { passive: true });
    onScroll();
  }

  // ===== Boot =====
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      await applySettings();
    } catch (err) {
      if (err.message === 'maintenance-mode') return;
    }

    const key = pageKey();
    if (key) setActiveNav(key);

    renderTicker();
    renderMoreMenu();
    fixFooterLinks();
    setFooterYear();
    initSearch();
    initScrollUX();

    if (key === 'home') {
      renderHome();
    } else if (key) {
      renderCategoryArticles(key);
    }
  });

  // Shared with inline scripts (article.html) so data is fetched only once.
  window.MM = window.MM || {};
  window.MM.loadArticles = loadArticles;
  window.MM.createArticleCard = createArticleCard;
  window.MM.setActiveNav = setActiveNav;
  window.MM.esc = esc;
  window.MM.categoryMap = categoryMap;
  window.MM.formatDate = formatDate;
  window.MM.readingTime = readingTime;
})();
