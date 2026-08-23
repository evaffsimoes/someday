export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is missing' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

    if (body.sharedUrl) {
      try {
        const urlMatch = body.sharedUrl.match(/https?:\/\/[^\s]+/);
        let targetUrl = urlMatch ? urlMatch[0] : body.sharedUrl;
        
        // If it's an Instagram post / reel / tv link, use Instagram's public embed endpoint!
        const igMatch = targetUrl.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
        if (igMatch && igMatch[1]) {
          targetUrl = `https://www.instagram.com/p/${igMatch[1]}/embed/captioned/`;
        }

        const pageRes = await fetch(targetUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        const html = await pageRes.text();

        let caption = (html.match(/<div class="Caption"[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || '';
        caption = caption.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

        const ogTitle = (html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) || [])[1] || '';
        const ogDesc = (html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i) || [])[1] || '';
        let ogImage = (html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) || [])[1] || '';
        if (!ogImage) {
          ogImage = (html.match(/<img[^>]*class=["'][^"']*EmbeddedMediaImage[^"']*["'][^>]*src=["']([^"']+)["']/i) || [])[1] || '';
        }

        const fullPostText = [caption, ogTitle, ogDesc, body.sharedUrl].filter(Boolean).join('\n');

        const parts = [
          { text: `Today's date is ${new Date().toISOString().slice(0,10)}. Extract event details from this shared Instagram post:\n${fullPostText}\n\nRespond ONLY with a JSON object in this shape: {"name": string, "startDate": "YYYY-MM-DD" or "", "endDate": "YYYY-MM-DD" or "", "time": "HH:MM" (24h) or "", "location": string, "description": string (one short sentence)}. The events are in Portugal, so format city names properly.` }
        ];

        let imageBase64 = null;
        if (ogImage) {
          try {
            const imgRes = await fetch(ogImage);
            const imgBuf = await imgRes.arrayBuffer();
            const b64 = Buffer.from(imgBuf).toString('base64');
            const mime = imgRes.headers.get('content-type') || 'image/jpeg';
            parts.push({ inlineData: { mimeType: mime, data: b64 } });
            imageBase64 = `data:${mime};base64,${b64}`;
          } catch(e) {}
        }

        body.contents = [{ parts }];
        body._extractedImage = imageBase64;
      } catch (err) {
        console.warn('Scraping error fallback', err);
      }
    }

    const extractedImage = body._extractedImage;
    delete body._extractedImage;
    delete body.sharedUrl;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (extractedImage && data.candidates && data.candidates[0]) {
      data._extractedImage = extractedImage;
    }
    
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
