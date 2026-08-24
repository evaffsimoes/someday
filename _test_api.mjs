const url = 'https://www.instagram.com/p/DbTdIMNIv8r/?igsi=MXFlOHMxbjRqNjQ3MA==';
const pageRes = await fetch(url, {
    headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    },
    signal: AbortSignal.timeout(5000)
});
const html = await pageRes.text();
let ogImage = (html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) || [])[1] || '';
console.log('Original:', ogImage);
ogImage = ogImage.replace(/&amp;/g, '&');
console.log('Fixed:', ogImage);
if (ogImage) {
    const imgRes = await fetch(ogImage);
    const mime = imgRes.headers.get('content-type');
    console.log('Image mime:', mime);
}
