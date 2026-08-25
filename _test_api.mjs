fetch('https://someday-nu.vercel.app/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sharedUrl: 'https://www.instagram.com/p/DbTdIMNIv8r/' })
}).then(r => r.json()).then(d => {
    console.log('error?', d.error);
    const text = d?.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log('RESULT:', text);
}).catch(e => console.error('FETCH ERROR:', e.message));
