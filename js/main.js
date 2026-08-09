// Theme toggle + mobile menu + dynamic articles
(function () {
  const html = document.documentElement;
  const themeToggle = document.getElementById('theme-toggle');
  const menuToggle = document.getElementById('menu-toggle');
  const navLinks = document.getElementById('nav-links');

  // Restore theme
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
      const expanded = navLinks.classList.contains('open');
      menuToggle.setAttribute('aria-expanded', expanded);
    });

    navLinks.querySelectorAll('a').forEach((link) => {
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
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function createArticleCard(article) {
    const categoryLabel = categoryMap[article.category] || article.category;
    const imageContent = article.image
      ? `<img src="${article.image}" alt="${article.imageAlt || article.title}" loading="lazy">`
      : article.imageAlt || categoryLabel;

    return `
      <article class="article-card" data-id="${article.id}">
        <div class="article-image">${imageContent}</div>
        <div class="article-body">
          <span class="article-category">${categoryLabel}</span>
          <h3>${article.title}</h3>
          <p>${article.summary}</p>
          <div class="article-meta">
            <span>${formatDate(article.date)}</span>
            <span>By ${article.author}</span>
          </div>
        </div>
      </article>
    `;
  }

  async function loadArticles() {
    try {
      const res = await fetch('data/articles.json?t=' + Date.now());
      if (!res.ok) throw new Error('Failed to load articles');
      const data = await res.json();
      return data.articles || [];
    } catch (err) {
      console.error('Error loading articles:', err);
      return [];
    }
  }

  async function renderHomeArticles() {
    const container = document.getElementById('latest-articles');
    if (!container) return;

    const articles = await loadArticles();
    const featured = articles.filter(a => a.featured).slice(0, 3);
    const toShow = featured.length ? featured : articles.slice(0, 3);

    container.innerHTML = toShow.map(createArticleCard).join('');
  }

  async function renderCategoryArticles(category) {
    const container = document.getElementById('category-articles');
    if (!container) return;

    const articles = await loadArticles();
    const filtered = articles
      .filter(a => a.category === category)
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    if (filtered.length === 0) {
      container.innerHTML = '<p style="color: var(--text-muted)">No articles yet in this category.</p>';
      return;
    }

    container.innerHTML = filtered.map(createArticleCard).join('');
  }

  async function renderHero() {
    const heroTitle = document.getElementById('hero-title');
    const heroSummary = document.getElementById('hero-summary');
    const heroMeta = document.getElementById('hero-meta');
    if (!heroTitle) return;

    const articles = await loadArticles();
    const featured = articles.find(a => a.featured) || articles[0];
    if (!featured) return;

    heroTitle.textContent = featured.title;
    if (heroSummary) heroSummary.textContent = featured.summary;
    if (heroMeta) {
      heroMeta.innerHTML = `
        <span>${formatDate(featured.date)}</span>
        <span>•</span>
        <span>By ${featured.author}</span>
        <span>•</span>
        <span>${categoryMap[featured.category] || featured.category}</span>
      `;
    }
  }

  // Auto-detect page and render
  document.addEventListener('DOMContentLoaded', () => {
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
