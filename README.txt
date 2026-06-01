WEBP CDN SOURCE MAKER - VERCEL REAL BROWSER HD FIX

Deploy this folder/zip to Vercel.

Fixes:
- No guessed img.magnific/free-photo URL logic.
- Pasted page URL is resolved using /api/resolve-url first.
- Server fallback tries normal HTML, Jina reader, then headless Chromium browser.
- Cloudinary WebP URL uses f_webp,q_100 only. No forced resize/crop/blur.
- Dashboard JS duplicate convertSingle fixed so buttons do not become dummy.

Important:
Protected/private/login-only pages may still block Vercel. Public pages and pages readable by server/headless browser will work.
After redeploy press Cmd+Shift+R.
