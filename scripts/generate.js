/**
 * MeridianMatters - Source-grounded article generator (v2)
 *
 * What changed from v1:
 *  - Articles are written from the REAL TEXT of a reputable outlet's article
 *    (BBC, Guardian, NPR, Al Jazeera, ESPN, CBS Sports, CNBC), not from a
 *    headline alone. Headline-only prompts forced the model to pad ~1000 words
 *    with guesses, some of which were wrong.
 *  - Deterministic fact gates run on every draft: numbers, direct quotes and
 *    proper names must exist in the source, and the draft may not copy the
 *    source's wording. Drafts that fail are retried, then dropped.
 *  - Images: only a free-licence Wikimedia Commons photo whose file title or
 *    description names the same person/place/organisation as the story.
 *    No match = no photo (the site shows a neutral placeholder). The old
 *    random keyword stock-photo search is gone; it produced wrong photos.
 *  - Duplicate stories, live blogs, video pages, odds/betting and opinion
 *    pieces are skipped.
 */

const fs = require('fs');
const path = require('path');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const ARTICLES_PATH = path.join(__dirname, '..', 'data', 'articles.json');
const UA = 'Mozilla/5.0 (compatible; MeridianMattersBot/2.0; +https://meridianmatters.web.app)';

const MIN_SOURCE_WORDS = 500; // source article must be substantial
const MIN_WORDS = 650;        // published article floor
const MAX_WORDS = 1100;
const MAX_ATTEMPTS = 3;
const MAX_AGE_HOURS = 60;
const MAX_ARTICLES = 50;
const MAX_CANDIDATES_PER_CATEGORY = 12;

const CATEGORIES = [
  { id: 'news', name: 'Global News' },
  { id: 'sports', name: 'Sports' },
  { id: 'health', name: 'Health' },
  { id: 'finance', name: 'Finance' }
];

const FEEDS = {
  news: [
    { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
    { name: 'The Guardian', url: 'https://www.theguardian.com/world/rss' },
    { name: 'NPR', url: 'https://feeds.npr.org/1004/rss.xml' },
    { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' }
  ],
  sports: [
    { name: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/rss.xml' },
    { name: 'The Guardian', url: 'https://www.theguardian.com/sport/rss' },
    { name: 'ESPN', url: 'https://www.espn.com/espn/rss/news' },
    { name: 'CBS Sports', url: 'https://www.cbssports.com/rss/headlines/' }
  ],
  health: [
    { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/health/rss.xml' },
    { name: 'NPR', url: 'https://feeds.npr.org/1128/rss.xml' },
    { name: 'The Guardian', url: 'https://www.theguardian.com/society/health/rss' }
  ],
  finance: [
    { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
    { name: 'The Guardian', url: 'https://www.theguardian.com/business/rss' },
    { name: 'NPR', url: 'https://feeds.npr.org/1006/rss.xml' },
    { name: 'CNBC', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147' }
  ]
};

const SKIP_TITLE = /\b(live|video|podcast|quiz|newsletter|crossword|horoscope|odds|picks|predictions|how to watch|where to watch|betting|fantasy|opinion|editorial|letters)\b/i;
const SKIP_URL = /\/(live|video|videos|audio|podcasts?|commentisfree|opinion|interactive|gallery)\//i;

// ---------- small utils ----------

function decodeEntities(str) {
  return (str || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&rdquo;|&ldquo;/g, '"')
    .replace(/&mdash;|&ndash;/g, '-')
    .replace(/&hellip;/g, '...')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
}

function stripTags(s) {
  return (s || '').replace(/<[^>]*>/g, ' ');
}

function countWords(text) {
  return (text || '').trim().split(/\s+/).filter(Boolean).length;
}

function loose(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchText(url, ms = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xml,application/rss+xml,*/*' },
      signal: ctrl.signal,
      redirect: 'follow'
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.substring(0, 300)}`);
  return JSON.parse(text);
}

// ---------- feeds ----------

function tagValue(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  if (!m) return '';
  return decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim();
}

function parseRss(xml, feedName) {
  const blocks = Array.from((xml || '').matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)).map(m => m[1]);
  return blocks.map(b => ({
    title: stripTags(tagValue(b, 'title')).replace(/\s+/g, ' ').trim(),
    link: tagValue(b, 'link'),
    pubDate: Date.parse(tagValue(b, 'pubDate')) || 0,
    source: feedName
  })).filter(i => i.title && /^https?:\/\//.test(i.link));
}

async function collectCandidates(categoryId) {
  const out = [];
  for (const feed of FEEDS[categoryId] || []) {
    try {
      const xml = await fetchText(feed.url);
      out.push(...parseRss(xml, feed.name).slice(0, 15));
    } catch (err) {
      console.warn(`  Feed failed (${feed.name}): ${err.message}`);
    }
  }
  const cutoff = Date.now() - MAX_AGE_HOURS * 3600 * 1000;
  return out
    .filter(i => !i.pubDate || i.pubDate >= cutoff)
    .filter(i => !SKIP_TITLE.test(i.title) && !SKIP_URL.test(i.link))
    .sort((a, b) => b.pubDate - a.pubDate);
}

function titleTokens(t) {
  return new Set(loose(t).split(' ').filter(w => w.length > 3));
}

function isDuplicateTitle(title, existingTitles) {
  const a = titleTokens(title);
  if (!a.size) return false;
  for (const other of existingTitles) {
    const b = titleTokens(other);
    let inter = 0;
    a.forEach(w => { if (b.has(w)) inter++; });
    const union = a.size + b.size - inter;
    if (union && inter / union >= 0.45) return true;
  }
  return false;
}

// ---------- source text ----------

function extractArticleText(html) {
  const BAD = /(subscribe|sign up|newsletter|cookie|all rights reserved|follow us|click here|read more|advertisement|copyright|terms of use|privacy policy|your browser|javascript|share this|listen to|watch:)/i;
  const clean = (html || '').replace(/<(script|style|noscript|svg|iframe|form|nav|aside|footer|header|figure|figcaption)[\s\S]*?<\/\1>/gi, ' ');

  const paragraphs = (chunk) => Array.from(chunk.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi))
    .map(m => decodeEntities(stripTags(m[1])).replace(/\s+/g, ' ').trim())
    .filter(p => p.length >= 50 && !BAD.test(p));

  const art = clean.match(/<article[\s\S]*?<\/article>/i);
  let paras = art ? paragraphs(art[0]) : [];
  if (countWords(paras.join(' ')) < 200) paras = paragraphs(clean);
  return paras.join('\n\n');
}

// ---------- fact gates ----------

const MONTHS_DAYS = new Set(['january','february','march','april','may','june','july','august','september','october','november','december','monday','tuesday','wednesday','thursday','friday','saturday','sunday','meridianmatters']);

function numbersIn(text) {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) || []).map(n => n.replace(/,/g, '').replace(/\.$/, ''));
}

function checkGates(draft, sourceText, sourceName) {
  const problems = [];
  const content = draft.content || '';
  const all = `${draft.title}\n${draft.summary}\n${content}`;
  const sourceLoose = loose(sourceText);

  // 1. Numbers must come from the source
  const srcNums = new Set(numbersIn(sourceText));
  const thisYear = String(new Date().getFullYear());
  const badNums = [...new Set(numbersIn(all).filter(n => !srcNums.has(n) && n !== thisYear))];
  if (badNums.length) problems.push(`numbers not found in the source: ${badNums.slice(0, 8).join(', ')}`);

  // 2. Direct quotes must be verbatim from the source
  const quotes = Array.from(content.matchAll(/[\u201c"]([^\u201d"\n]{12,})[\u201d"]/g)).map(m => m[1]);
  const badQuotes = quotes.filter(q => !sourceLoose.includes(loose(q)));
  if (badQuotes.length) problems.push(`quotes that are not verbatim in the source: ${badQuotes.slice(0, 3).map(q => `"${q.slice(0, 60)}"`).join('; ')}`);
  if (quotes.length > 3) problems.push('too many direct quotes (max 3)');

  // 3. Proper names must come from the source
  const allow = new Set([...MONTHS_DAYS, ...loose(sourceName).split(' ')]);
  const badNames = new Set();
  for (const sentence of content.split(/(?<=[.!?])\s+/)) {
    const words = sentence.split(/\s+/);
    for (let i = 1; i < words.length; i++) {
      const w = words[i].replace(/^[^A-Za-z]+|[^A-Za-z'\u2019-]+$/g, '').replace(/['\u2019]s$/, '');
      if (!/^[A-Z][a-z]{2,}/.test(w)) continue;
      const lw = w.toLowerCase();
      if (allow.has(lw)) continue;
      if (sourceLoose.includes(lw.slice(0, Math.max(4, lw.length - 2)))) continue;
      badNames.add(w);
    }
  }
  if (badNames.size > 3) problems.push(`names not found in the source: ${[...badNames].slice(0, 8).join(', ')}`);

  // 4. No close copying of the source's wording (8-word shingles)
  const srcWords = sourceLoose.split(' ');
  const srcShingles = new Set();
  for (let i = 0; i + 8 <= srcWords.length; i++) srcShingles.add(srcWords.slice(i, i + 8).join(' '));
  const outWords = loose(content).split(' ');
  let total = 0, copied = 0;
  for (let i = 0; i + 8 <= outWords.length; i++) {
    total++;
    if (srcShingles.has(outWords.slice(i, i + 8).join(' '))) copied++;
  }
  if (total && copied / total > 0.06) problems.push('too much wording copied from the source; rewrite far more freely');

  return problems;
}

// ---------- drafting ----------

async function groqDraft(prompt) {
  const data = await fetchJSON('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: 'You are a careful news editor. You output only valid JSON. You never invent facts, names, numbers or quotes that are not in the source text you are given.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.4,
      max_tokens: 5000,
      response_format: { type: 'json_object' }
    })
  });
  const text = data?.choices?.[0]?.message?.content || '';
  const cleaned = text.replace(/```json|```/gi, '').trim();
  const s = cleaned.indexOf('{');
  const e = cleaned.lastIndexOf('}');
  if (s === -1 || e === -1) throw new Error('No JSON in model reply');
  const parsed = JSON.parse(cleaned.substring(s, e + 1));
  if (!parsed.title || !parsed.summary || !parsed.content) throw new Error('Missing fields');
  return parsed;
}

function buildPrompt(item, sourceText, targetWords, feedback) {
  const src = sourceText.length > 12000 ? sourceText.slice(0, 12000) : sourceText;
  return `You are a news editor at MeridianMatters. Write an ORIGINAL news article based ONLY on the SOURCE TEXT below, published by ${item.source}.

HARD RULES
1. Use only facts, names, numbers, dates and quotes that appear in the SOURCE TEXT. Never add figures, names, quotes, places or events that are not in it.
2. Rewrite completely in your own words and with your own structure. Do not copy sentences or long phrases.
3. Direct quotes: at most 2, exact words from the source, in double quotes, attributed. Otherwise paraphrase.
4. You may add 1-2 short paragraphs of widely known background (what a term means, how a process works) with NO numbers, dates or names that are not in the source, clearly framed as background.
5. Mention "${item.source}" by name once as the source of the reporting.
6. Neutral, factual tone. No opinion, no speculation, no advice, no calls to action.
7. Length: about ${targetWords} words (minimum ${MIN_WORDS}). Paragraphs separated by a blank line. No headings, no bullet lists.
${feedback ? `\nYOUR PREVIOUS DRAFT WAS REJECTED. Fix this: ${feedback}\n` : ''}
SOURCE HEADLINE: ${item.title}

SOURCE TEXT:
"""
${src}
"""

Return ONLY JSON: {"title": "factual headline, max 14 words", "summary": "1-2 sentences, max 40 words", "content": "the full article"}`;
}

async function writeWithGates(item, sourceText) {
  const srcWords = countWords(sourceText);
  const target = Math.min(MAX_WORDS, Math.max(MIN_WORDS + 50, Math.round(srcWords * 1.1)));
  let feedback = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      console.log(`  Attempt ${attempt}/${MAX_ATTEMPTS}...`);
      const draft = await groqDraft(buildPrompt(item, sourceText, target, feedback));
      const wc = countWords(draft.content);
      const problems = checkGates(draft, sourceText, item.source);
      if (wc < MIN_WORDS) problems.push(`too short (${wc} words, need at least ${MIN_WORDS}); expand with more detail from the source`);
      console.log(`  -> ${wc} words, ${problems.length} problem(s)`);
      if (!problems.length) return draft;
      problems.forEach(p => console.log(`     - ${p}`));
      feedback = problems.join('; ');
    } catch (err) {
      console.warn(`  Attempt ${attempt} failed: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 1200));
  }
  return null;
}

// ---------- images (Wikimedia Commons, entity-matched only) ----------

const NOT_ENTITY = new Set(['the','after','over','amid','with','from','what','why','how','who','new','says','said','will','this','that','week','first','latest','report','reports','breaking']);

function extractEntities(title) {
  const found = [];
  for (const seg of (title || '').split(/[:;,\u2014\u2013|]| - /)) {
    const toks = seg.trim().split(/\s+/).map(t => t.replace(/['\u2019]s$/, '').replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9.]+$/g, ''));
    let run = [];
    const flush = (startIdx) => {
      if (run.length >= 2) {
        if (run.length <= 3) found.push(run.join(' '));
        else { found.push(run.slice(0, 3).join(' ')); found.push(run.slice(-2).join(' ')); }
      } else if (run.length === 1 && startIdx > 0 && run[0].length >= 5 && !NOT_ENTITY.has(run[0].toLowerCase())) found.push(run[0]);
      run = [];
    };
    toks.forEach((t, i) => {
      const isCap = /^[A-Z][A-Za-z.]*$/.test(t) && !NOT_ENTITY.has(t.toLowerCase());
      if (isCap) {
        if (!run.length) run._start = i;
        run.push(t);
      } else {
        flush(run._start || 0);
      }
    });
    flush(run._start || 0);
  }
  return [...new Set(found)].sort((a, b) => b.length - a.length).slice(0, 3);
}

function stripHtml(s) {
  return decodeEntities((s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

async function findImage(entities) {
  for (const entity of entities) {
    try {
      const q = encodeURIComponent(`"${entity}" filetype:bitmap`);
      const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${q}&gsrnamespace=6&gsrlimit=12&prop=imageinfo&iiprop=url|extmetadata|size|mime&iiurlwidth=1000&format=json&formatversion=2&origin=*`;
      const data = await fetchJSON(url, { headers: { 'User-Agent': UA } });
      const pages = data?.query?.pages || [];
      const tokens = entity.toLowerCase().split(/\s+/).filter(t => t.length >= 3);
      for (const page of pages) {
        const info = page.imageinfo?.[0];
        if (!info) continue;
        if (!(info.mime === 'image/jpeg' || info.mime === 'image/png')) continue;
        if ((info.width || 0) < 800 || (info.height || 0) < 450 || info.width < info.height * 1.2) continue;
        const meta = info.extmetadata || {};
        const title = page.title.replace(/^File:/, '').replace(/\.\w+$/, '').replace(/_/g, ' ');
        const hay = `${title} ${stripHtml(meta.ObjectName?.value)} ${stripHtml(meta.ImageDescription?.value)} ${stripHtml(meta.Categories?.value)}`.toLowerCase();
        if (!tokens.every(t => hay.includes(t))) continue;
        if (/\b(logo|map|flag|diagram|poster|screenshot|cartoon|caricature|chart|stamp|coat of arms)\b/.test(hay)) continue;
        const artist = stripHtml(meta.Artist?.value);
        const license = stripHtml(meta.LicenseShortName?.value) || 'Wikimedia Commons';
        return {
          url: info.thumburl || info.url,
          alt: (stripHtml(meta.ObjectName?.value) || title).slice(0, 140),
          credit: artist ? `Photo: ${artist.slice(0, 80)} / Wikimedia Commons (${license})` : `Wikimedia Commons (${license})`
        };
      }
    } catch (err) {
      console.warn(`  Image lookup failed for "${entity}": ${err.message}`);
    }
  }
  return null;
}

// ---------- storage ----------

function loadArticles() {
  try {
    return JSON.parse(fs.readFileSync(ARTICLES_PATH, 'utf8'));
  } catch {
    return { lastUpdated: new Date().toISOString(), articles: [] };
  }
}

function saveArticles(data) {
  data.lastUpdated = new Date().toISOString();
  fs.writeFileSync(ARTICLES_PATH, JSON.stringify(data, null, 2));
}

async function main() {
  if (!GROQ_API_KEY) {
    console.error('Missing GROQ_API_KEY secret');
    process.exit(1);
  }
  console.log('MeridianMatters generator v2 (source-grounded, fact-gated)');
  console.log('Time:', new Date().toISOString());

  const data = loadArticles();
  const usedUrls = new Set((data.articles || []).map(a => a.sourceUrl).filter(Boolean));
  const existingTitles = (data.articles || []).flatMap(a => [a.title, a.sourceTitle]).filter(Boolean);
  const added = [];

  for (const category of CATEGORIES) {
    console.log(`\n-> ${category.name}`);
    try {
      const candidates = await collectCandidates(category.id);
      console.log(`  ${candidates.length} fresh candidate(s)`);
      let tried = 0;
      for (const item of candidates) {
        if (tried >= MAX_CANDIDATES_PER_CATEGORY) break;
        if (usedUrls.has(item.link) || isDuplicateTitle(item.title, existingTitles)) continue;
        tried++;
        console.log(`  Candidate: ${item.title} (${item.source})`);

        let sourceText = '';
        try {
          sourceText = extractArticleText(await fetchText(item.link));
        } catch (err) {
          console.log(`    could not fetch article: ${err.message}`);
          continue;
        }
        const sw = countWords(sourceText);
        if (sw < MIN_SOURCE_WORDS) {
          console.log(`    source too thin (${sw} words), skipping`);
          continue;
        }

        const draft = await writeWithGates(item, sourceText);
        if (!draft) {
          console.log('    could not produce a draft that passes the fact checks, skipping');
          continue;
        }

        // Only trust names that also appear capitalised in the source article
        // (real proper nouns), so generic phrases like "Lung Surgery" never
        // pull in a topically-similar but wrong photo.
        const entities = extractEntities(item.title).filter(e => sourceText.includes(e));
        const image = await findImage(entities);
        console.log(`  Image: ${image ? image.alt : 'none (no entity-matched photo)'}`);

        const article = {
          id: `${category.id}-${Date.now().toString(36)}`,
          category: category.id,
          title: draft.title.trim(),
          summary: draft.summary.trim(),
          content: draft.content.trim(),
          author: 'MeridianMatters Newsroom',
          date: new Date().toISOString().split('T')[0],
          image: image ? image.url : '',
          imageAlt: image ? image.alt : '',
          imageCredit: image ? image.credit : '',
          images: [],
          tags: [category.id],
          featured: false,
          status: 'published',
          sourceName: item.source,
          sourceUrl: item.link,
          sourceTitle: item.title,
          aiAssisted: true,
          editorChecked: true,
          wordCount: countWords(draft.content)
        };
        added.push(article);
        usedUrls.add(item.link);
        existingTitles.push(article.title, item.title);
        console.log(`  Published: ${article.title} (${article.wordCount} words)`);
        break;
      }
    } catch (err) {
      console.error(`  Failed for ${category.name}: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  if (!added.length) {
    console.log('\nNo articles passed the quality gates this run. Nothing published.');
    return;
  }

  const lead = added.find(a => a.image) || added[0];
  lead.featured = true;

  data.articles = [...added, ...(data.articles || [])].slice(0, MAX_ARTICLES);
  saveArticles(data);
  console.log(`\nAdded ${added.length} article(s). Total now: ${data.articles.length}`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
} else {
  module.exports = { checkGates, extractArticleText, extractEntities, parseRss, isDuplicateTitle, countWords };
}
