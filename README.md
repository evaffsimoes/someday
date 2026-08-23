# Saved for Someday — self-hosting guide

This folder is a complete installable PWA. Once it's hosted on a real
HTTPS domain and installed to your Android home screen, "Saved for
Someday" will show up in Instagram's native Share menu, right next to
WhatsApp and Messages.

## What's in here
- `index.html` — the app itself
- `manifest.json` — tells Android this is an installable app and declares
  it as a **share target** (so it can receive shared images)
- `sw.js` — the service worker that intercepts a shared image, stores it
  temporarily, and hands it to the app
- `icon-192.png`, `icon-512.png` — app icons

## ⚠️ Setup the API Key
The app uses a Netlify Serverless Function to call the free Google Gemini API. To make this work, you'll need to provide your API key.

Get a free API key from [Google AI Studio](https://aistudio.google.com/app/apikey), and add it as an Environment Variable in your Netlify site settings (see Hosting steps below).


## Hosting steps (Netlify — also free, drag-and-drop)
1. Go to [app.netlify.com/drop](https://app.netlify.com/drop).
2. Drag this whole folder onto the page.
3. Netlify gives you an instant HTTPS URL.
4. Go to **Site configuration > Environment variables** in your new Netlify site.
5. Add a new variable called `GEMINI_API_KEY` and paste your free key from [Google AI Studio](https://aistudio.google.com/app/apikey) as the value.
6. Trigger a new deploy (Site overview -> Deploys -> Trigger deploy) for the variable to take effect.

## Installing it on your Android phone
1. Open the hosted URL in **Chrome** on your phone.
2. Tap the **⋮** menu → **"Add to Home screen"** (or Chrome may prompt
   you automatically).
3. Confirm — the app icon now appears on your home screen like a normal
   app.

## Using it from Instagram
1. Find an event post, tap **Share** (the paper-plane icon).
2. In the share sheet, scroll the app list — **"Saved for Someday"**
   should now appear there.
3. Tap it. The app opens, reads the image, and shows you the extracted
   event details to confirm and save.

## Notes / limits
- Web Share Target works reliably in **Chrome on Android**. It does not
  work on iOS Safari (Apple doesn't support this API), and desktop
  browsers don't have a share sheet to register with.
- The app must be **installed** (added to home screen) before it appears
  as a share target — just visiting the URL isn't enough.
- If Instagram shares multiple images (a carousel) at once, only the
  first is read — you'd upload additional ones manually from inside the
  app.
