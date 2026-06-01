function decodeDeep(value) {
  let s = String(value || '');
  for (let i = 0; i < 4; i++) {
    try {
      const d = decodeURIComponent(s);
      if (d === s) break;
      s = d;
    } catch (_) { break; }
  }
  return s;
}
function absUrl(u, base) {
  try { return new URL(u, base).href; } catch (_) { return ''; }
}
function cleanCandidate(u) {
  if (!u) return '';
  u = decodeDeep(String(u).trim()).replace(/&amp;/g, '&');
  u = u.replace(/[\s"'<>]+$/g, '');
  return u;
}

function noHashUrl(u) {
  try { const x = new URL(String(u || '')); x.hash = ''; return x.href; } catch (_) { return String(u || '').split('#')[0]; }
}
function pageSlugParts(pageUrl) {
  try {
    const pathname = new URL(noHashUrl(pageUrl)).pathname;
    const file = pathname.split('/').pop() || '';
    const decoded = decodeDeep(file);
    const idMatch = decoded.match(/_(\d+)\.(?:html?|php|aspx?)$/i) || decoded.match(/_(\d+)(?:\D|$)/i);
    const rawSlug = decoded.replace(/_\d+\.(?:html?|php|aspx?)$/i, '').replace(/\.(?:html?|php|aspx?)$/i, '');
    const tokens = rawSlug.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 4 && !/^(with|from|free|image|photo|screen|coming|out|live)$/i.test(t));
    return { id: idMatch ? idMatch[1] : '', slug: rawSlug.toLowerCase(), tokens };
  } catch (_) { return { id:'', slug:'', tokens:[] }; }
}

function candidateMatchesExactPage(candidateUrl, pageUrl, hintText='') {
  const info = pageSlugParts(pageUrl);
  if (!info.id) return true;
  const hay = (String(candidateUrl || '') + ' ' + String(hintText || '')).toLowerCase();
  return hay.includes(info.id);
}
function strictExactPageFilter(candidates, pageUrl) {
  const info = pageSlugParts(pageUrl);
  const list = unique(candidates || []);
  if (!info.id) return list;
  const exact = list.filter(u => String(u || '').toLowerCase().includes(info.id));
  // For stock/free-ai pages with numeric IDs, never return a different related image.
  // If exact URL is unavailable, screenshot/data fallback may still be returned separately.
  return exact;
}
function dataImageCandidates(candidates) {
  return unique(candidates || []).filter(u => /^data:image\//i.test(String(u || '')));
}

function matchPageScore(candidateUrl, pageUrl, hintText='') {
  const info = pageSlugParts(pageUrl);
  const hay = (String(candidateUrl || '') + ' ' + String(hintText || '')).toLowerCase();
  let score = 0;
  if (info.id && hay.includes(info.id)) score += 20000000;
  let hits = 0;
  for (const t of info.tokens) if (hay.includes(t)) hits++;
  if (hits) score += hits * 900000;
  if (info.tokens.length && hits >= Math.min(3, info.tokens.length)) score += 3500000;
  return score;
}
function rankForOriginalPage(candidates, pageUrl) {
  const info = pageSlugParts(pageUrl);
  return unique(candidates || []).sort((a,b) => matchPageScore(b, pageUrl) - matchPageScore(a, pageUrl));
}

function isBad(u) {
  return /(logo|icon|avatar|sprite|placeholder|tracking|pixel|adsbygoogle|favicon|blank\.gif|transparent)/i.test(u || '');
}
function isImageish(u) {
  return /^data:image\//i.test(u) || /\.(png|jpe?g|webp|gif|avif|bmp|svg)(\?|#|$)/i.test(u || '') || /\b(image|photo|media|cdn|upload|img)\b/i.test(u || '');
}
function addCandidate(out, seen, raw, base, score) {
  let u = cleanCandidate(raw);
  if (!u) return;
  if (u.startsWith('//')) u = 'https:' + u;
  if (!/^https?:\/\//i.test(u) && !/^data:image\//i.test(u)) u = absUrl(u, base);
  if (!/^https?:\/\//i.test(u) && !/^data:image\//i.test(u)) return;
  if (!isImageish(u)) return;
  if (isBad(u)) score -= 10000;
  const key = u.split('#')[0];
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ url: u, score });
}
function extractSrcset(srcset, base, out, seen, score) {
  String(srcset || '').split(',').forEach((part, i) => {
    const bits = part.trim().split(/\s+/);
    const size = parseInt(bits[1] || '', 10) || 0;
    addCandidate(out, seen, bits[0], base, score + size - i);
  });
}
function walkJson(x, base, out, seen, score) {
  if (!x) return;
  if (typeof x === 'string') { addCandidate(out, seen, x, base, score); return; }
  if (Array.isArray(x)) { x.forEach(v => walkJson(v, base, out, seen, score)); return; }
  if (typeof x === 'object') Object.entries(x).forEach(([k, v]) => {
    walkJson(v, base, out, seen, /image|photo|thumbnail|contentUrl|url/i.test(k) ? score + 2500 : score);
  });
}
function extractCandidatesFromHtml(html, base) {
  const out = [], seen = new Set();
  const metaPatterns = [
    /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["'][^>]*>/ig,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image:secure_url["'][^>]*>/ig,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/ig,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/ig,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["'][^>]*>/ig,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["'][^>]*>/ig,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["'][^>]*>/ig
  ];
  metaPatterns.forEach((re, idx) => { let m; while ((m = re.exec(html))) addCandidate(out, seen, m[1], base, 50000 - idx); });

  let m;
  const ld = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/ig;
  while ((m = ld.exec(html))) {
    try { walkJson(JSON.parse(m[1]), base, out, seen, 42000); } catch (_) {}
  }
  const imgTag = /<(img|source)\b[^>]*>/ig;
  while ((m = imgTag.exec(html))) {
    const tag = m[0];
    const attrs = {};
    tag.replace(/([:\w-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g, (_, k, __, v1, v2, v3) => { attrs[k.toLowerCase()] = v1 || v2 || v3 || ''; return ''; });
    extractSrcset(attrs.srcset || attrs['data-srcset'] || '', base, out, seen, 33000);
    ['src','data-src','data-lazy-src','data-original','data-url','data-full','data-image','data-large_image','data-hires','data-zoom-image'].forEach((k, i) => addCandidate(out, seen, attrs[k], base, 30000 - i));
  }
  const cssUrl = /url\((['"]?)([^)'"\s]+)\1\)/ig;
  while ((m = cssUrl.exec(html))) addCandidate(out, seen, m[2], base, 18000);
  const rawUrl = /https?:\/\/[^\s"'<>\\]+/ig;
  while ((m = rawUrl.exec(html))) addCandidate(out, seen, m[0], base, 10000);

  return out.sort((a, b) => b.score - a.score).map(x => x.url).slice(0, 30);
}


async function extractCandidatesWithHeadlessBrowser(pageUrl) {
  const originalPageUrl = String(pageUrl || '');
  const fetchPageUrl = noHashUrl(originalPageUrl);
  let browser;
  try {
    const chromium = (await import('@sparticuz/chromium')).default;
    const puppeteer = await import('puppeteer-core');
    browser = await puppeteer.launch({
      args: [...chromium.args, '--disable-web-security', '--disable-features=IsolateOrigins,site-per-process'],
      defaultViewport: { width: 1365, height: 900 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'accept-language': 'en-US,en;q=0.9',
      'upgrade-insecure-requests': '1'
    });
    await page.goto(originalPageUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    try { await page.waitForNetworkIdle({ idleTime: 900, timeout: 7000 }); } catch (_) {}
    try { await page.evaluate(() => window.scrollTo(0, Math.floor(document.body.scrollHeight * 0.35))); await new Promise(r => setTimeout(r, 1000)); } catch (_) {}
    const data = await page.evaluate(() => {
      const abs = (u) => { try { return new URL(u, location.href).href; } catch(e){ return ''; } };
      const items = [];
      const add = (url, score, hint='') => { if(url) items.push({url: abs(String(url).replace(/&amp;/g,'&').trim()), score, hint}); };
      const meta = [
        'meta[property="og:image:secure_url"]','meta[property="og:image"]','meta[name="twitter:image"]','meta[name="twitter:image:src"]','meta[itemprop="image"]','link[rel="image_src"]'
      ];
      meta.forEach((sel, i) => { const el = document.querySelector(sel); add(el && (el.content || el.href), 90000 - i, el ? (el.getAttribute('alt') || el.getAttribute('title') || el.getAttribute('content') || '') : ''); });
      document.querySelectorAll('script[type="application/ld+json"]').forEach((sc) => {
        try {
          const walk = (x) => {
            if (!x) return;
            if (typeof x === 'string') { if (/\.(png|jpe?g|webp|gif|avif)(\?|#|$)|\/image\/|\/photo\/|cdn|img/i.test(x)) add(x, 78000, x); return; }
            if (Array.isArray(x)) return x.forEach(walk);
            if (typeof x === 'object') Object.entries(x).forEach(([k,v]) => { if (/image|photo|thumbnail|contentUrl|url/i.test(k)) { if (typeof v === 'string') add(v, 82000, v); else walk(v); } else walk(v); });
          };
          walk(JSON.parse(sc.textContent || '{}'));
        } catch(e) {}
      });
      document.querySelectorAll('img, picture source').forEach((el, i) => {
        const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : {width:0,height:0};
        const naturalW = el.naturalWidth || el.videoWidth || parseInt(el.getAttribute('width') || '0', 10) || rect.width || 0;
        const naturalH = el.naturalHeight || el.videoHeight || parseInt(el.getAttribute('height') || '0', 10) || rect.height || 0;
        const area = Math.round((naturalW || rect.width || 0) * (naturalH || rect.height || 0));
        const baseScore = 50000 + Math.min(area, 8000000) - i;
        const srcset = el.getAttribute('srcset') || el.getAttribute('data-srcset') || '';
        srcset.split(',').forEach((part, idx) => {
          const bits = part.trim().split(/\s+/); if (!bits[0]) return;
          const n = parseInt(bits[1] || '0', 10) || 0;
          add(bits[0], baseScore + n - idx);
        });
        const hint = [el.getAttribute('alt'), el.getAttribute('title'), el.getAttribute('aria-label'), el.closest('a')?.getAttribute('title')].filter(Boolean).join(' ');
        ['currentSrc','src'].forEach((k) => add(el[k], baseScore, hint));
        ['data-src','data-lazy-src','data-original','data-url','data-full','data-image','data-large_image','data-hires','data-zoom-image','data-thumb'].forEach((k, idx) => add(el.getAttribute(k), baseScore - idx, hint));
      });
      document.querySelectorAll('[style]').forEach((el, i) => {
        const st = el.getAttribute('style') || '';
        const m = st.match(/url\((['"]?)(.*?)\1\)/i);
        if (m) add(m[2], 30000 - i, el.textContent || '');
      });
      return items;
    });

    let ranked = (data || [])
      .filter(x => x && x.url && /^https?:\/\//i.test(x.url))
      .filter(x => !/(logo|icon|avatar|sprite|placeholder|tracking|pixel|adsbygoogle|favicon|blank\.gif|transparent)/i.test(x.url))
      .sort((a,b) => ((b.score || 0) + matchPageScore(b.url, originalPageUrl, b.hint)) - ((a.score || 0) + matchPageScore(a.url, originalPageUrl, a.hint)));

    const exactRanked = ranked.filter(x => candidateMatchesExactPage(x.url, originalPageUrl, x.hint));
    if (exactRanked.length) return exactRanked.map(x => x.url);

    // Last-resort same-page fallback: if the site hides the real file URL or blocks backend fetch,
    // take a screenshot of the largest visible image area from the exact opened page. This avoids
    // returning a related/random image URL from another item. It is only used when no exact-ID
    // source URL is present in the page DOM/metadata.
    try {
      const clip = await page.evaluate(() => {
        const bad = /logo|icon|avatar|sprite|placeholder|tracking|pixel|ads|banner/i;
        const els = Array.from(document.querySelectorAll('img')).map((el) => {
          const r = el.getBoundingClientRect();
          const alt = (el.getAttribute('alt') || el.getAttribute('title') || el.src || '').toLowerCase();
          return { x:r.x, y:r.y, width:r.width, height:r.height, area:r.width*r.height, alt };
        }).filter(r => r.width >= 220 && r.height >= 160 && r.area > 60000 && !bad.test(r.alt));
        els.sort((a,b)=>b.area-a.area);
        if (!els[0]) return null;
        const r = els[0];
        return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(window.innerWidth, r.width), height: Math.min(window.innerHeight, r.height) };
      });
      if (clip && clip.width && clip.height) {
        const buf = await page.screenshot({ type:'png', clip });
        return ['data:image/png;base64,' + Buffer.from(buf).toString('base64')];
      }
    } catch (_) {}

    return [];
  } finally {
    try { if (browser) await browser.close(); } catch (_) {}
  }
}

async function fetchViaJinaReader(url) {
  const originalUrl = String(url || '');
  const fetchUrl = noHashUrl(originalUrl);
  const readerUrl = 'https://r.jina.ai/' + fetchUrl;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const r = await fetch(readerUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
        'Accept': 'text/plain, text/markdown, */*',
        'Cache-Control': 'no-cache'
      }
    });
    if (!r.ok) throw new Error('Jina HTTP ' + r.status);
    const text = await r.text();
    return extractCandidatesFromHtml(text, originalUrl).concat(extractMarkdownImageCandidates(text, originalUrl));
  } finally { clearTimeout(timer); }
}

function extractMarkdownImageCandidates(text, base) {
  const out = [], seen = new Set();
  let m;
  const mdImg = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  while ((m = mdImg.exec(text || ''))) addCandidate(out, seen, m[1], base, 60000);
  const mdLink = /\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
  while ((m = mdLink.exec(text || ''))) addCandidate(out, seen, m[1], base, 42000);
  const raw = /https?:\/\/[^\s)"'<>\\]+/g;
  while ((m = raw.exec(text || ''))) addCandidate(out, seen, m[0], base, 30000);
  return out.sort((a,b)=>b.score-a.score).map(x=>x.url);
}

function filterUsefulImageCandidates(arr, pageUrl) {
  return unique(arr || []).filter(u => {
    const s = String(u || '');
    if (!/^https?:\/\//i.test(s) && !/^data:image\//i.test(s)) return false;
    if (s.split('#')[0] === String(pageUrl || '').split('#')[0]) return false;
    if (/\.(html?|php|aspx?)(\?|#|$)/i.test(s)) return false;
    if (/magnific\.com\/.+free-ai-image\//i.test(s)) return false;
    if (/(logo|icon|avatar|sprite|placeholder|tracking|pixel|adsbygoogle|favicon|blank\.gif|transparent)/i.test(s)) return false;
    return isImageish(s);
  });
}

async function fetchHtmlCandidates(url) {
  const originalUrl = String(url || '');
  const fetchUrl = noHashUrl(originalUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  const r = await fetch(fetchUrl, {
    method: 'GET',
    redirect: 'follow',
    signal: controller.signal,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': new URL(fetchUrl).origin + '/',
      'Origin': new URL(fetchUrl).origin,
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    }
  });
  clearTimeout(timer);
  const contentType = r.headers.get('content-type') || '';
  if (!r.ok) {
    const err = new Error('Page HTTP ' + r.status);
    err.status = r.status;
    throw err;
  }
  if (contentType.startsWith('image/')) return [originalUrl];
  const html = await r.text();
  return extractCandidatesFromHtml(html, originalUrl);
}

function unique(arr) {
  const out = [], seen = new Set();
  for (const u of arr || []) {
    const k = String(u || '').split('#')[0];
    if (!k || seen.has(k)) continue;
    seen.add(k); out.push(u);
  }
  return out;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST required' });
    let { url } = req.body || {};
    if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ ok: false, error: 'Valid page url required' });
    const originalUrl = String(url || '');
    const fetchUrl = noHashUrl(originalUrl);
    let candidates = [];
    let fetchError = '';
    try { candidates = await fetchHtmlCandidates(originalUrl); }
    catch (e) { fetchError = e?.message || String(e); }

    // Strong fallback for sites that return 403/JS-rendered pages to normal server fetch.
    // This uses a real headless Chromium browser on Vercel and reads the actual pasted page,
    // not guessed img/free-photo URLs.
    // Jina Reader fallback: often succeeds when the target blocks Vercel/server fetch with 403.
    // It still reads the exact pasted page URL and extracts image links from the returned page/markdown.
    if (!candidates.length || /403|forbidden|Page HTTP 403/i.test(fetchError)) {
      try { candidates = unique([...(await fetchViaJinaReader(originalUrl)), ...candidates]); }
      catch (e) { fetchError = fetchError || (e?.message || String(e)); }
    }

    // Optional Chromium fallback only if packages are available on the deployment.
    if (!candidates.length || /403|forbidden|Page HTTP 403/i.test(fetchError)) {
      try { candidates = unique([...(await extractCandidatesWithHeadlessBrowser(originalUrl)), ...candidates]); }
      catch (e) { /* keep Jina/fetch result */ }
    }

    let useful = filterUsefulImageCandidates(candidates, originalUrl);
    const screenshots = dataImageCandidates(useful);
    const strict = strictExactPageFilter(useful.filter(u => !/^data:image\//i.test(String(u || ''))), originalUrl);
    candidates = rankForOriginalPage(strict, originalUrl).concat(screenshots);
    if (!candidates.length) return res.status(200).json({ ok: false, error: 'Exact same-page image not found. Protected page did not expose an image URL containing this page ID, and browser screenshot fallback was unavailable. Please use direct image URL or drag/drop from the opened page.', candidates: [] });
    return res.status(200).json({ ok: true, candidates: candidates.slice(0, 40), finalUrl: originalUrl, usedFallback: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
