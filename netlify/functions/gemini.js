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

    if (body.sharedUrl) {
      const sharedUrlStr = body.sharedUrl;
      delete body.sharedUrl;
      const parts = [
        { text: `Today's date is ${new Date().toISOString().slice(0,10)}. A user shared this event post link or caption from Instagram: "${sharedUrlStr}".
Extract the music/event details. The events are primarily music concerts, festivals, or parties in Portugal.

Respond ONLY with a JSON object in this exact shape:
{"artist": string (Artist or Event Name), "startDate": "YYYY-MM-DD" or "", "endDate": "YYYY-MM-DD" or "", "time": "HH:MM" (24h) or "", "venue": string (Venue name), "city": string (City in Portugal), "category": "Concert" or "Festival" or "Party" or "Other", "description": string (short 1-sentence note)}.` }
      ];
      body.contents = [{ parts }];
    } else if (body.contents && body.contents[0] && body.contents[0].parts && body.contents[0].parts[0]) {
      body.contents[0].parts[0].text = `Today's date is ${new Date().toISOString().slice(0,10)}. This image is a screenshot or poster of an Instagram event post. Extract the music/event details and respond ONLY with a JSON object in this exact shape:
{"artist": string (Artist or Event Name), "startDate": "YYYY-MM-DD" or "", "endDate": "YYYY-MM-DD" or "", "time": "HH:MM" (24h) or "", "location": string, "venue": string (Venue name), "city": string (City in Portugal), "category": "Concert" or "Festival" or "Party" or "Other", "description": string (short 1-sentence note)}. If the year isn't shown, assume the next upcoming occurrence after today.`;
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json();
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
