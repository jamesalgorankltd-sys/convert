export default async function handler(req, res) {
  try {
    const { url, asText } = req.query || {};
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ ok: false, error: 'Valid http/https url required' });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    const r = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': asText === '1'
          ? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          : 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      }
    });
    clearTimeout(timer);
    const contentType = r.headers.get('content-type') || '';
    if (!r.ok) return res.status(r.status).json({ ok: false, error: 'HTTP ' + r.status });
    if (asText !== '1' && !String(contentType || '').startsWith('image/')) {
      return res.status(415).json({ ok: false, error: 'URL is not a direct image (' + (contentType || 'unknown content-type') + ')' });
    }
    if (asText === '1') {
      const text = await r.text();
      return res.status(200).json({ ok: true, status: r.status, contentType, text });
    }
    const ab = await r.arrayBuffer();
    const base64 = Buffer.from(ab).toString('base64');
    return res.status(200).json({ ok: true, status: r.status, contentType, base64 });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
