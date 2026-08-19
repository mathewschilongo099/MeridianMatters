/**
 * MeridianMatters - Automated Article Generator
 * Free stack: Groq + Google News RSS (for real grounding) + Unsplash + GitHub Actions
 *
 * Articles are grounded in a REAL current headline pulled from Google News
 * RSS, not a vague made-up "topic" prompt. Word count is enforced with a
 * retry loop, not just logged.
 */

const fs = require('fs');
const path = require('path');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;

if (!GROQ_API_KEY) {
  console.error('Missing GROQ_API_KEY secret');
  process.exit(1);
}

const CATEGORIES = [
  { id: 'news', name: 'Global News' },
  { id: 'sports', name: 'Sports' },
  { id: 'health', name: 'Health' },
  { id: 'finance', name: 'Finance' }
];

const MIN_WORDS = 1000;
const MIN_ACCEPTABLE_WORDS = 700;
const MAX_ATTEMPTS = 3;

const ARTICLES_PATH = path.join(__dirname, '..', 'data', 'articles.json');

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.substring(0, 400)}`);
  return JSON.parse(text);
}

function decodeEntities(str) {
  return (str || '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

const RSS_QUERIES = {
  news: ['world news', 'international diplomacy', 'global politics'],
  sports: ['sports news', 'football OR basketball OR tennis', 'sports championship'],
  health: ['health news', 'medical research', 'public health'],
  finance: ['finance news', 'stock market', 'economy']
};

async function fetchTrendingHeadline(category, excludeUrls) {
  const queries = RSS_QUERIES[category.id];
  const query = queries[Math.floor(Math.random() * queries.length)];
  const feedUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;

  const res = await fetch(feedUrl);
  const xml = await res.text();

  const itemBlocks = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g)).map(m => m[1]);

  for (const block of itemBlocks.slice(0, 20)) {
    const titleMatch = block.match(/<title>(.*?)<\/title>/);
    const linkMatch = block.match(/<link>(.*?)<\/link>/);
    const sourceMatch = block.match(/<source[^>]*>(.*?)<\/source>/);
    const pubDateMatch = block.match(/<pubDate>(.*?)<\/pubDate>/);

    if (!titleMatch) continue;

    const title = decodeEntities(titleMatch[1]);
    const link = linkMatch ? decodeEntities(linkMatch[1]) : '';

    if (excludeUrls.has(link)) continue;

    return {
      title,
      link,
      source: sourceMatch ? decodeEntities(sourceMatch[1]) : 'a news wire service',
      pubDate: pubDateMatch ? pubDateMatch[1] : ''
    };
  }

  return null;
}

function countWords(text) {
  return (text || '').trim().split(/\s+/).filter(Boolean).length;
}

async function generateArticleOnce(category, headline) {
  const prompt = `You are a professional news writer for MeridianMatters, an online news magazine.

You are reporting on this real, currently published news item:

Headline: "${headline.title}"
Source: ${headline.source}
${headline.pubDate ? `Published: ${headline.pubDate}` : ''}

Write a full news article expanding on this real headline for a ${category.name} readership.

CRITICAL ACCURACY RULES (mandatory):
- Base the article ONLY on what is reasonably implied by the headline above.
- Do NOT invent specific statistics, direct quotes, named individuals, or numeric figures that are not present in the headline.
- When adding context or analysis, frame it clearly as general context or analysis rather than as newly reported fact (e.g. "analysts have generally noted" rather than a fabricated named analyst with an invented quote).
- Do not fabricate outcomes, figures, or details beyond what is reasonably inferable from the headline.
- It is better to write in well-hedged, general terms than to invent false specifics. Accuracy matters more than color.

LENGTH REQUIREMENT (mandatory):
- The "content" field must be AT LEAST ${MIN_WORDS} words. Write 9-13 well-developed paragraphs covering: what happened, why it matters, relevant background, and broader implications.
- Do not stop early. If you are unsure you have reached ${MIN_WORDS} words, continue writing additional context and analysis paragraphs before finishing.

FORMAT:
- title: A professional headline (max 14 words), may closely follow the real headline
- summary: 1-2 sentence teaser (max 45 words)
- content: the full ${MIN_WORDS}+ word article, paragraphs separated by newlines
- author: use exactly "MeridianMatters Newsroom" (do not invent a fake individual byline or credentials)

Return ONLY valid JSON with exactly these keys: title, summary, content, author.
Do not wrap the JSON in markdown. Do not add any text outside the JSON object.`;

  const data = await fetchJSON('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-120b',
      messages: [
        { role: 'system', content: 'You are a careful, accuracy-focused professional journalist. You only output valid JSON. Never use markdown code fences. You never invent facts, quotes, or statistics that are not grounded in the source headline given to you. You always write long, detailed articles when requested.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.6,
      max_tokens: 4500,
      response_format: { type: 'json_object' }
    })
  });

  const text = data?.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('Empty response from Groq');

  let cleaned = text.replace(/```json|```/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object found');

  const parsed = JSON.parse(cleaned.substring(start, end + 1));

  if (!parsed.title || !parsed.summary || !parsed.content || !parsed.author) {
    throw new Error('Missing required fields');
  }

  return parsed;
}

async function generateArticleWithRetry(category, headline) {
  let best = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      console.log(`  Attempt ${attempt}/${MAX_ATTEMPTS}...`);
      const result = await generateArticleOnce(category, headline);
      const wc = countWords(result.content);
      console.log(`  → ${wc} words`);

      if (!best || wc > countWords(best.content)) best = result;
      if (wc >= MIN_WORDS) return result;
    } catch (err) {
      console.warn(`  Attempt ${attempt} failed: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 1200));
  }

  if (best && countWords(best.content) >= MIN_ACCEPTABLE_WORDS) {
    console.warn(`  Using best attempt at ${countWords(best.content)} words (below ${MIN_WORDS} target, but above the ${MIN_ACCEPTABLE_WORDS}-word floor).`);
    return best;
  }

  throw new Error(`Could not reach the ${MIN_ACCEPTABLE_WORDS}-word floor after ${MAX_ATTEMPTS} attempts`);
}

async function getImage(query) {
  if (!UNSPLASH_ACCESS_KEY) return { url: '', alt: query };
  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=6&orientation=landscape`;
    const data = await fetchJSON(url, {
      headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` }
    });
    const results = data.results || [];
    if (results.length === 0) return { url: '', alt: query };
    const photo = results[Math.floor(Math.random() * Math.min(4, results.length))];
    return {
      url: photo.urls?.regular || photo.urls?.small || '',
      alt: photo.alt_description || query
    };
  } catch (err) {
    console.error('  Unsplash error:', err.message);
    return { url: '', alt: query };
  }
}

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
  console.log('  Saved articles.json');
}

async function main() {
  console.log('========================================');
  console.log('MeridianMatters Article Generator');
  console.log('Mode: Grounded in real headlines, 1000+ words enforced');
  console.log('Time:', new Date().toISOString());
  console.log('========================================');

  const data = loadArticles();
  const newArticles = [];

  const usedSourceUrls = new Set(
    (data.articles || []).map(a => a.sourceUrl).filter(Boolean)
  );

  for (const category of CATEGORIES) {
    try {
      console.log(`\n→ ${category.name}`);

      const headline = await fetchTrendingHeadline(category, usedSourceUrls);
      if (!headline) {
        console.log('  No fresh headline found for this category — skipping rather than fabricating one.');
        continue;
      }
      console.log(`  Headline: ${headline.title}`);
      console.log(`  Source: ${headline.source}`);

      const generated = await generateArticleWithRetry(category, headline);
      console.log(`  Title: ${generated.title}`);
      console.log(`  Final word count: ${countWords(generated.content)}`);

      const image = await getImage(`${category.name} ${generated.title.split(' ').slice(0, 4).join(' ')}`);
      console.log(`  Image: ${image.url ? 'Yes' : 'No'}`);

      newArticles.push({
        id: `${category.id}-${Date.now().toString(36)}`,
        category: category.id,
        title: generated.title,
        summary: generated.summary,
        content: generated.content,
        author: generated.author,
        date: new Date().toISOString().split('T')[0],
        image: image.url,
        imageAlt: image.alt,
        tags: [category.id],
        featured: Math.random() > 0.45,
        status: 'published',
        sourceName: headline.source,
        sourceUrl: headline.link,
        aiAssisted: true
      });

      usedSourceUrls.add(headline.link);

      await new Promise(r => setTimeout(r, 2500));
    } catch (err) {
      console.error(`✗ Failed for ${category.name}: ${err.message}`);
    }
  }

  if (newArticles.length === 0) {
    console.log('\nNo new articles were generated.');
    return;
  }

  data.articles = [...newArticles, ...data.articles].slice(0, 50);
  saveArticles(data);

  console.log('\n========================================');
  console.log(`✅ Successfully added ${newArticles.length} new articles`);
  console.log('Total articles now:', data.articles.length);
  console.log('========================================');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
