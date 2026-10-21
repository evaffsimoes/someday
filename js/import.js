/**
 * cue — Importing events from images, links and shared content, and flagging fields that could not be read.
 */

function closeLinkInput() {
  const modal = document.getElementById('linkInputModalOverlay');
  if (modal) modal.classList.remove('active');
  const slot = elements.linkInputSlot || document.getElementById('linkInputSlot');
  if (slot) slot.innerHTML = '';
}

function renderAiParsingState() {
  elements.statusEl.textContent = '';
  closeLinkInput();
  elements.reviewSlot.innerHTML = '';
  elements.aiParsingSlot.innerHTML = `
    <div class="ai-parsing-card">
      <div class="spinner"></div>
      <div class="ai-parsing-title">Reading event poster...</div>
      <div class="ai-parsing-sub">Extracting event details</div>
    </div>`;
  elements.aiParsingSlot.scrollIntoView({ behavior: 'smooth' });
}

function renderAiParsedSuccess(parsed) {
  elements.aiParsingSlot.innerHTML = '';
  openReview(parsed);
  markFieldsAiMissed(parsed);
  setTimeout(() => {
    if (elements.reviewSlot) elements.reviewSlot.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

function openLinkInput() {
  const modal = document.getElementById('linkInputModalOverlay');
  if (modal) modal.classList.add('active');

  if (document.getElementById('sharedLinkInput')) {
    setTimeout(() => document.getElementById('sharedLinkInput').focus(), 150);
    return;
  }

  if (elements.reviewSlot) elements.reviewSlot.innerHTML = '';
  if (elements.aiParsingSlot) elements.aiParsingSlot.innerHTML = '';

  const slot = elements.linkInputSlot || document.getElementById('linkInputSlot');
  if (!slot) return;

  slot.innerHTML = `
    <form class="inline-link-form" id="sharedLinkForm">
      <div class="link-input-box">
        <svg class="link-input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
        <input id="sharedLinkInput" type="text" autocomplete="url" placeholder="Paste Instagram link or caption..." aria-label="Instagram link or caption">
        <button class="btn btn-primary link-input-submit" type="submit">
          <span>Read</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
        </button>
      </div>
    </form>`;

  const closeBtn = document.getElementById('closeLinkModalBtn');
  if (closeBtn) closeBtn.onclick = closeLinkInput;

  const input = document.getElementById('sharedLinkInput');
  if (input) setTimeout(() => input.focus(), 150);

  const form = document.getElementById('sharedLinkForm');
  if (form) {
    form.onsubmit = event => {
      event.preventDefault();
      const sharedText = input ? input.value.trim() : '';
      if (!sharedText) return input && input.focus();
      closeLinkInput();
      handleSharedText(sharedText);
    };
  }
}

async function handleFile(file) {
  renderAiParsingState();
  try {
    const { base64, mediaType } = await prepareImage(file);
    const today = new Date().toISOString().slice(0, 10);

    const response = await fetch(getApiEndpoint(), {
      method: 'POST',
      headers: await apiHeaders(),
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              text: `Today's date is ${today}. This image is a screenshot or poster of an Instagram event post. Extract the music/event details and respond ONLY with a JSON object in this exact shape: {"artist": string (Artist or Event Name), "startDate": "YYYY-MM-DD" or "", "endDate": "YYYY-MM-DD" or "", "time": "HH:MM" (24h) or "", "venue": string (Venue name), "city": string (City in Portugal), "category": "Concert" or "Festival" or "Party" or "Other", "description": string (extra lineup or notes, or "" if none found. Do NOT write generic placeholder text)}.`
            },
            { inlineData: { mimeType: mediaType, data: base64 } }
          ]
        }]
      })
    });

    const textResult = await response.text();
    let data;
    try {
      data = JSON.parse(textResult);
    } catch (error) {
      // Not JSON; handled later.
    }

    if (!response.ok) {
      throw new Error(data?.error?.message || data?.error || textResult.slice(0, 100) || 'Unknown API error');
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = parseGeminiJson(text);
    parsed.image = `data:${mediaType};base64,${base64}`;
    renderAiParsedSuccess(parsed);
  } catch (error) {
    console.error('OCR Error:', error);
    elements.aiParsingSlot.innerHTML = '';
    elements.statusEl.textContent = `Error: ${error.message || 'Could not read poster details'}`;
    openReview({});
  }
}

function restoreAddOptions() {
  ['btnOptionScreenshot', 'btnOptionManual'].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.style.display = '';
  });

  const addSub = document.querySelector('.add-screen-sub');
  if (addSub) addSub.style.display = '';

  // Form closed: the glow goes back to the next event's colour
  state.reviewColor = null;
  refreshGlow();
}

// Flags the review fields the AI could not read, so the user knows what to fill in
function markFieldsAiMissed(parsed) {
  const review = elements.reviewSlot.querySelector('.review');
  if (!review) return;

  const checks = [
    { inputId: 'f_artist', label: 'name', found: parsed.artist || parsed.name },
    { inputId: 'f_daterange', label: 'date', found: parsed.startDate },
    { inputId: 'f_time', label: 'time', found: parsed.time },
    { inputId: 'f_city', label: 'city', found: parsed.city },
    { inputId: 'f_venue', label: 'venue', found: parsed.venue }
  ];
  const missing = checks.filter(check => !String(check.found || '').trim());
  if (missing.length === 0) return;

  const banner = document.createElement('div');
  banner.className = 'ai-missing-banner';
  banner.textContent = missing.length === checks.length
    ? '⚠️ We couldn\'t read the event details. Please fill them in below.'
    : `⚠️ We couldn't find the ${missing.map(check => check.label).join(', ')}. Please check the highlighted fields.`;
  review.prepend(banner);

  missing.forEach(({ inputId }) => {
    const input = document.getElementById(inputId);
    const field = input?.closest('.field');
    if (!field) return;

    field.classList.add('ai-missing');
    // On the label's line, so fields side by side stay aligned whether or not they're flagged
    const hint = document.createElement('span');
    hint.className = 'ai-missing-hint';
    hint.textContent = 'Not found';
    field.querySelector('label')?.append(hint);

    const clear = () => {
      if (!input.value.trim()) return;
      field.classList.remove('ai-missing');
      hint.remove();
      input.removeEventListener('input', clear);
      input.removeEventListener('change', clear);
    };
    input.addEventListener('input', clear);
    input.addEventListener('change', clear);
  });
}

// Reads a public Instagram post from the phone itself (native HTTP, so no CORS and a phone IP that
// Instagram doesn't treat as a server). Used when the server couldn't open the post.
// Resolves to { text, image: { mimeType, data } | null } or null.
async function readInstagramPostOnDevice(sharedText) {
  const http = window.Capacitor?.Plugins?.CapacitorHttp;
  const link = (sharedText.match(/https?:\/\/(?:www\.)?instagram\.com\/[^\s"'<>]+/i) || [])[0];
  const code = link && (link.match(/instagram\.com\/(?:[\w.]+\/)?(?:p|reels?|tv)\/([\w-]+)/i) || [])[1];
  if (!http || !code) return null;

  const decode = value => {
    const area = document.createElement('textarea');
    area.innerHTML = value;
    return area.value;
  };
  const meta = (html, property) => {
    const match = html.match(new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i'));
    return match ? decode(match[1]) : '';
  };

  try {
    const page = await http.request({
      url: `https://www.instagram.com/p/${code}/`,
      method: 'GET',
      headers: { 'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)' },
      responseType: 'text',
      connectTimeout: 8000,
      readTimeout: 8000
    });
    const html = typeof page.data === 'string' ? page.data : '';
    const description = meta(html, 'og:description');
    if (!description) return null;

    const header = description.match(/^(.*?)\s-\s([\w.]+) on ([^:]+):\s*/);
    const caption = (header ? description.slice(header[0].length) : description).trim().replace(/^"|"\.?$/g, '').trim();
    const text = [header ? `Posted by @${header[2]} on ${header[3]}` : '', `Caption: ${caption}`, `Link: ${link}`].filter(Boolean).join('\n');

    let image = null;
    const imageUrl = meta(html, 'og:image');
    if (imageUrl) {
      const picture = await http.request({ url: imageUrl, method: 'GET', responseType: 'blob', connectTimeout: 8000, readTimeout: 8000 });
      const type = String(picture.headers?.['Content-Type'] || picture.headers?.['content-type'] || 'image/jpeg').split(';')[0];
      if (typeof picture.data === 'string' && /^image\/(jpeg|png|webp)$/i.test(type) && picture.data.length < 3_000_000) {
        image = { mimeType: type, data: picture.data };
      }
    }
    return { text, image };
  } catch (error) {
    console.warn('Reading the Instagram post on the device failed', error);
    return null;
  }
}

async function requestSharedPost(payload) {
  const response = await fetch(getApiEndpoint(), {
    method: 'POST',
    headers: await apiHeaders(),
    body: JSON.stringify(payload)
  });
  const textResult = await response.text();
  let data;
  try {
    data = JSON.parse(textResult);
  } catch (error) {
    // Not JSON; handled by the caller
  }
  return { response, data, textResult };
}

async function handleSharedText(sharedText) {
  switchTab('add');
  renderAiParsingState();

  try {
    let { response, data, textResult } = await requestSharedPost({ sharedUrl: sharedText });

    // 422: the server couldn't open the post; try reading it on the phone and send what it finds
    if (response.status === 422) {
      const post = await readInstagramPostOnDevice(sharedText);
      if (post) {
        ({ response, data, textResult } = await requestSharedPost({
          sharedUrl: post.text,
          ...(post.image ? { contents: [{ parts: [{ inlineData: post.image }] }] } : {})
        }));
      }
    }

    if (!response.ok) {
      throw new Error(data?.error?.message || data?.error || textResult.slice(0, 100) || 'Unknown API error');
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = parseGeminiJson(text);
    if (data?._extractedImage) {
      parsed.image = data._extractedImage;
    }

    renderAiParsedSuccess(parsed);
  } catch (error) {
    console.error('Link/Share Parsing Error:', error);
    elements.aiParsingSlot.innerHTML = '';
    elements.statusEl.textContent = `Error: ${error.message || 'Could not read link details'}`;
    alert(`Couldn't read this link:\n\n${error.message || 'Service temporarily unavailable.'}\n\nYou can fill in the details manually below.`);
    openReview({});
  }
}

async function checkForSharedData() {
  const fullUrl = window.location.href;
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace('#', '?'));

  let sharedText = searchParams.get('text') || searchParams.get('url') || searchParams.get('title') ||
    hashParams.get('text') || hashParams.get('url') || hashParams.get('title');

  if (!sharedText && fullUrl.includes('?')) {
    const queryPart = fullUrl.split('?')[1] || '';
    const match = queryPart.match(/(?:text|url|title)=([^&]+)/i);
    if (match && match[1]) {
      try {
        sharedText = decodeURIComponent(match[1]);
      } catch (error) {
        sharedText = match[1];
      }
    }
  }

  if (sharedText && searchParams.get('shared') !== '1') {
    window.history.replaceState({}, '', window.location.pathname);
    switchTab('add');
    handleSharedText(sharedText);
    return;
  }

  // Reads and clears the share left by MainActivity. A run already in progress is reused, so a
  // share is never handled twice when start-up and the native side ask at the same moment.
  window.checkForSharedDataNative = function () {
    if (!window.Capacitor?.Plugins?.Preferences) return Promise.resolve();
    if (window.checkForSharedDataNative.running) return window.checkForSharedDataNative.running;
    window.checkForSharedDataNative.running = (async () => {
      try {
        const { value } = await window.Capacitor.Plugins.Preferences.get({ key: 'pending-share-intent' });
        if (value) {
          await window.Capacitor.Plugins.Preferences.remove({ key: 'pending-share-intent' });
          switchTab('add');
          handleSharedText(value);
        }
      } finally {
        window.checkForSharedDataNative.running = null;
      }
    })();
    return window.checkForSharedDataNative.running;
  };

  // Call immediately on app startup in case app was launched via share intent
  window.checkForSharedDataNative();

  window.checkForWidgetOpenIntentNative = async function () {
    if (!window.Capacitor?.Plugins?.Preferences) return;
    const { value: targetId } = await window.Capacitor.Plugins.Preferences.get({ key: 'pending-widget-open-event-id' });
    const { value: targetDate } = await window.Capacitor.Plugins.Preferences.get({ key: 'pending-widget-open-date' });

    if (targetId || targetDate) {
      if (targetId) await window.Capacitor.Plugins.Preferences.remove({ key: 'pending-widget-open-event-id' });
      if (targetDate) await window.Capacitor.Plugins.Preferences.remove({ key: 'pending-widget-open-date' });

      // An event tapped in the list widget opens that event; a day tapped in the
      // calendar widget opens that day in the calendar tab
      const targetEvent = targetId ? state.events.find(event => event.id === targetId) : null;

      if (targetEvent) {
        switchTab('queue');
        openDetailModal(targetEvent);
      } else if (targetDate) {
        const [year, month] = targetDate.split('-').map(Number);
        if (year && month) state.calCurrentDate = new Date(year, month - 1, 1);
        state.calSelectedDateStr = targetDate;
        switchTab('calendar');
        setTimeout(() => document.getElementById('calSelectedTitle')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
      }
    }
  };

  if (window.Capacitor?.isNative) {
    window.checkForWidgetOpenIntentNative();
  }

  if (searchParams.get('shared') === '1') {
    window.history.replaceState({}, '', window.location.pathname);
    switchTab('add');
    try {
      const cache = await caches.open('someday-shared-v1');
      const response = await cache.match('shared-image');
      if (response) {
        const blob = await response.blob();
        await cache.delete('shared-image');
        renderAiParsingState();
        const file = new File([blob], 'shared.jpg', { type: blob.type || 'image/jpeg' });
        handleFile(file);
      }
    } catch (error) {
      console.warn('No shared image found', error);
    }
  }
}
