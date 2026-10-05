(() => {
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
              window.Capacitor.Plugins.Preferences.set({ key: 'shared-events', value: JSON.stringify(state.events) });
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
          return false;
        }
      }

      window.cueAppState = state;
      window.cueSaveEvents = saveEvents;
      window.cueRenderApp = () => {
        if (typeof renderSpotlight === 'function') renderSpotlight();
        if (typeof render === 'function') render();
        if (typeof renderCalendar === 'function') renderCalendar();
        if (typeof updateDynamicDatalists === 'function') updateDynamicDatalists();
      };

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

      function switchTab(tabName) {
        document.querySelectorAll('.nav-btn').forEach(button => {
          button.classList.toggle('active', button.getAttribute('data-tab') === tabName);
        });

        document.querySelectorAll('.tab-screen').forEach(screen => {
          screen.classList.toggle('active', screen.id === `screen-${tabName}`);
        });

        if (tabName === 'calendar') {
          renderCalendar();
        }

        window.scrollTo({ top: 0, behavior: 'smooth' });
      }

      function renderQueueItem(event) {
        const dateStr = fmtDateRange(event.startDate, event.endDate);
        const locStr = [event.city, event.venue].filter(Boolean).join(' · ');
        const imageSrc = safeImageUrl(event.image);

        const imageHTML = imageSrc
          ? `<img src="${escapeAttr(imageSrc)}" class="queue-img" alt="Event image">`
          : '<div class="queue-img-placeholder">' + iconSvg('ticket') + '</div>';

        const eventIsPast = isPast(event);
        return `
          <div class="queue-swipe-wrapper">
            <div class="queue-item ${eventIsPast ? 'is-past' : ''}" data-view="${escapeAttr(event.id)}" onclick="window.openDetailModalById('${escapeAttr(event.id)}')">
              ${imageHTML}

              <div class="queue-info">
                <div class="queue-artist">${escapeHtml(event.artist || 'Untitled event')}</div>
                <div class="queue-date-row">
                  <span>${escapeHtml(dateStr.toUpperCase())}</span>
                </div>
                ${locStr ? `<div class="queue-loc-row"><span>${escapeHtml(locStr)}</span></div>` : ''}
                ${event.company ? `<div class="queue-loc-row" style="color:var(--accent-strong); font-weight:500;"><span>With ${escapeHtml(event.company)}</span></div>` : ''}
              </div>

              <div class="queue-arrow" style="color:#6b7280; font-size:18px; line-height:1; font-weight:300;">›</div>
            </div>
          </div>`;
      }

      function render() {
        const isPastFilter = state.queueFilter === 'past';

        const upcoming = state.events
          .filter(event => isPastFilter ? isPast(event) : (!isPast(event) && matchesQueueFilter(event)))
          .sort((a, b) => {
            if (isPastFilter) return (b.startDate || '').localeCompare(a.startDate || '');
            return (a.startDate || '9999').localeCompare(b.startDate || '9999');
          });

        const past = state.events
          .filter(event => isPast(event))
          .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));

        const spotlightSlot = document.getElementById('spotlightSlot');
        spotlightSlot.innerHTML = '';

        if (!isPastFilter && upcoming.length > 0) {
          const nextEvent = upcoming[0];
          const dateStr = fmtDateRange(nextEvent.startDate, nextEvent.endDate).toUpperCase();
          const locationText = [nextEvent.city, nextEvent.venue].filter(Boolean).join(' · ').toUpperCase();
          const heroImgSrc = safeImageUrl(nextEvent.image);

          const heroBgStyle = heroImgSrc
            ? `background-image: linear-gradient(180deg, rgba(9, 9, 11, 0.2) 0%, rgba(9, 9, 11, 0.95) 100%), url('${escapeAttr(heroImgSrc)}');`
            : `background: linear-gradient(135deg, #2e1065 0%, #09090b 100%);`;

          spotlightSlot.innerHTML = `
            <div class="hero-spotlight-card" style="position: relative; width: 100%; height: 320px; border-radius: 20px; overflow: hidden; margin-bottom: 24px; background-size: cover; background-position: center; display: flex; flex-direction: column; justify-content: flex-end; padding: 24px 20px; box-sizing: border-box; cursor: pointer; ${heroBgStyle}" onclick="const evt = state.events.find(e => e.id === '${nextEvent.id}'); if (evt) openDetailModal(evt);">
              <div style="font-size: 11px; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.16em; margin-bottom: 6px;">
                NEXT UP
              </div>
              <div style="font-family: 'Outfit', sans-serif; font-size: 28px; font-weight: 800; color: #ffffff; line-height: 1.15; letter-spacing: -0.02em; margin-bottom: 8px; text-transform: uppercase;">
                ${escapeHtml(nextEvent.artist || 'Next Event')}
              </div>
              <div style="font-size: 13px; font-weight: 600; color: #d1d5db; letter-spacing: 0.04em; margin-bottom: 4px;">
                ${escapeHtml(dateStr)}
              </div>
              ${locationText ? `<div style="font-size: 12px; font-weight: 500; color: #9ca3af; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 16px;">${escapeHtml(locationText)}</div>` : ''}
              
              <div>
                <button type="button" style="display: inline-flex; align-items: center; gap: 8px; border: 1.5px solid rgba(192, 132, 252, 0.8); border-radius: 999px; background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(8px); color: #ffffff; padding: 9px 18px; font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer;">
                  <span>I'M GOING</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </button>
              </div>
            </div>
          `;
        }

        const allCount = state.events.filter(e => !isPast(e)).length;
        const weekCount = state.events.filter(e => !isPast(e) && matchesQueueFilter(e, 'week')).length;
        const monthCount = state.events.filter(e => !isPast(e) && matchesQueueFilter(e, 'month')).length;
        const pastCount = state.events.filter(e => isPast(e)).length;

        document.querySelectorAll('.feed-tab').forEach(button => {
          const filter = button.dataset.filter;
          button.classList.toggle('active', filter === state.queueFilter);
          const label = filter === 'all' ? 'All' : filter === 'week' ? 'This week' : filter === 'month' ? 'This month' : 'Past';
          const count = filter === 'all' ? allCount : filter === 'week' ? weekCount : filter === 'month' ? monthCount : pastCount;
          button.textContent = count > 0 ? `${label} · ${count}` : label;
        });

        document.getElementById('undoToastHTML').innerHTML = `
          <div id="undoToast" class="undo-toast">
            <span>Event removed.</span>
            <button id="undoBtn">Undo ${iconSvg('back')}</button>
          </div>
        `;

        const titleLeft = document.querySelector('.section-title-left');
        const seeAllButton = document.querySelector('.section-see-all');
        const secondSectionTitle = document.querySelectorAll('.section-title')[1];
        const pastListEl = document.getElementById('pastList');

        if (isPastFilter) {
          if (titleLeft) titleLeft.textContent = 'Past events';
          if (seeAllButton) seeAllButton.style.display = 'none';
          if (secondSectionTitle) secondSectionTitle.style.display = 'none';
          if (pastListEl) pastListEl.style.display = 'none';
        } else {
          if (titleLeft) titleLeft.textContent = 'Your events';
          if (secondSectionTitle) secondSectionTitle.style.display = '';
          if (pastListEl) pastListEl.style.display = '';
        }

        let currentMonthStr = '';
        const upcomingHTML = upcoming.map(event => {
          let markup = '';
          if (event.startDate) {
            const date = new Date(event.startDate + 'T12:00:00');
            if (!Number.isNaN(date.getTime())) {
              const monthLabel = date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
              if (monthLabel !== currentMonthStr) {
                markup += `<div class="month-header">${monthLabel}</div>`;
                currentMonthStr = monthLabel;
              }
            }
          }
          markup += renderQueueItem(event);
          return markup;
        }).join('');

        document.getElementById('upcomingList').innerHTML = upcoming.length
          ? upcomingHTML
          : `<div class="empty">${isPastFilter ? 'No past events in your history.' : 'Your queue is empty. Tap "+" to add a concert or festival!'}</div>`;

        if (!isPastFilter && seeAllButton) {
          if (upcoming.length <= 3) {
            seeAllButton.style.display = 'none';
          } else {
            seeAllButton.style.display = '';
            seeAllButton.textContent = state.showAllUpcoming ? 'Show less' : 'See all';
            seeAllButton.onclick = () => {
              state.showAllUpcoming = !state.showAllUpcoming;
              render();
            };
          }
        }

        if (!isPastFilter && pastListEl) {
          pastListEl.innerHTML = past.length
            ? past.map(renderQueueItem).join('')
            : '<div class="empty">Past events will land here.</div>';
        }

        document.querySelectorAll('[data-view]').forEach(element => {
          element.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const id = element.getAttribute('data-view');
            const match = state.events.find(event => String(event.id) === String(id));
            if (match) openDetailModal(match);
          };
        });

        document.querySelectorAll('[data-del]').forEach(button => {
          button.onclick = event => {
            event.stopPropagation();
            deleteEvent(button.getAttribute('data-del'));
          };
        });
      }

      async function deleteEvent(id) {
        state.lastDeletedEvent = state.events.find(event => event.id === id);
        state.events = state.events.filter(event => event.id !== id);
        await saveEvents();
        render();
        renderCalendar();

        const slot = document.getElementById('undoToastHTML');
        if (!slot) return;

        slot.innerHTML = `
          <div class="calendar-toast" role="status">
            <span>Event removed.</span>
            <button id="undoBtn">Undo</button>
          </div>`;

        clearTimeout(state.fallbackUndoTimer);

        document.getElementById('undoBtn').onclick = async () => {
          if (state.lastDeletedEvent) {
            state.events.push(state.lastDeletedEvent);
            await saveEvents();
            render();
            renderCalendar();
          }
          slot.innerHTML = '';
        };

        state.fallbackUndoTimer = setTimeout(() => {
          if (slot.firstChild) slot.innerHTML = '';
        }, 5000);
      }

      function toGCalDate(dateStr, timeStr) {
        if (!dateStr) return null;
        const datePart = dateStr.replace(/-/g, '');
        if (timeStr) {
          const match = timeStr.match(/(\d{1,2}):(\d{2})/);
          if (match) {
            const hh = match[1].padStart(2, '0');
            const mm = match[2];
            return `${datePart}T${hh}${mm}00`;
          }
        }
        return datePart;
      }

      function gcalUrl(event) {
        if (!event.startDate) return 'https://calendar.google.com/';

        let startFormatted = '';
        let endFormatted = '';

        const effectiveEndDate = (event.endDate && event.endDate >= event.startDate) ? event.endDate : event.startDate;

        if (event.time) {
          const startDt = toGCalDate(event.startDate, event.time);
          const endDt = toGCalDate(effectiveEndDate, null);
          startFormatted = startDt;
          if (event.endDate && event.endDate !== event.startDate) {
            endFormatted = `${endDt.slice(0, 8)}T235900`;
          } else {
            const startDateObj = new Date(`${event.startDate}T${event.time.padStart(5, '0')}:00`);
            const endDateObj = new Date(startDateObj.getTime() + 3 * 60 * 60 * 1000);
            endFormatted = endDateObj.toISOString().replace(/[-:]/g, '').split('.')[0];
          }
        } else {
          const s = event.startDate.replace(/-/g, '');
          const e = effectiveEndDate.replace(/-/g, '');
          const nextDay = new Date(`${effectiveEndDate}T00:00:00`);
          nextDay.setDate(nextDay.getDate() + 1);
          const nextDayStr = nextDay.toISOString().slice(0, 10).replace(/-/g, '');
          startFormatted = s;
          endFormatted = nextDayStr;
        }

        const dates = `${startFormatted}/${endFormatted}`;

        const params = new URLSearchParams({
          action: 'TEMPLATE',
          text: event.artist || 'Event',
          details: event.description || 'Saved to cue: Never miss your cue.',
          location: [event.venue, event.city].filter(Boolean).join(', '),
          ctz: 'Europe/Lisbon'
        });

        if (dates) params.set('dates', dates);
        return `https://calendar.google.com/calendar/render?${params.toString()}`;
      }

      function downloadIcs(event) {
        const start = toGCalDate(event.startDate, event.time) || new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
        const dtStart = start.includes('T') ? start : `${start}T210000`;
        const startDate = new Date(
          dtStart.slice(0, 4),
          Number(dtStart.slice(4, 6)) - 1,
          dtStart.slice(6, 8),
          dtStart.slice(9, 11) || 21,
          dtStart.slice(11, 13) || 0
        );
        const endDate = new Date(startDate.getTime() + 3 * 60 * 60 * 1000);

        const formatIcsDate = date => date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
        const escapeIcs = value => String(value || '')
          .replace(/\\/g, '\\\\')
          .replace(/;/g, '\\;')
          .replace(/,/g, '\\,')
          .replace(/\r?\n/g, '\\n');

        const calendarEntry = [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'PRODID:-//cue//EN',
          'BEGIN:VEVENT',
          `UID:${event.id}@cue-app`,
          `DTSTAMP:${formatIcsDate(new Date())}`,
          `DTSTART:${formatIcsDate(startDate)}`,
          `DTEND:${formatIcsDate(endDate)}`,
          `SUMMARY:${escapeIcs(event.artist || 'Event')}`,
          event.venue ? `LOCATION:${escapeIcs([event.venue, event.city].filter(Boolean).join(', '))}` : '',
          event.description ? `DESCRIPTION:${escapeIcs(event.description)}` : '',
          'END:VEVENT',
          'END:VCALENDAR'
        ].filter(Boolean).join('\r\n');

        const blob = new Blob([calendarEntry], { type: 'text/calendar' });
        const anchor = document.createElement('a');
        anchor.href = URL.createObjectURL(blob);
        anchor.download = (event.artist || 'event').replace(/[^a-z0-9]+/gi, '_') + '.ics';
        anchor.click();
      }

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
          <div class="ai-parsing-card" style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:28px 16px; text-align:center; border:1px solid var(--border); border-radius:16px; background:var(--surface-soft);">
            <div style="width:32px; height:32px; border:3px solid var(--border); border-top-color:var(--accent-strong); border-radius:50%; animation:cueSpin 0.75s linear infinite; margin-bottom:14px;"></div>
            <div style="font-size:14px; font-weight:600; color:var(--text-main); font-family:'Outfit', sans-serif;">Reading event poster...</div>
            <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">Extracting event details</div>
          </div>
          <style>@keyframes cueSpin { to { transform: rotate(360deg); } }</style>`;
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
          <form class="inline-link-form" id="sharedLinkForm" style="margin-top:6px; margin-bottom:6px;">
            <div style="position:relative; display:flex; align-items:center; background:var(--surface); border:1px solid rgba(168,85,247,0.3); border-radius:16px; padding:4px 6px 4px 14px; box-shadow:0 8px 24px rgba(0,0,0,0.3); transition:all 0.2s ease;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-strong)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0; margin-right:10px;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
              <input id="sharedLinkInput" type="text" autocomplete="url" placeholder="Paste Instagram link or caption..." aria-label="Instagram link or caption" style="flex:1; background:transparent; border:none; outline:none; color:var(--text-main); font-size:13px; font-weight:500; padding:10px 0;">
              <button class="btn btn-primary" type="submit" style="padding:9px 18px; border-radius:12px; font-size:12px; font-weight:700; flex-shrink:0; display:inline-flex; align-items:center; gap:6px; background:linear-gradient(135deg, #a855f7, #7c3aed); border:none; box-shadow:0 4px 14px rgba(168,85,247,0.35); cursor:pointer;">
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

      function fileToBase64(file) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }

      async function prepareImage(file) {
        if (!file?.type?.match(/^image\/(jpeg|png|webp|heic|heif)$/i) && !file?.name?.match(/\.(jpe?g|png|webp|heic|heif)$/i)) {
          throw new Error('Please choose a JPEG, PNG, or WebP image.');
        }
        if (file.size > MAX_SOURCE_IMAGE_BYTES) {
          throw new Error('That image is too large. Please choose one under 12 MB.');
        }

        const objectUrl = URL.createObjectURL(file);
        try {
          const image = new Image();
          await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = () => reject(new Error('Failed to load image file.'));
            image.src = objectUrl;
          });

          const maxDimension = 1600;
          const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
          canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);

          const compressed = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
          if (!compressed) throw new Error('Could not process that image.');

          const base64 = await fileToBase64(compressed);
          return { base64, mediaType: 'image/jpeg' };
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      }

      async function handleFile(file) {
        renderAiParsingState();
        try {
          const { base64, mediaType } = await prepareImage(file);
          const today = new Date().toISOString().slice(0, 10);

          const response = await fetch(getApiEndpoint(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
          const hint = document.createElement('div');
          hint.className = 'ai-missing-hint';
          hint.textContent = 'Not found in the post';
          field.querySelector('label')?.after(hint);

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

      function openReview(prefill, focusField = '') {
        const isEditing = !!(prefill && prefill.id);

        ['btnOptionScreenshot', 'btnOptionManual'].forEach(id => {
          const element = document.getElementById(id);
          if (element) element.style.display = isEditing ? 'none' : '';
        });

        const addSub = document.querySelector('.add-screen-sub');
        if (addSub) addSub.style.display = isEditing ? 'none' : '';

        elements.reviewSlot.innerHTML = `
          <div class="review">
            <div class="form-section-title">1. Event Basics</div>

            <div class="field">
              <div class="event-image-editor" style="background:var(--surface-soft); padding:12px; border-radius:14px; border:1px solid var(--border); display:flex; align-items:center; gap:14px;">
                <div id="eventImagePreviewWrapper" class="event-image-preview-wrapper" style="width:72px; height:72px; border-radius:12px; overflow:hidden; background:var(--surface); border:1px solid var(--border); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                  ${safeImageUrl(prefill.image)
            ? `<img src="${escapeAttr(safeImageUrl(prefill.image))}" style="width:100%; height:100%; object-fit:cover;" alt="Event image">`
            : `<div style="text-align:center; padding:4px; font-size:10px; color:var(--text-muted);">No image</div>`}
                </div>
                <div class="event-image-actions" style="display:flex; flex-direction:column; gap:6px; flex:1;">
                  <span style="font-size:12px; font-weight:600; color:var(--text-main);">${safeImageUrl(prefill.image) ? 'Event Poster' : 'Poster not found?'}</span>
                  <input class="event-image-input" id="eventImageInput" type="file" accept="image/jpeg,image/png,image/webp" style="display:none;">
                  <label class="btn btn-ghost" for="eventImageInput" style="font-size:12px; padding:6px 12px; margin:0; display:inline-flex; align-items:center; gap:6px; width:fit-content; cursor:pointer;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                    <span>${safeImageUrl(prefill.image) ? 'Change photo' : 'Choose from Gallery'}</span>
                  </label>
                </div>
              </div>
            </div>

            <div class="field">
              <label>Artist / Event Name</label>
              <input id="f_artist" value="${escapeAttr(prefill.artist || prefill.name || '')}" placeholder="e.g. Tino de Rans DJ Set, Festival X">
            </div>

            <div class="field">
              <label>Category</label>
              <select id="f_category">
                <option value="Concert" ${(prefill.category === 'Concert' || !prefill.category) ? 'selected' : ''}>Concert</option>
                <option value="Festival" ${prefill.category === 'Festival' ? 'selected' : ''}>Festival</option>
                <option value="Other" ${prefill.category === 'Other' || prefill.category === 'Party' ? 'selected' : ''}>Other</option>
              </select>
            </div>

            <div class="form-section-title">2. When & Where</div>

            <div class="field">
              <label for="f_daterange">Date</label>
              <div style="display:flex; align-items:center; gap:10px;">
                <input id="f_daterange" type="text" placeholder="Select date" style="flex:1; min-width:0;">
                <label style="display:flex; align-items:center; gap:6px; margin:0; white-space:nowrap; cursor:pointer;">
                  <input id="f_multiday" type="checkbox" style="width:auto; margin:0; padding:0; accent-color:#a855f7;"> Multi-day
                </label>
              </div>
            </div>

            <div class="review-row">
              <div class="field"><label>Time</label><input id="f_time" type="time" value="${escapeAttr(prefill.time || '')}"></div>
              <div class="field">
                <label>City</label>
                <input id="f_city" type="text" list="pt-cities" value="${escapeAttr(prefill.city || '')}" placeholder="e.g. Porto, Coimbra" autocomplete="off">
              </div>
            </div>

            <div class="field">
              <label>Venue</label>
              <input id="f_venue" type="text" list="pt-venues" value="${escapeAttr(prefill.venue || '')}" placeholder="e.g. Hard Club, LAV" autocomplete="off">
            </div>

            <div class="form-section-title">3. Tickets, Friends & Notes</div>

            <div class="field">
              <label>Going with</label>
              <div class="friend-picker">
                <div class="friend-tag-container" onclick="document.getElementById('friendsSearch').focus()">
                  <div id="selectedPills" class="selected-pills"></div>
                  <input id="friendsSearch" class="friend-input-field" placeholder="Add friends or group..." autocomplete="off">
                </div>
                <input type="hidden" id="f_company" value="${escapeAttr(prefill.company || '')}">
                <div id="friends-chips" class="friend-picker-list"></div>
              </div>
            </div>

            <div class="field">
              <label>Ticket Status</label>
              <input type="hidden" id="f_ticket_status" value="${escapeAttr(prefill.ticketStatus || '')}">
              <div class="status-chip-group" id="ticketStatusChips">
                <button type="button" class="status-chip ${(prefill.ticketStatus === 'need_ticket') ? 'selected' : ''}" data-val="need_ticket">Need ticket</button>
                <button type="button" class="status-chip ${(prefill.ticketStatus === 'going') ? 'selected' : ''}" data-val="going">Going</button>
                <button type="button" class="status-chip ${(prefill.ticketStatus === 'maybe') ? 'selected' : ''}" data-val="maybe">Maybe</button>
              </div>
            </div>

            <div class="field" id="ticketInfoField" style="display: ${(prefill.ticketStatus || prefill.ticketFile) ? 'block' : 'none'};">
              <label>Attach Ticket</label>
              <div style="display: flex; align-items: center; gap: 10px;">
                <input class="event-image-input" id="ticketFileInput" type="file" accept="image/*,.pdf">
                <label for="ticketFileInput" class="btn btn-ghost" style="font-size: 12px; padding: 8px 14px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
                  <span>${prefill.ticketFile ? 'Replace ticket file' : 'Attach PDF / Image'}</span>
                </label>
                <span id="ticketFileStatus" style="font-size: 12px; color: var(--text-muted);">${prefill.ticketFile ? (prefill.ticketFileName || 'Attached') : 'No file attached'}</span>
              </div>
            </div>

            <div class="field">
              <label>Note</label>
              <textarea id="f_desc" placeholder="Anything worth remembering">${escapeHtml(prefill.description || '')}</textarea>
            </div>

            <div class="btn-row">
              <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
              <button class="btn btn-primary" id="saveBtn">Save</button>
            </div>
          </div>`;

        let editedImage = prefill.image || '';
        let editedTicketFile = prefill.ticketFile || '';
        let editedTicketFileName = prefill.ticketFileName || '';

        const imageInput = document.getElementById('eventImageInput');
        const imagePreview = document.getElementById('eventImagePreviewWrapper');
        const ticketFileInput = document.getElementById('ticketFileInput');
        const ticketFileStatus = document.getElementById('ticketFileStatus');

        ticketFileInput?.addEventListener('change', async () => {
          const file = ticketFileInput.files?.[0];
          if (!file) return;
          try {
            if (file.size > 8 * 1024 * 1024) {
              alert('Ticket file is too large. Please use a file under 8 MB.');
              ticketFileInput.value = '';
              return;
            }
            const base64 = await fileToBase64(file);
            editedTicketFile = `data:${file.type || 'application/pdf'};base64,${base64}`;
            editedTicketFileName = file.name;
            if (ticketFileStatus) ticketFileStatus.textContent = file.name;
          } catch (error) {
            alert('Could not attach ticket file: ' + error.message);
          }
        });

        imageInput?.addEventListener('change', async () => {
          const file = imageInput.files?.[0];
          if (!file) return;

          try {
            const prepared = await prepareImage(file);
            editedImage = `data:${prepared.mediaType};base64,${prepared.base64}`;
            imagePreview.innerHTML = `<img src="${editedImage}" alt="Event image">`;
          } catch (error) {
            alert(error.message);
            imageInput.value = '';
          }
        });

        const companyInput = document.getElementById('f_company');
        const friendsSearch = document.getElementById('friendsSearch');
        let defaultDates = [];
        if (prefill.startDate) defaultDates.push(new Date(prefill.startDate + 'T12:00:00'));
        if (prefill.endDate && prefill.endDate !== prefill.startDate) defaultDates.push(new Date(prefill.endDate + 'T12:00:00'));

        const multiDayInput = document.getElementById('f_multiday');
        const dateRangeInput = document.getElementById('f_daterange');
        const categorySelect = document.getElementById('f_category');
        multiDayInput.checked = defaultDates.length > 1 || categorySelect?.value === 'Festival';

        // Single mode picks one day with one tap; range mode needs start + end
        const initDatePicker = dates => flatpickr(dateRangeInput, {
          mode: multiDayInput.checked ? 'range' : 'single',
          dateFormat: 'Y-m-d',
          defaultDate: dates
        });
        let datePicker = initDatePicker(defaultDates);

        const applyDateMode = () => {
          const dates = datePicker.selectedDates.slice(0, multiDayInput.checked ? 2 : 1);
          datePicker.destroy();
          datePicker = initDatePicker(dates);
          dateRangeInput.placeholder = multiDayInput.checked ? 'Select start and end dates' : 'Select date';
        };
        if (multiDayInput.checked) dateRangeInput.placeholder = 'Select start and end dates';

        multiDayInput.onchange = () => {
          applyDateMode();
          if (multiDayInput.checked) datePicker.open();
        };

        // Festivals are usually multi-day; other categories default to a single day
        // unless a real range is already selected
        if (categorySelect) {
          categorySelect.addEventListener('change', () => {
            const wantsMultiDay = categorySelect.value === 'Festival' || datePicker.selectedDates.length > 1;
            if (wantsMultiDay !== multiDayInput.checked) {
              multiDayInput.checked = wantsMultiDay;
              applyDateMode();
            }
          });
        }

        const statusChips = document.querySelectorAll('#ticketStatusChips .status-chip');
        const ticketStatusInput = document.getElementById('f_ticket_status');
        const ticketInfoField = document.getElementById('ticketInfoField');

        statusChips.forEach(chip => {
          chip.onclick = () => {
            const val = chip.getAttribute('data-val');
            if (ticketStatusInput.value === val) {
              ticketStatusInput.value = '';
              chip.classList.remove('selected');
            } else {
              ticketStatusInput.value = val;
              statusChips.forEach(c => c.classList.remove('selected'));
              chip.classList.add('selected');
            }
            if (ticketInfoField) {
              ticketInfoField.style.display = (ticketStatusInput.value || editedTicketFile) ? 'block' : 'none';
            }
          };
        });

        if (focusField) {
          setTimeout(() => document.getElementById(focusField)?.focus(), 0);
        }

        const renderFriendChips = () => {
          const container = document.getElementById('friends-chips');
          const pillsContainer = document.getElementById('selectedPills');
          if (!container || !pillsContainer) return;

          const currentValues = companyInput.value.split(',').map(v => v.trim()).filter(Boolean);
          const currentLower = currentValues.map(v => v.toLowerCase());

          // Render selected pills inside the tag input box
          pillsContainer.innerHTML = currentValues.map(friend => `
            <span class="selected-pill">
              ${escapeHtml(friend)}
              <span class="selected-pill-remove" onclick="event.stopPropagation(); window.toggleFriend('${escapeAttr(friend)}')">✕</span>
            </span>
          `).join('');

          // Render quick-select chips below
          const query = friendsSearch.value.trim().toLowerCase();
          container.innerHTML = state.savedFriends.filter(friend => !query || friend.toLowerCase().includes(query)).map(friend => {
            const isSelected = currentLower.includes(friend.toLowerCase());
            return `<button type="button" class="friend-chip ${isSelected ? 'selected' : ''}" data-friend="${escapeAttr(friend)}">${escapeHtml(friend)}</button>`;
          }).join('');

          container.querySelectorAll('.friend-chip').forEach(chip => {
            chip.onclick = () => window.toggleFriend(chip.dataset.friend || '');
          });
        };

        window.addFriend = friend => {
          if (!friend) return;
          const names = friend.split(',').map(n => n.trim()).filter(Boolean);
          let values = companyInput.value.split(',').map(value => value.trim()).filter(Boolean);

          names.forEach(name => {
            const lowerFriend = name.toLowerCase();
            if (!values.find(value => value.toLowerCase() === lowerFriend)) {
              values.push(name);
            }
            if (!state.savedFriends.find(item => item.toLowerCase() === lowerFriend)) {
              state.savedFriends.push(name);
            }
          });

          companyInput.value = values.join(', ');
          renderFriendChips();
        };

        window.toggleFriend = friend => {
          let values = companyInput.value.split(',').map(value => value.trim()).filter(Boolean);
          const lowerFriend = friend.toLowerCase();

          if (values.find(value => value.toLowerCase() === lowerFriend)) {
            values = values.filter(value => value.toLowerCase() !== lowerFriend);
          } else {
            values.push(friend);
          }

          companyInput.value = values.join(', ');
          renderFriendChips();
        };

        friendsSearch.addEventListener('input', renderFriendChips);
        friendsSearch.addEventListener('keydown', event => {
          if (event.key !== 'Enter' && event.key !== ',') return;
          event.preventDefault();
          const friend = friendsSearch.value.trim();
          if (!friend) return;

          window.addFriend(friend);
          friendsSearch.value = '';
          renderFriendChips();
        });

        friendsSearch.addEventListener('blur', () => {
          const friend = friendsSearch.value.trim();
          if (!friend) return;

          window.addFriend(friend);
          friendsSearch.value = '';
          renderFriendChips();
        });
        renderFriendChips();

        const geoBtn = document.getElementById('geoBtn');
        if (geoBtn) {
          geoBtn.onclick = () => {
            if (!navigator.geolocation) {
              alert('Geolocation not supported.');
              return;
            }

            geoBtn.innerHTML = iconSvg('clock');
            navigator.geolocation.getCurrentPosition(async position => {
              try {
                const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${position.coords.latitude}&lon=${position.coords.longitude}&zoom=10`);
                const data = await response.json();
                const city = data.address.city || data.address.town || data.address.village || data.address.municipality || '';
                if (city) document.getElementById('f_city').value = city;
              } catch (error) {
                console.error(error);
              } finally {
                geoBtn.innerHTML = iconSvg('location');
              }
            }, () => {
              geoBtn.innerHTML = iconSvg('location');
              alert('Could not get your location.');
            });
          };
        }

        document.getElementById('cancelBtn').onclick = () => {
          elements.reviewSlot.innerHTML = '';
          elements.statusEl.textContent = '';
          restoreAddOptions();
        };

        document.getElementById('saveBtn').onclick = async () => {
          try {
            // Commit any uncommitted text currently in friendsSearch input
            const searchVal = friendsSearch ? friendsSearch.value.trim() : '';
            if (searchVal) {
              window.addFriend(searchVal);
              if (friendsSearch) friendsSearch.value = '';
            }

            const artistName = document.getElementById('f_artist')?.value.trim() || '';
            if (!artistName) {
              alert('Please enter an Artist or Event Name.');
              document.getElementById('f_artist')?.focus();
              return;
            }

            const dateInput = document.getElementById('f_daterange')?.value || '';
            const [startDate, endDate] = dateInput.includes(' to ') ? dateInput.split(' to ') : [dateInput, dateInput];
            const companyText = document.getElementById('f_company')?.value.trim() || '';
            const previousEvents = state.events;

            const event = {
              id: prefill.id || uid(),
              artist: artistName,
              company: companyText,
              startDate: startDate || new Date().toISOString().slice(0, 10),
              endDate: endDate || startDate || new Date().toISOString().slice(0, 10),
              time: document.getElementById('f_time')?.value || '',
              venue: document.getElementById('f_venue')?.value.trim() || '',
              city: document.getElementById('f_city')?.value.trim() || '',
              category: document.getElementById('f_category')?.value || 'Concert',
              ticketStatus: document.getElementById('f_ticket_status')?.value || '',
              ticketFile: editedTicketFile,
              ticketFileName: editedTicketFileName,
              description: document.getElementById('f_desc')?.value.trim() || '',
              image: editedImage
            };

            if (companyText) {
              const names = companyText.split(',').map(name => name.trim()).filter(Boolean);
              let changed = false;

              names.forEach(name => {
                if (!state.savedFriends.find(friend => friend.toLowerCase() === name.toLowerCase())) {
                  state.savedFriends.push(name);
                  changed = true;
                }
              });

              if (changed) await setStorageItem(FRIENDS_KEY, JSON.stringify(state.savedFriends));
            }

            if (prefill.id) {
              state.events = dedupeEvents(state.events.map(item => item.id === event.id ? event : item));
            } else {
              state.events = dedupeEvents([...state.events, event]);
            }

            if (!await saveEvents()) {
              state.events = previousEvents;
              alert('Could not save this event. If you attached a large image, please try a smaller image file.');
              return;
            }

            elements.reviewSlot.innerHTML = '';
            restoreAddOptions();
            elements.statusEl.textContent = 'Added to cue ✓';
            if (elements.fileInput) elements.fileInput.value = '';
            render();
            renderCalendar();
            switchTab('queue');
            showCalendarToast(event);
            setTimeout(() => {
              if (elements.statusEl.textContent === 'Added to cue ✓') elements.statusEl.textContent = '';
            }, 2500);
          } catch (saveErr) {
            console.error('Save button error:', saveErr);
            alert('Error saving event: ' + saveErr.message);
          }
        };

        elements.reviewSlot.scrollIntoView({ behavior: 'smooth' });
      }

      function showCalendarToast(event) {
        const slot = document.getElementById('calendarToastSlot');
        slot.innerHTML = `<div class="calendar-toast" role="status"><span>Event saved. Add it to your calendar?</span><button id="calendarToastBtn">Add</button></div>`;

        document.getElementById('calendarToastBtn').onclick = () => {
          window.open(gcalUrl(event), '_blank', 'noopener,noreferrer');
          slot.innerHTML = '';
        };

        setTimeout(() => {
          if (slot.firstChild) slot.innerHTML = '';
        }, 8000);
      }

      function openDetailModal(event) {
        if (!event) return;
        try {
          const dateStr = fmtDateRange(event.startDate, event.endDate);
          const timeStr = event.time ? ` · ${event.time}` : '';
          const locationText = [event.city, event.venue].filter(Boolean).join(' · ');
          const overlay = document.getElementById('eventModalOverlay');
          const content = document.getElementById('eventModalContent');

          if (!overlay || !content) {
            alert('Modal element missing');
            return;
          }

        let dayBadgeText = '';
        if (event.startDate) {
          const d = new Date(event.startDate + 'T00:00:00');
          const now = new Date();
          now.setHours(0, 0, 0, 0);
          const diffDays = Math.round((d - now) / 86400000);
          if (diffDays === 0) dayBadgeText = 'today';
          else if (diffDays === 1) dayBadgeText = 'tomorrow';
          else if (diffDays > 1) dayBadgeText = `in ${diffDays} days`;
        }

        content.innerHTML = `
          <div class="event-modal-header" style="display:flex; justify-content:flex-end; margin-bottom:10px;">
            <button class="modal-close" id="closeModalBtn" type="button" aria-label="Close event details">${iconSvg('close')}</button>
          </div>

          ${safeImageUrl(event.image)
            ? `<img class="event-detail-image" src="${escapeAttr(safeImageUrl(event.image))}" alt="Poster" style="height:190px; width:100%; object-fit:cover; border-radius:14px; margin-bottom:14px;">`
            : `<div class="event-detail-placeholder" aria-label="No event photo" style="height:110px; border-radius:14px; margin-bottom:14px;">${iconSvg('ticket')}</div>`}

          <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:12px;">
            <h2 class="event-detail-title" style="margin:0; font-family:'Outfit', sans-serif; font-size:24px; font-weight:800; color:var(--text-main); line-height:1.2;">${escapeHtml(event.artist || 'Untitled event')}</h2>
            ${event.ticketStatus && ticketLabel(event.ticketStatus) ? `<span class="ticket-badge ${escapeAttr(event.ticketStatus)}">${escapeHtml(ticketLabel(event.ticketStatus))}</span>` : ''}
          </div>

          ${(() => {
            let html = '';
            if (event.ticketFile) {
              html += `<div style="margin-bottom:14px;">
                <a href="${escapeAttr(event.ticketFile)}" download="${escapeAttr(event.ticketFileName || 'ticket')}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost" style="font-size:12px; display:inline-flex; align-items:center; gap:6px; color:var(--accent-strong); border-color:rgba(168,85,247,0.3); text-decoration:none;">
                  ${iconSvg('ticket')} Open Attached Ticket (${escapeHtml(event.ticketFileName || 'File')}) ↗
                </a>
              </div>`;
            }
            if (!event.ticketInfo) return html;
            const info = event.ticketInfo.trim();
            const isUrl = /^https?:\/\//i.test(info) || /^www\./i.test(info);
            const hrefUrl = /^www\./i.test(info) ? `https://${info}` : info;
            if (isUrl) {
              html += `<div style="margin-bottom:14px;">
                <a href="${escapeAttr(hrefUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost" style="font-size:12px; display:inline-flex; align-items:center; gap:6px; color:var(--accent-strong); border-color:rgba(168,85,247,0.3); text-decoration:none;">
                  ${iconSvg('ticket')} Open Ticket Link ↗
                </a>
              </div>`;
            } else {
              html += `<div style="font-size:13px; color:var(--text-main); background:var(--surface-soft); padding:8px 12px; border-radius:10px; border:1px solid var(--border); margin-bottom:14px;">
                <strong style="color:var(--text-muted); font-size:10px; letter-spacing:0.08em; text-transform:uppercase; display:block; margin-bottom:2px;">TICKET DETAILS</strong>
                ${escapeHtml(info)}
              </div>`;
            }
            return html;
          })()}

          <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:16px;">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; font-size:14px; font-weight:600; color:#ffffff;">
              <div style="display:flex; align-items:center; gap:8px;">
                <span style="color:var(--text-muted); display:inline-flex; align-items:center;">${iconSvg('calendar')}</span>
                <span>${escapeHtml(dateStr)}${escapeHtml(timeStr)}</span>
              </div>
              ${dayBadgeText ? `<span style="font-size:11px; font-weight:700; color:var(--purple-light); background:rgba(168,85,247,0.12); border:1px solid rgba(168,85,247,0.5); border-radius:99px; padding:3px 10px; letter-spacing:0.02em; flex-shrink:0;">${escapeHtml(dayBadgeText)}</span>` : ''}
            </div>

            ${locationText ? `
              <div style="display:flex; align-items:center; gap:8px; font-size:14px; font-weight:500; color:var(--text-muted);">
                <span style="color:var(--text-muted); display:inline-flex; align-items:center;">${iconSvg('location')}</span>
                <a href="https://maps.google.com/?q=${encodeURIComponent(locationText)}" target="_blank" rel="noopener noreferrer" class="map-link" style="color:var(--purple-light); font-weight:600; text-decoration:none; display:inline-flex; align-items:center; gap:4px;">${escapeHtml(locationText)} <span style="font-size:11px; opacity:0.7;">↗</span></a>
              </div>
            ` : ''}

            ${event.company ? `
              <div style="display:flex; align-items:center; gap:8px; font-size:14px; font-weight:500; color:var(--text-muted);">
                <span style="color:var(--text-muted); display:inline-flex; align-items:center;">${iconSvg('users')}</span>
                <span>With <strong style="color:#ffffff; font-weight:600;">${escapeHtml(event.company)}</strong></span>
              </div>
            ` : ''}
          </div>

          ${event.description ? `
            <hr style="border:0; border-top:1px solid rgba(255,255,255,0.08); margin:16px 0;">
            <div style="margin-bottom:16px;">
              <div style="font-size:11px; font-weight:700; letter-spacing:0.08em; color:var(--text-muted); text-transform:uppercase; margin-bottom:6px;">ABOUT</div>
              <p style="margin:0; font-size:14px; line-height:1.5; color:#d4d4d8; white-space:pre-wrap; word-break:break-word;">${escapeHtml(event.description)}</p>
            </div>
          ` : ''}

          <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:16px; padding-top:14px; border-top:1px solid rgba(255,255,255,0.08);">
            <button class="btn btn-ghost" id="gcalFromModalBtn" style="font-size:12px; padding:10px 12px; color:var(--purple-light); border-color:rgba(168,85,247,0.3); flex:1;">Calendar</button>
            <button class="btn btn-ghost" id="editFromModalBtn" style="font-size:12px; padding:10px 12px; color:var(--text-muted); border-color:var(--border); flex:1;">Edit</button>
            <button class="btn btn-ghost" id="btnDelFromModal" style="font-size:12px; padding:10px 12px; color:var(--danger); border-color:rgba(239,68,68,0.25); flex:1;">Delete</button>
          </div>
        `;

        overlay.style.display = 'flex';
        overlay.style.visibility = 'visible';
        overlay.style.opacity = '1';
        overlay.style.zIndex = '99999';
        overlay.classList.add('active');

        const closeModal = () => {
          overlay.style.display = 'none';
          overlay.style.visibility = 'hidden';
          overlay.style.opacity = '0';
          overlay.classList.remove('active');
        };
        document.getElementById('closeModalBtn').onclick = closeModal;
        overlay.onclick = e => {
          if (e.target === overlay) closeModal();
        };

        document.getElementById('btnDelFromModal').onclick = async () => {
          closeModal();
          await deleteEvent(event.id);
        };

        document.getElementById('editFromModalBtn').onclick = () => {
          closeModal();
          switchTab('add');
          openReview(event);
        };

        const gcalBtn = document.getElementById('gcalFromModalBtn');
        if (gcalBtn) {
          gcalBtn.onclick = () => {
            window.open(gcalUrl(event), '_blank', 'noopener,noreferrer');
          };
        }
        } catch (err) {
          alert('Error opening event: ' + err.message);
        }
      }

      function renderCalendar() {
        const year = state.calCurrentDate.getFullYear();
        const month = state.calCurrentDate.getMonth();
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        document.getElementById('calMonthTitle').textContent = `${monthNames[month]} ${year}`;

        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const todayStr = new Date().toISOString().slice(0, 10);
        const grid = document.getElementById('calGrid');
        grid.innerHTML = '';

        for (let index = 0; index < firstDay; index += 1) {
          const emptyCell = document.createElement('div');
          emptyCell.className = 'cal-cell empty-cell';
          grid.appendChild(emptyCell);
        }

        for (let day = 1; day <= daysInMonth; day += 1) {
          const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const cell = document.createElement('div');
          cell.className = 'cal-cell';
          if (dateKey === todayStr) cell.classList.add('today');
          if (dateKey === state.calSelectedDateStr) cell.classList.add('selected');

          const numSpan = document.createElement('span');
          numSpan.className = 'cal-day-num';
          numSpan.textContent = day;
          cell.appendChild(numSpan);

          const dayEvents = state.events.filter(event => {
            if (!event.startDate) return false;
            if (event.endDate) return dateKey >= event.startDate && dateKey <= event.endDate;
            return event.startDate === dateKey;
          }).sort((a, b) => {
            const aMulti = a.endDate && a.endDate !== a.startDate ? 1 : 0;
            const bMulti = b.endDate && b.endDate !== b.startDate ? 1 : 0;
            if (aMulti !== bMulti) return bMulti - aMulti;
            return (a.artist || '').localeCompare(b.artist || '');
          });

          if (dayEvents.length > 0) {
            const visibleEvents = dayEvents.slice(0, 2);
            visibleEvents.forEach(event => {
              const isMultiDay = event.endDate && event.endDate !== event.startDate;
              const isStart = event.startDate === dateKey;
              const isEnd = event.endDate === dateKey;

              let background = 'linear-gradient(135deg, rgba(168, 85, 247, 0.35), rgba(192, 132, 252, 0.45))';
              let border = 'rgba(168, 85, 247, 0.6)';
              let textColor = '#ffffff';

              if (event.category === 'Festival') {
                background = 'linear-gradient(135deg, rgba(245, 158, 11, 0.35), rgba(251, 191, 36, 0.45))';
                border = 'rgba(245, 158, 11, 0.7)';
                textColor = '#fef08a';
              } else if (event.category === 'Other' || event.category === 'Party') {
                background = 'linear-gradient(135deg, rgba(20, 184, 166, 0.35), rgba(45, 212, 191, 0.45))';
                border = 'rgba(20, 184, 166, 0.7)';
                textColor = '#99f6e4';
              }

              const pill = document.createElement('div');
              pill.className = 'cal-event-pill';
              pill.style.background = background;
              pill.style.border = `1px solid ${border}`;
              pill.style.color = textColor;
              pill.textContent = event.artist || 'Event';
              pill.title = event.artist || 'Event';
              pill.setAttribute('aria-label', event.artist || 'Event');

              if (isMultiDay) {
                if (isStart && !isEnd) {
                  pill.classList.add('cal-event-pill-start');
                } else if (isEnd && !isStart) {
                  pill.classList.add('cal-event-pill-end');
                } else if (!isStart && !isEnd) {
                  pill.classList.add('cal-event-pill-mid');
                }
              }

              cell.appendChild(pill);
            });

            const hiddenEventCount = dayEvents.length - visibleEvents.length;
            if (hiddenEventCount > 0) {
              const more = document.createElement('div');
              more.style.fontSize = '8px';
              more.style.fontWeight = '700';
              more.style.color = 'var(--purple-light)';
              more.style.marginTop = '1px';
              more.textContent = `+${hiddenEventCount} more`;
              more.title = 'Select this day to view all events';
              cell.appendChild(more);
            }
          }

          cell.onclick = () => {
            state.calSelectedDateStr = dateKey;
            renderCalendar();
            renderSelectedDateEvents(dateKey, dayEvents);
          };

          grid.appendChild(cell);
        }

        if (!state.calSelectedDateStr) {
          renderSelectedDateEvents(null, []);
        } else {
          const selectedEvents = state.events.filter(event => {
            if (!event.startDate) return false;
            if (event.endDate) return state.calSelectedDateStr >= event.startDate && state.calSelectedDateStr <= event.endDate;
            return event.startDate === state.calSelectedDateStr;
          });
          renderSelectedDateEvents(state.calSelectedDateStr, selectedEvents);
        }
      }

      function renderSelectedDateEvents(dateStr, dayEvents) {
        const title = document.getElementById('calSelectedTitle');
        const list = document.getElementById('calSelectedList');

        if (dateStr) {
          title.textContent = `EVENTS ON ${dateStr}`;
          const rest = state.events
            .filter(event => !isPast(event) && event.startDate)
            .filter(event => {
              if (event.endDate) return !(dateStr >= event.startDate && dateStr <= event.endDate);
              return event.startDate !== dateStr;
            })
            .sort((a, b) => a.startDate.localeCompare(b.startDate));

          let html = '';
          if (dayEvents.length) {
            html += `<div class="month-header" style="color:var(--purple-light);border-color:rgba(168,85,247,0.3)"> ${dateStr}</div>`;
            html += dayEvents.map(renderQueueItem).join('');
          } else {
            html += '<div class="empty">No events this day.</div>';
          }

          if (rest.length) {
            html += '<div class="month-header" style="margin-top:16px;">Other upcoming</div>';
            html += rest.map(renderQueueItem).join('');
          }

          list.innerHTML = html || '<div class="empty">No events this month.</div>';
        } else {
          title.textContent = 'UPCOMING EVENTS';
          const upcoming = state.events
            .filter(event => !isPast(event) && event.startDate)
            .sort((a, b) => a.startDate.localeCompare(b.startDate));

          list.innerHTML = upcoming.length
            ? upcoming.map(renderQueueItem).join('')
            : '<div class="empty">No upcoming events.</div>';
        }

        document.querySelectorAll('#calSelectedList [data-view]').forEach(el => {
          el.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const id = el.getAttribute('data-view');
            const match = state.events.find(event => String(event.id) === String(id));
            if (match) openDetailModal(match);
          };
        });
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

      // Native Android uses the LocalNotifications plugin; the WebView has no web Notification API
      function getLocalNotifications() {
        return window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins?.LocalNotifications || null : null;
      }

      // Resolves to 'granted', 'denied' or 'prompt'
      async function getNotificationPermission() {
        const LN = getLocalNotifications();
        if (LN) {
          try {
            const { display } = await LN.checkPermissions();
            return display === 'granted' || display === 'denied' ? display : 'prompt';
          } catch (error) {
            return 'prompt';
          }
        }
        if (!('Notification' in window)) return 'denied';
        return Notification.permission === 'default' ? 'prompt' : Notification.permission;
      }

      async function requestNotificationPermission() {
        try {
          const LN = getLocalNotifications();
          if (LN) {
            const { display } = await LN.requestPermissions();
            return display === 'granted';
          }
          if (!('Notification' in window)) return false;
          return (await Notification.requestPermission()) === 'granted';
        } catch (error) {
          console.warn('Could not request notification permission', error);
          return false;
        }
      }

      function loadNotificationPrefs() {
        const defaultPrefs = {
          leadTimes: ['1h', '0', '1', '3'],
          customEnabled: false,
          customValue: 30,
          customUnit: 'm'
        };
        try {
          const raw = localStorage.getItem('cue-notification-prefs');
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              return { ...defaultPrefs, leadTimes: parsed.map(String).filter(k => k !== '15m' && k !== '7') };
            }
            if (typeof parsed === 'object' && parsed !== null) {
              return { ...defaultPrefs, ...parsed };
            }
          }
        } catch (error) {
          // Fall through
        }
        return defaultPrefs;
      }

      async function openSettingsModal() {
        if (await getNotificationPermission() === 'prompt') {
          await requestNotificationPermission();
          updateNotificationBtn();
          checkEventNotifications();
        }
        const prefs = loadNotificationPrefs();

        ['1h', '0', '1', '3'].forEach(key => {
          const checkbox = document.getElementById(`pref-${key}`);
          if (checkbox) checkbox.checked = (prefs.leadTimes || []).includes(key);
        });

        const customCheckbox = document.getElementById('pref-custom');
        const customSection = document.getElementById('customReminderSection');
        const customNum = document.getElementById('pref-custom-num');
        const customUnit = document.getElementById('pref-custom-unit');

        if (customCheckbox) {
          customCheckbox.checked = !!prefs.customEnabled;
          if (customSection) customSection.style.display = customCheckbox.checked ? 'block' : 'none';
          customCheckbox.onchange = () => {
            if (customSection) customSection.style.display = customCheckbox.checked ? 'block' : 'none';
          };
        }

        if (customNum) customNum.value = prefs.customValue || 30;
        if (customUnit) customUnit.value = prefs.customUnit || 'm';

        document.getElementById('settingsModalOverlay').classList.add('active');
      }

      async function triggerNotification(title, options) {
        try {
          if (await getNotificationPermission() !== 'granted' && !(await requestNotificationPermission())) {
            return false;
          }

          const LN = getLocalNotifications();
          if (LN) {
            await LN.schedule({
              notifications: [{
                title: title,
                body: options.body || '',
                id: options.id || Math.floor(Math.random() * 100000) + 1,
                schedule: { at: new Date(Date.now() + 300), allowWhileIdle: true },
                extra: options.data || null
              }]
            });
            return true;
          }

          if ('Notification' in window && Notification.permission === 'granted') {
            try {
              if ('serviceWorker' in navigator) {
                let reg = await navigator.serviceWorker.getRegistration();
                if (!reg) reg = await navigator.serviceWorker.ready;
                if (reg && reg.showNotification) {
                  await reg.showNotification(title, options);
                  return true;
                }
              }
            } catch (err) {
              console.warn('ServiceWorker showNotification error, falling back:', err);
            }

            try {
              new Notification(title, options);
              return true;
            } catch (err) {
              console.warn('new Notification fallback error:', err);
              return false;
            }
          }
        } catch (e) {
          console.warn('Notification trigger error:', e);
          return false;
        }
        return false;
      }

      async function updateNotificationBtn() {
        const button = document.getElementById('settingsBtn');
        if (!button) return;

        if (await getNotificationPermission() === 'granted') {
          button.style.borderColor = 'rgba(168,85,247,0.5)';
          button.style.color = '#c084fc';
          button.title = 'Notifications Active';
        } else {
          button.style.borderColor = 'var(--border)';
          button.style.color = 'var(--text-main)';
          button.title = 'Settings';
        }
      }

      function updateAppBadge() {
        const upcoming = state.events.filter(event => !isPast(event) && event.startDate);
        if ('setAppBadge' in navigator) {
          if (upcoming.length > 0) {
            navigator.setAppBadge(upcoming.length).catch(() => { });
          } else {
            navigator.clearAppBadge().catch(() => { });
          }
        }
      }

      // Day-based reminders (day of, days before, ticket) fire at this local hour
      const DAY_REMINDER_HOUR = 10;
      // Android keeps at most 500 alarms per app; stay well below that
      const MAX_SCHEDULED_REMINDERS = 200;

      function notificationId(key) {
        let hash = 0;
        for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
        return (hash & 0x7fffffff) || 1;
      }

      // Every reminder an event should get, with when it fires (at) and until when it is still useful (expiresAt)
      function buildReminders(prefs) {
        const leadTimes = prefs.leadTimes || [];
        const reminders = [];

        state.events.forEach(event => {
          const [year, month, day] = (event.startDate || '').split('-').map(Number);
          if (!year || !month || !day) return;

          const timeMatch = /^(\d{1,2}):(\d{2})/.exec(event.time || '');
          const start = timeMatch ? new Date(year, month - 1, day, Number(timeMatch[1]), Number(timeMatch[2])) : null;
          const dayStart = daysBefore => new Date(year, month - 1, day - daysBefore);
          const dayAt = daysBefore => new Date(year, month - 1, day - daysBefore, DAY_REMINDER_HOUR);
          const dayEnd = daysBefore => new Date(year, month - 1, day - daysBefore + 1);

          const timeText = event.time ? ` · ${event.time}` : '';
          const locationText = [event.venue, event.city].filter(Boolean).join(' · ');
          const body = `${event.artist || 'Event'}${timeText}${locationText ? ` · ${locationText}` : ''}`;
          const add = (suffix, at, expiresAt, title, customBody = body) => {
            reminders.push({ key: `${event.id}-${event.startDate}-${suffix}`, at, expiresAt, title, body: customBody, eventId: event.id });
          };

          // Time-based reminders only make sense when the event has a start time
          if (leadTimes.includes('1h') && start) {
            add('1h', new Date(start.getTime() - 60 * 60 * 1000), start, 'Event starts in 1 hour!');
          }

          [0, 1, 3].forEach(daysBefore => {
            if (!leadTimes.includes(String(daysBefore))) return;
            let at = dayAt(daysBefore);
            let expiresAt = dayEnd(daysBefore);
            if (daysBefore === 0 && start) {
              // Morning events: remind 2h before instead of after they started
              const twoHoursBefore = new Date(start.getTime() - 2 * 60 * 60 * 1000);
              if (twoHoursBefore < at) at = twoHoursBefore < dayStart(0) ? dayStart(0) : twoHoursBefore;
              expiresAt = start;
            }
            const title = daysBefore === 0 ? 'Your event is today!'
              : daysBefore === 1 ? 'Your event is tomorrow!'
              : `${daysBefore} days until your next event!`;
            add(`d${daysBefore}`, at, expiresAt, title);
          });

          if (prefs.customEnabled && prefs.customValue > 0) {
            const value = prefs.customValue;
            const unit = prefs.customUnit || 'm';
            const unitLabel = { m: 'minute', h: 'hour', d: 'day' }[unit] + (value === 1 ? '' : 's');
            const title = `Event starts in ${value} ${unitLabel}!`;
            if (unit === 'd') {
              add(`custom-${value}${unit}`, dayAt(value), dayEnd(value), title);
            } else if (start) {
              const offsetMs = value * (unit === 'h' ? 60 : 1) * 60 * 1000;
              add(`custom-${value}${unit}`, new Date(start.getTime() - offsetMs), start, title);
            }
          }

          // Ticket reminder one week before for "need ticket", "maybe" or no ticket status
          if (!event.ticketStatus || event.ticketStatus === 'need_ticket' || event.ticketStatus === 'maybe') {
            const statusLabel = event.ticketStatus === 'need_ticket' ? 'Need ticket' : event.ticketStatus === 'maybe' ? 'Maybe going' : 'No ticket status set';
            add('ticket-7d', dayAt(7), dayStart(0), '🎟️ Ticket Reminder: 1 week left!',
              `${event.artist || 'Event'} (${statusLabel}). Don't forget to check or get your tickets!`);
          }
        });

        return reminders.sort((a, b) => a.at - b.at);
      }

      let lastScheduleSignature = '';

      async function checkEventNotifications() {
        updateAppBadge();
        if (await getNotificationPermission() !== 'granted') return;

        const now = new Date();
        const sent = JSON.parse(localStorage.getItem(NOTIFICATION_KEY) || '{}');
        const reminders = buildReminders(loadNotificationPrefs());
        const LN = getLocalNotifications();

        // Reminders whose time has passed but are still relevant (e.g. event added late, or app was
        // closed on web) are shown once right away
        reminders
          .filter(r => r.at <= now && now < r.expiresAt && !sent[r.key])
          .forEach(r => {
            triggerNotification(r.title, {
              body: r.body,
              icon: 'icon-192.png',
              badge: 'icon-192.png',
              tag: r.key,
              renotify: true,
              id: notificationId(r.key),
              data: { eventId: r.eventId }
            });
            sent[r.key] = true;
          });

        // Native: hand every future reminder to Android so it fires even when the app is closed
        if (LN) {
          const upcoming = reminders.filter(r => r.at > now).slice(0, MAX_SCHEDULED_REMINDERS);
          upcoming.forEach(r => { sent[r.key] = true; });

          const signature = JSON.stringify(upcoming.map(r => [r.key, r.at.getTime(), r.title, r.body]));
          if (signature !== lastScheduleSignature) {
            lastScheduleSignature = signature;
            try {
              const { notifications: pending } = await LN.getPending();
              if (pending.length) await LN.cancel({ notifications: pending.map(n => ({ id: n.id })) });
              if (upcoming.length) {
                await LN.schedule({
                  notifications: upcoming.map(r => ({
                    id: notificationId(r.key),
                    title: r.title,
                    body: r.body,
                    schedule: { at: r.at, allowWhileIdle: true },
                    extra: { eventId: r.eventId }
                  }))
                });
              }
            } catch (error) {
              lastScheduleSignature = '';
              console.warn('Could not schedule reminders', error);
            }
          }
        }

        localStorage.setItem(NOTIFICATION_KEY, JSON.stringify(sent));
      }

      async function handleSharedText(sharedText) {
        switchTab('add');
        renderAiParsingState();

        try {
          const response = await fetch(getApiEndpoint(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sharedUrl: sharedText })
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
          if (data._extractedImage) {
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

      async function loadEvents() {
        try {
          const raw = await getStorageItem(STORE_KEY) || await getStorageItem('someday-events');
          state.events = raw ? JSON.parse(raw) : [];

          state.events = dedupeEvents(state.events.map(event => {
            if (!event.id) event.id = uid();
            if (event.name && !event.artist) event.artist = event.name;
            if (event.location && !event.venue) event.venue = event.location;
            if (!event.category) event.category = 'Concert';
            return event;
          }));

          const friendsRaw = await getStorageItem(FRIENDS_KEY);
          if (friendsRaw) state.savedFriends = JSON.parse(friendsRaw);
        } catch (error) {
          state.events = [];
          state.savedFriends = [];
        }

        updateDynamicDatalists();
        checkEventNotifications();
        render();
        renderCalendar();
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

        window.checkForSharedDataNative = async function () {
          if (!window.Capacitor?.Plugins?.Preferences) return;
          const { value } = await window.Capacitor.Plugins.Preferences.get({ key: 'pending-share-intent' });
          if (value) {
            await window.Capacitor.Plugins.Preferences.remove({ key: 'pending-share-intent' });
            switchTab('add');
            handleSharedText(value);
          }
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

            let targetEvent = state.events.find(event => event.id === targetId);
            if (!targetEvent && targetDate) {
              targetEvent = state.events.find(event => event.startDate === targetDate || (event.startDate <= targetDate && event.endDate >= targetDate));
            }

            if (targetEvent) {
              switchTab('queue');
              openDetailModal(targetEvent);
            } else if (targetDate) {
              switchTab('calendar');
              state.calSelectedDateStr = targetDate;
              renderCalendar();
            }
          }
        };

        if (window.Capacitor?.isNative) {
          window.checkForSharedDataNative();
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

      function bindStaticEventHandlers() {
        document.querySelectorAll('.nav-btn, .nav-btn-center').forEach(button => {
          button.onclick = () => switchTab(button.getAttribute('data-tab'));
        });

        document.getElementById('settingsBtn').onclick = openSettingsModal;

        document.querySelectorAll('.feed-tab').forEach(button => {
          button.onclick = () => {
            state.queueFilter = button.dataset.filter || 'all';
            state.showAllUpcoming = false;
            render();
          };
        });

        document.addEventListener('touchstart', event => {
          state.swipeStartX = event.touches[0].clientX;
          state.swipeStartY = event.touches[0].clientY;
        }, { passive: true });

        document.addEventListener('touchend', event => {
          if (document.querySelector('.modal-overlay.active')) return;

          const dx = event.changedTouches[0].clientX - state.swipeStartX;
          const dy = event.changedTouches[0].clientY - state.swipeStartY;
          if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx) * 0.8) return;

          const activeTab = document.querySelector('.nav-btn.active')?.getAttribute('data-tab')
            || document.querySelector('.tab-screen.active')?.id.replace('screen-', '');
          const index = TAB_ORDER.indexOf(activeTab);
          if (dx < 0 && index < TAB_ORDER.length - 1) switchTab(TAB_ORDER[index + 1]);
          if (dx > 0 && index > 0) switchTab(TAB_ORDER[index - 1]);
        }, { passive: true });

        document.addEventListener('click', event => {
          if (event.target.id === 'addCloseBtn') switchTab('queue');
          if (document.querySelector('.modal-overlay.active')) return;
          const viewTarget = event.target.closest('[data-view]');
          if (viewTarget) {
            const id = viewTarget.getAttribute('data-view');
            if (id && window.openDetailModalById) {
              window.openDetailModalById(id);
            }
          }
        });

        document.getElementById('calPrevBtn').onclick = () => {
          state.calCurrentDate.setMonth(state.calCurrentDate.getMonth() - 1);
          renderCalendar();
        };

        document.getElementById('calNextBtn').onclick = () => {
          state.calCurrentDate.setMonth(state.calCurrentDate.getMonth() + 1);
          renderCalendar();
        };

        document.getElementById('btnOptionScreenshot').onclick = () => {
          closeLinkInput();
          elements.fileInput.click();
        };

        elements.fileInput.addEventListener('change', () => {
          if (elements.fileInput.files[0]) handleFile(elements.fileInput.files[0]);
        });

        document.getElementById('btnOptionManual').onclick = () => {
          closeLinkInput();
          openReview({});
        };



        const settingsBtn = document.getElementById('settingsBtn');
        if (settingsBtn) {
          settingsBtn.onclick = () => {
            openSettingsModal();
          };
        }

        document.getElementById('closeSettingsBtn').onclick = () => {
          document.getElementById('settingsModalOverlay').classList.remove('active');
        };

        document.getElementById('testNotifBtn').onclick = async event => {
          event.preventDefault();
          customAlert('Sending test notification...', 2000);
          const success = await triggerNotification('Test Notification', {
            body: 'Your Cue app notifications are working correctly!',
            icon: 'icon-192.png',
            badge: 'icon-192.png'
          });
          if (success) {
            customAlert('Test alert dispatched to system!', 3000);
          } else {
            customAlert('Check system notification permissions for Cue.', 3500);
          }
        };

        // Reminder preferences save as soon as they change
        let savedIndicatorTimer;
        const saveNotificationPrefs = () => {
          const leadTimes = ['1h', '0', '1', '3'].filter(key => {
            const el = document.getElementById(`pref-${key}`);
            return el && el.checked;
          });

          const customEnabled = !!document.getElementById('pref-custom')?.checked;
          const customValue = parseInt(document.getElementById('pref-custom-num')?.value, 10) || 30;
          const customUnit = document.getElementById('pref-custom-unit')?.value || 'm';

          const prefs = {
            leadTimes,
            customEnabled,
            customValue,
            customUnit
          };

          localStorage.setItem('cue-notification-prefs', JSON.stringify(prefs));
          checkEventNotifications();

          const indicator = document.getElementById('prefsSavedIndicator');
          if (indicator) {
            indicator.textContent = '✓ Saved';
            indicator.classList.add('visible');
            clearTimeout(savedIndicatorTimer);
            savedIndicatorTimer = setTimeout(() => indicator.classList.remove('visible'), 1500);
          }
        };

        ['pref-3', 'pref-1', 'pref-0', 'pref-1h', 'pref-custom', 'pref-custom-num', 'pref-custom-unit'].forEach(id => {
          document.getElementById(id)?.addEventListener('change', saveNotificationPrefs);
        });

        document.getElementById('exportFileBtn').onclick = async () => {
          const events = state.events || [];
          if (events.length === 0) {
            customAlert('There are no events to back up yet.');
            return;
          }

          const backup = {
            app: 'cue',
            version: 1,
            exportedAt: new Date().toISOString(),
            count: events.length,
            events
          };
          const dataToExport = JSON.stringify(backup, null, 2);
          const filename = `cue-backup-${new Date().toISOString().slice(0, 10)}.json`;

          try {
            const { Filesystem, Share } = window.Capacitor?.Plugins || {};
            if (window.Capacitor?.isNativePlatform?.()) {
              if (!Filesystem || !Share) {
                customAlert('Please update the app to export backups.');
                return;
              }
              // Native Android: write to cache, then open the system share sheet
              // so the user can save it to Files, Drive, email, etc.
              const { uri } = await Filesystem.writeFile({
                path: filename,
                data: dataToExport,
                directory: 'CACHE',
                encoding: 'utf8'
              });
              try {
                await Share.share({ title: 'cue backup', files: [uri], dialogTitle: 'Save backup' });
              } catch (shareErr) {
                if (!/cancel/i.test(shareErr?.message || '')) throw shareErr;
              }
              return;
            }

            // Web: regular file download
            const url = URL.createObjectURL(new Blob([dataToExport], { type: 'application/json' }));
            const downloadAnchor = document.createElement('a');
            downloadAnchor.href = url;
            downloadAnchor.download = filename;
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            downloadAnchor.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          } catch (e) {
            customAlert('Could not export backup: ' + e.message);
          }
        };

        document.getElementById('importFileBtn').onclick = () => {
          elements.fileInputBackup.value = '';
          elements.fileInputBackup.click();
        };

        elements.fileInputBackup.onchange = event => {
          const file = event.target.files[0];
          if (!file) return;

          const reader = new FileReader();
          reader.onload = async loadEvent => {
            let parsed;
            try {
              parsed = JSON.parse(loadEvent.target.result);
            } catch (error) {
              customAlert('This file is not a valid backup (invalid JSON).');
              return;
            }

            // Accept the current { events: [...] } format and old plain-array backups
            const importedEvents = (Array.isArray(parsed) ? parsed : parsed?.events || [])
              .filter(ev => ev && typeof ev === 'object' && !Array.isArray(ev));
            if (importedEvents.length === 0) {
              customAlert('No events found in this backup file.');
              return;
            }

            const before = state.events.length;
            state.events = dedupeEvents([...state.events, ...importedEvents]);
            const added = state.events.length - before;
            await saveEvents();
            render();
            renderCalendar();
            document.getElementById('settingsModalOverlay').classList.remove('active');
            customAlert(added > 0
              ? `✓ Restored ${added} new event${added === 1 ? '' : 's'} (${importedEvents.length - added} already existed).`
              : '✓ All events in this backup already exist.');
          };

          reader.readAsText(file);
        };

        updateNotificationBtn();
        setInterval(checkEventNotifications, 60 * 1000);
      }

      function initializeApp() {
        document.documentElement.removeAttribute('data-theme');
        localStorage.removeItem('cue-theme-v1');
        window.openDetailModal = openDetailModal;
        window.openDetailModalById = (id) => {
          let match = state.events.find(e => String(e.id) === String(id));
          if (!match && id) {
            match = state.events.find(e => (e.artist && String(e.artist).trim() === String(id).trim()));
          }
          if (!match && state.events.length === 1) {
            match = state.events[0];
          }
          if (match) {
            openDetailModal(match);
          } else {
            alert('Event details could not be found.');
          }
        };
        bindStaticEventHandlers();
        loadEvents();

        if (window.CueAuth && typeof window.CueAuth.init === 'function') {
          window.CueAuth.init();
        }

        window.addEventListener('pageshow', event => {
          if (event.persisted || window.location.search.includes('text=') || window.location.search.includes('shared=')) {
            checkForSharedData();
          }
        });

        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.getRegistrations().then(registrations => {
            for (let registration of registrations) {
              registration.unregister();
            }
          });
        }
      }

      initializeApp();
    })();