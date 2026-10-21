/**
 * cue — App start-up: loading events, wiring static UI handlers and initialising. Loaded last.
 */

window.cueAppState = state;
window.cueSaveEvents = saveEvents;
window.cueRenderApp = () => {
  if (typeof renderSpotlight === 'function') renderSpotlight();
  if (typeof render === 'function') render();
  if (typeof renderCalendar === 'function') renderCalendar();
  if (typeof updateDynamicDatalists === 'function') updateDynamicDatalists();
};
// Used by auth.js for cloud sync
window.cueDedupeEvents = dedupeEvents;
window.cueShrinkEventImages = shrinkEventImages;
window.cueToast = message => customAlert(message);

// The app used to run from cue-events.vercel.app, whose browser storage the bundled app (served from
// https://localhost) can't see. Android keeps a copy of every event for the widgets (text only), so
// on the first bundled launch the events come back from there; posters return with cloud sync.
async function restoreEventsFromWidgetCopy() {
  try {
    const Preferences = window.Capacitor?.Plugins?.Preferences;
    if (!Preferences) return null;
    const { value } = await Preferences.get({ key: 'shared-events' });
    const events = value ? JSON.parse(value) : [];
    return Array.isArray(events) && events.length ? events : null;
  } catch (error) {
    return null;
  }
}

async function loadEvents() {
  try {
    const raw = await getStorageItem(STORE_KEY) || await getStorageItem('someday-events');
    state.events = raw ? JSON.parse(raw) : [];

    if (!raw && !localStorage.getItem('cue-moved-into-app')) {
      const restored = await restoreEventsFromWidgetCopy();
      if (restored) {
        state.events = restored;
        await setStorageItem(STORE_KEY, JSON.stringify(restored));
        // Friends picked for past events, so the "Going with" suggestions survive too
        const friends = restored.flatMap(event => String(event.company || '').split(',').map(name => name.trim()).filter(Boolean));
        state.savedFriends = [...new Set(friends)];
        await setStorageItem(FRIENDS_KEY, JSON.stringify(state.savedFriends));
        customAlert('Your events moved into the app. Sign in with Google in Settings to bring back the posters.');
      }
      localStorage.setItem('cue-moved-into-app', '1');
    }

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

  // One-off migration: older events stored full-size posters that overflow storage and cloud sync
  if (await shrinkEventImages(state.events)) {
    await saveEvents(true);
  }

  // Events saved before poster colours existed get theirs once ('' means the poster had no usable colour)
  let coloured = false;
  for (const event of state.events) {
    if (event.image && event.color === undefined) {
      event.color = await extractPosterColor(event.image);
      coloured = true;
    }
  }
  if (coloured) {
    await saveEvents();
    render();
    renderCalendar();
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

  document.getElementById('calExportBtn').onclick = exportEventsToCalendar;
  document.getElementById('settingsCalExportBtn').onclick = exportEventsToCalendar;

  document.getElementById('closeSettingsBtn').onclick = closeSettingsModal;
  // Tapping the dimmed area around the settings sheet closes it
  document.getElementById('settingsModalOverlay').addEventListener('click', event => {
    if (event.target.id === 'settingsModalOverlay') closeSettingsModal();
  });

  bindNotificationSettingsHandlers();
  bindBackupHandlers();

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
  // Once events are loaded, pick up anything handed over at launch: a post shared from
  // Instagram, or an event/day tapped in a widget
  loadEvents().then(() => {
    checkForSharedData();
    bindNotificationTaps();
  });

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
