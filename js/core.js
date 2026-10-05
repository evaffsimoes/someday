/**
 * cue — Shared state, storage and formatting helpers. Loaded first; the other app scripts build on these globals.
 */

const STORE_KEY = 'cue-events-v12';
const FRIENDS_KEY = 'cue-friends-v1';
const NOTIFICATION_KEY = 'cue-notifications-v1';
const MAX_SOURCE_IMAGE_BYTES = 12 * 1024 * 1024;
const TAB_ORDER = ['queue', 'add', 'calendar'];

const state = {
  events: [],
  savedFriends: [],
  calCurrentDate: new Date(),
  calSelectedDateStr: null,
  queueFilter: 'all',
  showAllUpcoming: false,
  lastDeletedEvent: null,
  fallbackUndoTimer: null,
  swipeStartX: 0,
  swipeStartY: 0
};

const elements = {
  fileInput: document.getElementById('fileInput'),
  fileInputBackup: document.getElementById('fileInputBackup'),
  statusEl: document.getElementById('status'),
  aiParsingSlot: document.getElementById('aiParsingSlot'),
  reviewSlot: document.getElementById('reviewSlot'),
  linkInputSlot: document.getElementById('linkInputSlot')
};

function uid() {
  return 'cue_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function getStorageItem(key) {
  try {
    if (window.storage && typeof window.storage.get === 'function') {
      return window.storage.get(key)
        .then(res => (res ? res.value : null))
        .catch(() => localStorage.getItem(key));
    }
  } catch (e) {
    // Safe fallback to localStorage below.
  }
  return Promise.resolve(localStorage.getItem(key));
}

function setStorageItem(key, val) {
  try {
    if (window.storage && typeof window.storage.set === 'function') {
      return window.storage.set(key, val).catch(() => localStorage.setItem(key, val));
    }
  } catch (e) {
    // Safe fallback to localStorage below.
  }
  localStorage.setItem(key, val);
  return Promise.resolve();
}

function fmtDate(dateStr) {
  if (!dateStr) return 'Date unknown';
  const parsed = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(parsed.getTime())) return dateStr;
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function isPast(event) {
  const checkDate = event.endDate || event.startDate;
  if (!checkDate) return false;
  const parsed = new Date(checkDate + 'T23:59:59');
  return parsed < new Date();
}

function daysLeft(dateStr) {
  if (!dateStr) return null;
  const parsed = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.ceil((parsed - new Date()) / (1000 * 60 * 60 * 24));
}

function dateOnly(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function eventOverlapsRange(event, rangeStart, rangeEnd) {
  if (!event.startDate) return false;
  const eventStart = new Date(`${event.startDate}T00:00:00`);
  const eventEnd = new Date(`${event.endDate || event.startDate}T23:59:59`);
  return !Number.isNaN(eventStart.getTime()) && !Number.isNaN(eventEnd.getTime())
    && eventStart <= rangeEnd && eventEnd >= rangeStart;
}

function matchesQueueFilter(event, targetFilter = state.queueFilter) {
  if (targetFilter === 'past') return isPast(event);
  if (targetFilter === 'all') return true;

  const today = dateOnly(new Date());
  let rangeStart = today;
  let rangeEnd = today;

  if (targetFilter === 'week') {
    const day = today.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    rangeStart.setDate(rangeStart.getDate() + mondayOffset);
    rangeEnd = new Date(rangeStart);
    rangeEnd.setDate(rangeEnd.getDate() + 6);
    rangeEnd.setHours(23, 59, 59, 999);
  } else if (targetFilter === 'month') {
    rangeStart = new Date(today.getFullYear(), today.getMonth(), 1);
    rangeEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
  }

  return eventOverlapsRange(event, rangeStart, rangeEnd);
}

function fmtDateRange(startDate, endDate) {
  if (!startDate) return 'Date unknown';
  const start = new Date(startDate + 'T00:00:00');
  if (endDate && endDate !== startDate) {
    const end = new Date(endDate + 'T00:00:00');
    const startStr = start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    const endStr = end.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    return `${startStr} – ${endStr} ${end.getFullYear()}`;
  }
  return start.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

function safeImageUrl(value) {
  const image = String(value || '');
  if (/^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(image)) return image;
  try {
    const url = new URL(image);
    if (url.protocol === 'https:') return url.href;
  } catch (_) {
    // Not a valid URL.
  }
  return '';
}

function categoryPillHTML(category) {
  const value = category || 'Concert';
  let className = 'category-pill';
  if (value === 'Festival') className += ' category-pill-festival';
  else if (value === 'Other') className += ' category-pill-other';
  return `<span class="${className}">${escapeHtml(value)}</span>`;
}

function ticketLabel(status) {
  const map = {
    need_ticket: 'Need ticket',
    going: 'Going',
    maybe: 'Maybe'
  };
  return map[status] || '';
}

function eventFingerprint(event) {
  if (!event) return '';
  return [
    (event.artist || '').trim().toLowerCase(),
    (event.startDate || '').trim(),
    (event.endDate || event.startDate || '').trim(),
    (event.time || '').trim(),
    (event.venue || '').trim().toLowerCase(),
    (event.city || '').trim().toLowerCase(),
    (event.category || '').trim().toLowerCase(),
    (event.description || '').trim().toLowerCase()
  ].join('|');
}

function dedupeEvents(events) {
  const seen = new Set();
  return (events || []).filter(event => {
    const key = eventFingerprint(event);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function saveEvents(skipCloud = false) {
  try {
    await setStorageItem(STORE_KEY, JSON.stringify(state.events));

    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences) {
        // Home screen widgets only need the text fields
        const widgetEvents = state.events.map(({ image, ticketFile, ...rest }) => rest);
        window.Capacitor.Plugins.Preferences.set({ key: 'shared-events', value: JSON.stringify(widgetEvents) });
      }
    } catch (err) {
      // Ignore native preference errors.
    }

    // Keep scheduled reminders in sync with added, edited or deleted events
    checkEventNotifications();

    if (!skipCloud && window.CueAuth && typeof window.CueAuth.saveEventToCloud === 'function') {
      window.CueAuth.saveEventToCloud();
    }

    return true;
  } catch (error) {
    console.error('save failed', error);
    customAlert('Couldn\'t save on this device: storage is full.');
    return false;
  }
}

function updateDynamicDatalists() {
  const cityDatalist = document.getElementById('pt-cities');
  const knownCities = new Set([
    'Porto', 'Lisboa', 'Vila Nova de Gaia', 'Braga', 'Coimbra', 'Faro', 'Aveiro',
    'Cascais', 'Guimarães', 'Leiria', 'Setúbal', 'Viseu', 'Évora', 'Funchal'
  ]);

  state.events.forEach(event => {
    if (event.city) knownCities.add(event.city.trim());
  });

  cityDatalist.innerHTML = Array.from(knownCities).sort().map(city => `<option value="${escapeAttr(city)}">`).join('');
  const venueDatalist = document.getElementById('pt-venues');
  const knownVenues = new Set([
    'NOS Alive', 'Super Bock Super Rock', 'Rock in Rio Lisboa', 'Coliseu do Porto',
    'Coliseu de Lisboa', 'Altice Arena', 'MEO Arena', 'Primavera Sound Porto',
    'Parque da Cidade', 'Palácio do Cristal', 'Hard Club', 'Casa da Música',
    'Pavilhão Rosa Mota', 'Lisboa ao Vivo', 'Parque Eduardo VII', 'Queijo Dunas',
    'Meo Marés Vivas', 'Vodafone Paredes de Coura', 'RCA', 'Hotel Mouco', 'Maus Hábitos'
  ]);

  state.events.forEach(event => {
    if (event.venue) knownVenues.add(event.venue.trim());
  });

  venueDatalist.innerHTML = Array.from(knownVenues).sort().map(venue => `<option value="${escapeAttr(venue)}">`).join('');
}

function selectOptionsHTML(datalistId, selectedValue, placeholder) {
  const datalist = document.getElementById(datalistId);
  const values = Array.from(datalist?.options || []).map(option => option.value).filter(Boolean);
  const selected = String(selectedValue || '').trim();
  if (selected && !values.includes(selected)) values.unshift(selected);

  return `<option value="">${placeholder}</option>` + values.map(value => `
    <option value="${escapeAttr(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(value)}</option>
  `).join('');
}

function getApiEndpoint() {
  if (window.location.hostname === 'localhost' || window.location.protocol === 'file:') {
    return 'https://someday-nu.vercel.app/api/gemini';
  }
  return '/api/gemini';
}

// The import endpoint only serves signed-in users
async function apiHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  try {
    const token = await window.CueAuth?.getIdToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch (error) {
    console.warn('Could not get sign-in token', error);
  }
  return headers;
}

function parseGeminiJson(text) {
  if (!text) return {};
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch (error) {
      // Fall through below.
    }
  }

  try {
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (error) {
    return {};
  }
}

function iconSvg(name) {
  const icons = {
    calendar: '<path d="M7 4.5V7M17 4.5V7M5.5 9.5h13M6 6.5h12a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 18 18.5H6A1.5 1.5 0 0 1 4.5 17V8A1.5 1.5 0 0 1 6 6.5Z"/>',
    location: '<path d="M12 20s6-5.8 6-11A6 6 0 1 0 6 9c0 5.2 6 11 6 11Zm0-8.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z"/>',
    users: '<path d="M8 12.2a2.7 2.7 0 1 1 0-5.4 2.7 2.7 0 0 1 0 5.4Zm8 0a2.3 2.3 0 1 1 0-4.6 2.3 2.3 0 0 1 0 4.6ZM4.5 18a4.5 4.5 0 0 1 9 0M14.5 18a4.5 4.5 0 0 1 5 0"/>',
    clock: '<path d="M12 6.5v5l3 2M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    chevron: '<path d="m9 7 5 5-5 5"/>',
    settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.1M12 19.1v2.1M2.8 12h2.1M19.1 12h2.1M5.5 5.5 7 7M17 17l1.5 1.5M18.5 5.5 17 7M7 17l-1.5 1.5"/>',
    trash: '<path d="M5 7.5h14M9 4.5h6l1 3H8l1-3Zm-2 4 1 9.5h10l1-9.5"/>',
    edit: '<path d="M4.5 17.5V19h1.5l8.8-8.8-1.5-1.5L4.5 17.5ZM15.8 6.7l1.5 1.5 1.6-1.6-1.5-1.5-1.6 1.6Z"/>',
    link: '<path d="M10 13.5l4-4M8.5 8.5l1-1a3.5 3.5 0 0 1 5 5l-1 1m-5.5 1.5-1 1a3.5 3.5 0 1 1-5-5l1-1m8-3.5 1 1a3.5 3.5 0 0 1 0 5l-1 1"/>',
    image: '<path d="M7.5 6.5h9l1.5 2.2a1.5 1.5 0 0 1-1.3 2.3h-9.4a1.5 1.5 0 0 1-1.3-2.3L7.5 6.5Zm-2 9.5a2.5 2.5 0 0 1 2.5-2.5h9a2.5 2.5 0 0 1 2.5 2.5v1.5a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 17.5v-1.5Zm7.2-5.5a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z"/>',
    upload: '<path d="M12 16V6m0 0 3.5 3.5M12 6 8.5 9.5M5 18.5h14"/>',
    close: '<path d="m7 7 10 10M17 7 7 17"/>',
    ticket: '<path d="M7 8.5h10M7 12h10M7 15.5h6M6 4.5h12a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 18 19.5H6A1.5 1.5 0 0 1 4.5 18V6A1.5 1.5 0 0 1 6 4.5Z"/>',
    back: '<path d="m15 6-6 6 6 6"/>'
  };
  return `<svg class="cue-icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.ticket}</svg>`;
}

function customAlert(message) {
  let box = document.getElementById('debugAlertBox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'debugAlertBox';
    box.style.position = 'fixed';
    box.style.bottom = '20px';
    box.style.left = '50%';
    box.style.transform = 'translateX(-50%)';
    box.style.background = '#333';
    box.style.color = '#fff';
    box.style.padding = '12px 20px';
    box.style.borderRadius = '8px';
    box.style.zIndex = '99999';
    box.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
    box.style.textAlign = 'center';
    document.body.appendChild(box);
  }

  box.textContent = message;
  box.style.display = 'block';
  setTimeout(() => {
    box.style.display = 'none';
  }, 5000);
}
