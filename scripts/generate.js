/**
 * MeridianMatters - Automated Article Generator
 * Free stack: Groq + Google News RSS (for real grounding) + Unsplash + GitHub Actions
 *
 * Key change from the previous version: articles are now written based on a
 * REAL current headline pulled from Google News RSS, not a vague made-up
 * "topic" prompt. Free-generating from a vague topic gave the model nothing
 * real to report on, so it invented fake events/quotes/statistics to fill
 * the word count. Grounding in a real headline fixes that at the source.
 *
 * Word count is now actually enforced with a retry loop, not just logged.
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
const MIN_ACCEPTABLE_WORDS = 700; // absolute floor if 3 retries can't hit 1000
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

// ---- Real headline retrieval (Google News RSS, no API key required) ----

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

    if (excludeUrls.has(link)) continue; // already covered this exact story

    return {
      title,
      link,
      source: sourceMatch ? decodeEntities(sourceMatch[1]) : 'a news wire service',
      pubDate: pubDateMatch ? pubDateMatch[1] : ''
    };
  }

  return null; // nothing fresh found
}

function countWords(text) {
  return (text || '').trim().split(/\s+/).filter(Boolean).length;
}

// ---- Article generation, grounded in a real headline ----

async function generateArticleOnce(category, headline, relatedCandidates) {
  const relatedBlock = relatedCandidates.length
    ? `\nPREVIOUSLY PUBLISHED MERIDIANMATTERS ARTICLES (optional cross-links):
${relatedCandidates.map(r => `- id: "${r.id}" | title: "${r.title}"`).join('\n')}

If, and ONLY if, one of the above is genuinely relevant to a point you're making, you may reference it inline using this exact syntax: [[id|visible link text]]
Example: "as covered in [[finance-abc123|our recent report on rate decisions]]"
Do not force a reference if none are truly relevant. Include at most 2 such links. Never invent an id that isn't in the list above.`
    : '';

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

ATTRIBUTION (mandatory):
- Naturally mention "${headline.source}" by name at least once in the body (e.g. "according to ${headline.source}" or "${headline.source} reports that...").
${relatedBlock}

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

// Actually enforces the word-count minimum instead of just logging a
// warning: retries up to MAX_ATTEMPTS times and keeps the longest result.
// Only falls back to a shorter article if it clears an absolute floor.
async function generateArticleWithRetry(category, headline, relatedCandidates) {
  let best = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      console.log(`  Attempt ${attempt}/${MAX_ATTEMPTS}...`);
      const result = await generateArticleOnce(category, headline, relatedCandidates);
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

// Pull the more meaningful words out of the real headline for image
// search, instead of generic category names like "Health news" which
// return whatever generic stock photo happens to match that phrase.
const STOPWORDS = new Set(['a','an','the','of','in','on','at','to','for','and','or','is','are','with','after','over','amid','as','its','their']);

function headlineKeywords(title, count) {
  const words = (title || '')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .split(' ')
    .filter(w => w.length > 2 && !STOPWORDS.has(w.toLowerCase()));
  return words.slice(0, count).join(' ');
}

// Unsplash's own alt_description metadata is often useless — some photos
// are tagged by photographers with a single generic word ("text", "photo",
// "design"). Reject anything too short or on a known-junk list, and fall
// back to a cleaned-up version of the search query instead, which is
// always at least topically descriptive.
const JUNK_ALT_WORDS = new Set([
  'text', 'photo', 'image', 'design', 'background', 'pattern',
  'abstract', 'photography', 'picture', 'graphic', 'art'
]);

function cleanCaption(altDescription, fallbackQuery) {
  const alt = (altDescription || '').trim();
  const isJunk = !alt || alt.length < 12 || JUNK_ALT_WORDS.has(alt.toLowerCase());
  if (isJunk) {
    // Turn the raw search query into a readable, capitalized caption.
    return fallbackQuery
      .split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
  return alt.charAt(0).toUpperCase() + alt.slice(1);
}

async function getImage(query) {
  // Try Wikimedia Commons first — a real photo library of actual named
  // people, places, and organizations, with mandatory license/attribution
  // metadata on every file. Falls back to Unsplash stock photography if
  // nothing relevant turns up (which is common for query terms that aren't
  // a specific real-world proper noun).
  const wiki = await getWikimediaImage(query);
  if (wiki) return wiki;

  if (!UNSPLASH_ACCESS_KEY) return { url: '', alt: query, credit: '' };
  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=6&orientation=landscape`;
    const data = await fetchJSON(url, {
      headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` }
    });
    const results = data.results || [];
    if (results.length === 0) return { url: '', alt: query, credit: '' };
    const photo = results[Math.floor(Math.random() * Math.min(4, results.length))];
    const rawUrl = photo.urls?.regular || photo.urls?.small || '';
    // Ask Unsplash to serve a smaller, more compressed version — full-size
    // "regular" photos are ~1080px and needlessly heavy on a phone screen,
    // especially on slow connections.
    const optimizedUrl = rawUrl ? `${rawUrl}&w=900&q=70&auto=format` : '';
    const photographer = photo.user?.name || 'Unsplash';
    return {
      url: optimizedUrl,
      alt: cleanCaption(photo.alt_description, query),
      credit: `Photo: ${photographer} / Unsplash`
    };
  } catch (err) {
    console.error('  Unsplash error:', err.message);
    return { url: '', alt: query, credit: '' };
  }
}

// Strips Wikimedia's HTML-formatted extmetadata fields (Artist, License
// name) down to plain text for a clean credit line.
function stripHtml(str) {
  return (str || '').replace(/<[^>]*>/g, '').trim();
}

async function getWikimediaImage(query) {
  try {
    const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=8&prop=imageinfo&iiprop=url|extmetadata|size&iiurlwidth=900&format=json&formatversion=2&origin=*`;
    const data = await fetchJSON(url);
    const pages = data?.query?.pages || [];

    for (const page of pages) {
      const info = page.imageinfo?.[0];
      if (!info) continue;

      // Skip anything too small (thumbnails, icons) or not a real photo
      // (svg diagrams, logos) — width/height and mime give us a decent filter.
      const isPhoto = info.mime === 'image/jpeg' || info.mime === 'image/png';
      const wideEnough = (info.width || 0) >= 700;
      if (!isPhoto || !wideEnough) continue;

      const meta = info.extmetadata || {};
      const artist = stripHtml(meta.Artist?.value);
      const license = stripHtml(meta.LicenseShortName?.value) || 'Wikimedia Commons';
      const title = stripHtml(meta.ObjectName?.value) || page.title.replace(/^File:/, '').replace(/\.\w+$/, '');

      const credit = artist
        ? `Photo: ${artist} / Wikimedia Commons (${license})`
        : `Wikimedia Commons (${license})`;

      return {
        url: info.thumburl || info.url,
        alt: title,
        credit
      };
    }
    return null; // nothing suitable found — caller falls back to Unsplash
  } catch (err) {
    console.error('  Wikimedia error:', err.message);
    return null;
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

  // Don't re-cover a story we've already published an article about.
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

      // Give the model a short list of already-published, same-category
      // articles it can optionally cross-link to — only real ids, only if
      // genuinely relevant (enforced in the prompt).
      const relatedCandidates = (data.articles || [])
        .filter(a => a.category === category.id && (a.status || 'published') === 'published')
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 5)
        .map(a => ({ id: a.id, title: a.title }));

      const generated = await generateArticleWithRetry(category, headline, relatedCandidates);
      console.log(`  Title: ${generated.title}`);
      console.log(`  Final word count: ${countWords(generated.content)}`);

      const image = await getImage(`${headlineKeywords(headline.title, 4)} ${category.name}`);
      console.log(`  Image: ${image.url ? 'Yes' : 'No'}`);

      // Extra inline images so the article isn't just a single hero image —
      // spread through the body like a real publication layout. Different
      // keyword slices of the real headline keep them varied from the hero
      // shot and from each other, rather than repeating the same generic
      // category search three times.
      const inlineImage1 = await getImage(`${headlineKeywords(headline.title, 3)}`);
      const inlineImage2 = await getImage(`${category.name} ${headlineKeywords(headline.title, 2)}`);
      const images = [inlineImage1, inlineImage2].filter(img => img.url);
      console.log(`  Inline images: ${images.length}`);

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
        imageCredit: image.credit || '',
        images,
        tags: [category.id],
        featured: Math.random() > 0.45,
        status: 'published',
        sourceName: headline.source,
        sourceUrl: headline.link,
        aiAssisted: true
      });

      usedSourceUrls.add(headline.link);

      // Longer delay because we are generating big articles and doing retries.
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
