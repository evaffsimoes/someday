exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'GEMINI_API_KEY is missing' })
    };
  }

  try {
    const body = JSON.parse(event.body);

    // Check if a URL was passed for scraping
    if (body.sharedUrl) {
      try {
        const urlMatch = body.sharedUrl.match(/https?:\/\/[^\s]+/);
        const targetUrl = urlMatch ? urlMatch[0] : body.sharedUrl;
        
        const pageRes = await fetch(targetUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        const html = await pageRes.text();

        const ogTitle = (html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) || [])[1] || '';
        const ogDesc = (html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i) || [])[1] || '';
        const ogImage = (html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) || [])[1] || '';

        const parts = [
          { text: `Today's date is ${new Date().toISOString().slice(0,10)}. Extract event details from this Instagram post metadata:\nTitle: ${ogTitle}\nDescription: ${ogDesc}\nOriginal Text/URL: ${body.sharedUrl}\n\nRespond ONLY with a JSON object in this shape: {"name": string, "startDate": "YYYY-MM-DD" or "", "endDate": "YYYY-MM-DD" or "", "time": "HH:MM" (24h) or "", "location": string, "description": string (one short sentence)}. The events are in Portugal.` }
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
        console.warn('URL scraping failed, fallback to raw text prompt', err);
      }
    }

    const extractedImage = body._extractedImage;
    delete body._extractedImage;
    delete body.sharedUrl;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (extractedImage && data.candidates && data.candidates[0]) {
      data._extractedImage = extractedImage;
    }
    
    return {
      statusCode: response.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message })
    };
  }
};
