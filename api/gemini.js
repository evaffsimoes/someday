const MAX_SHARED_TEXT_LENGTH = 10_000;
const MAX_INLINE_IMAGE_BASE64_LENGTH = 4_000_000;
const MAX_POSTER_BYTES = 2_000_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 12;
const requestLog = new Map();

function isRateLimited(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const recent = (requestLog.get(ip) || []).filter(time => now - time < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  requestLog.set(ip, recent);
  return recent.length > RATE_LIMIT_MAX_REQUESTS;
}

function extractInstagramUrl(sharedText) {
  if (!sharedText) return null;
  const match = sharedText.match(/https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|reels|tv)\/[\w.-]+/i);
  return match ? match[0] : null;
}

async function scrapeInstagramMetadata(sharedText) {
  let enrichedText = sharedText;
  let posterImageDataUrl = null;

  const instaUrl = extractInstagramUrl(sharedText);
  if (!instaUrl) return { enrichedText, posterImageDataUrl };

  const matchCode = instaUrl.match(/(?:p|reel|reels|tv)\/([\w.-]+)/i);
  const code = matchCode ? matchCode[1] : null;

  if (code) {
    const cleanUrl = `https://www.instagram.com/p/${code}/`;

    // 1. Try official Instagram public oEmbed endpoint
    try {
      const oembedRes = await fetch(`https://api.instagram.com/oembed/?url=${encodeURIComponent(cleanUrl)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(5000)
      });
      if (oembedRes.ok) {
        const oembedData = await oembedRes.json();
        if (oembedData.title) {
          const authorStr = oembedData.author_name ? `Post by @${oembedData.author_name}` : '';
          enrichedText = [authorStr, oembedData.title, sharedText].filter(Boolean).join(' | ');
        }
        if (oembedData.thumbnail_url && !posterImageDataUrl) {
          try {
            const imgRes = await fetch(oembedData.thumbnail_url, { signal: AbortSignal.timeout(5000) });
            if (imgRes.ok) {
              const mime = imgRes.headers.get('content-type')?.split(';')[0].toLowerCase() || 'image/jpeg';
              const buf = Buffer.from(await imgRes.arrayBuffer());
              if (buf.byteLength <= MAX_POSTER_BYTES) {
                posterImageDataUrl = `data:${mime};base64,${buf.toString('base64')}`;
              }
            }
          } catch (_) {}
        }
      }
    } catch (_) {}

    // 2. Try Instagram official embed captioned page (unauthenticated public HTML)
    if (enrichedText === sharedText) {
      const embedUrl = `https://www.instagram.com/p/${code}/embed/captioned/`;
      try {
        const res = await fetch(embedUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'text/html'
          },
          signal: AbortSignal.timeout(6000)
        });
        if (res.ok) {
          const html = await res.text();
          const captionMatch = html.match(/<div[^>]*class=["']Caption["'][^>]*>(.*?)<\/div>/s) || html.match(/<div[^>]*class=["']CaptionText["'][^>]*>(.*?)<\/div>/s);
          let captionText = captionMatch ? captionMatch[1].replace(/<[^>]+>/g, ' ').trim() : '';

          const titleMatch = html.match(/<div[^>]*class=["']Header["'][^>]*>(.*?)<\/div>/s);
          let headerText = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, ' ').trim() : '';

          const imgMatch = html.match(/<img[^>]*class=["']EmbeddedMediaImage["'][^>]*src=["']([^"']+)["']/i) || html.match(/<img[^>]*src=["']([^"']+)["'][^>]*class=["']EmbeddedMediaImage["']/i);
          let imgUrl = imgMatch ? imgMatch[1].replace(/&amp;/g, '&') : '';

          if (captionText || headerText) {
            enrichedText = [headerText, captionText, sharedText].filter(Boolean).join(' | ');
          }

          if (imgUrl && !posterImageDataUrl) {
            try {
              const imgRes = await fetch(imgUrl, { signal: AbortSignal.timeout(5000) });
              if (imgRes.ok) {
                const mime = imgRes.headers.get('content-type')?.split(';')[0].toLowerCase() || 'image/jpeg';
                const buf = Buffer.from(await imgRes.arrayBuffer());
                if (buf.byteLength <= MAX_POSTER_BYTES) {
                  posterImageDataUrl = `data:${mime};base64,${buf.toString('base64')}`;
                }
              }
            } catch (_) {}
          }
        }
      } catch (_) {}
    }

    // 3. Fallback to ddinstagram / vxinstagram proxies
    if (enrichedText === sharedText) {
      for (const domain of ['ddinstagram.com', 'vxinstagram.com']) {
        try {
          const proxyUrl = `https://${domain}/p/${code}`;
          const proxyRes = await fetch(proxyUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
            signal: AbortSignal.timeout(5000)
          });
          if (proxyRes.ok) {
            const html = await proxyRes.text();
            const ogTitle = (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || [])[1] || '';
            const ogDesc = (html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) || [])[1] || '';
            let ogImage = (html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || [])[1] || '';
            ogImage = ogImage.replace(/&amp;/g, '&');

            if (ogTitle || ogDesc) {
              enrichedText = [ogTitle, ogDesc, sharedText].filter(Boolean).join(' | ');
              if (ogImage && !posterImageDataUrl) {
                try {
                  const imgRes = await fetch(ogImage, { signal: AbortSignal.timeout(5000) });
                  if (imgRes.ok) {
                    const mime = imgRes.headers.get('content-type')?.split(';')[0].toLowerCase() || 'image/jpeg';
                    const buf = Buffer.from(await imgRes.arrayBuffer());
                    if (buf.byteLength <= MAX_POSTER_BYTES) {
                      posterImageDataUrl = `data:${mime};base64,${buf.toString('base64')}`;
                    }
                  }
                } catch (_) {}
              }
              break;
            }
          }
        } catch (_) {}
      }
    }
  }

  return { enrichedText, posterImageDataUrl };
}

function validatePayload(body) {
  if (!body || typeof body !== 'object') throw new Error('A JSON request body is required');
  if (body.sharedUrl && (typeof body.sharedUrl !== 'string' || body.sharedUrl.length > MAX_SHARED_TEXT_LENGTH)) {
    throw new Error('Shared text is invalid or too long');
  }
  const inlineData = body.contents?.[0]?.parts?.find(part => part.inlineData)?.inlineData;
  if (inlineData) {
    if (!/^image\/(jpeg|png|webp)$/i.test(inlineData.mimeType || '') || typeof inlineData.data !== 'string' || inlineData.data.length > MAX_INLINE_IMAGE_BASE64_LENGTH) {
      throw new Error('Use a JPEG, PNG, or WebP image smaller than 3 MB');
    }
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is missing' });
  }
  if (isRateLimited(req)) {
    return res.status(429).json({ error: 'Too many requests. Please try again in a minute.' });
  }

  let extractedImageDataUrl = null;

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    validatePayload(body);
    const today = new Date().toISOString().slice(0, 10);

    if (body.sharedUrl) {
      const sharedUrlStr = body.sharedUrl;
      delete body.sharedUrl;

      const { enrichedText, posterImageDataUrl } = await scrapeInstagramMetadata(sharedUrlStr);
      if (posterImageDataUrl) extractedImageDataUrl = posterImageDataUrl;

      const parts = [];

      // If we downloaded a poster image from the Instagram post, pass it directly to Gemini Vision!
      if (posterImageDataUrl) {
        const [meta, base64Data] = posterImageDataUrl.split(',');
        const mimeType = meta.match(/data:(.*?);/)?.[1] || 'image/jpeg';
        parts.push({
          inlineData: {
            mimeType,
            data: base64Data
          }
        });
      }

      parts.push({
        text: `Today's date is ${today}. A user shared this Instagram event post link or caption: "${enrichedText}".
Extract the music/event details in Portugal.

Respond ONLY with a JSON object in this exact shape (no markdown):
{"artist": "Artist or Event Name", "startDate": "YYYY-MM-DD or empty string", "endDate": "YYYY-MM-DD or empty string", "time": "HH:MM in 24h format or empty string", "venue": "Venue name or empty string", "city": "City in Portugal or empty string", "category": "Concert or Festival or Other", "description": "Comma-separated list of artists/lineup, or a short note if lineup not found. No markdown."}

If the year is not mentioned, assume the next upcoming occurrence after today (${today}). Month names in Portuguese: janeiro=01, fevereiro=02, março=03, abril=04, maio=05, junho=06, julho=07, agosto=08, setembro=09, outubro=10, novembro=11, dezembro=12.`
      });

      body.contents = [{ parts }];

    } else if (body.contents?.[0]?.parts?.[0]) {
      body.contents[0].parts[0].text = `Today's date is ${today}. This image is a screenshot or poster of an Instagram event post. Extract the music/event details and respond ONLY with a JSON object (no markdown) in this exact shape:
{"artist": "Artist or Event Name", "startDate": "YYYY-MM-DD or empty string", "endDate": "YYYY-MM-DD or empty string", "time": "HH:MM in 24h format or empty string", "venue": "Venue name or empty string", "city": "City in Portugal or empty string", "category": "Concert or Festival or Other", "description": "Comma-separated list of artists/lineup, or a short note if lineup not found. No markdown."}
If the year isn't shown, assume the next upcoming occurrence after today (${today}).`;
    }

    const models = [
      'gemini-3.6-flash',
      'gemini-2.5-flash'
    ];

    let lastError = null;
    let data = null;

    for (const model of models) {
      for (const apiVersion of ['v1beta', 'v1']) {
        try {
          const response = await fetch(`https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });

          const resData = await response.json();
          if (response.ok && resData?.candidates?.[0]?.content) {
            data = resData;
            break;
          } else {
            lastError = resData?.error?.message || resData?.error || `Model ${model} failed (${response.status})`;
          }
        } catch (err) {
          lastError = err.message;
        }
      }
      if (data) break;
    }

    if (!data) {
      return res.status(503).json({ error: lastError || 'Gemini service temporarily unavailable.' });
    }

    if (extractedImageDataUrl) data._extractedImage = extractedImageDataUrl;
    return res.status(200).json(data);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
