/**
 * cue — Notification permissions, reminder preferences and reminder scheduling.
 */

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

  const active = await getNotificationPermission() === 'granted';
  button.classList.toggle('is-active', active);
  button.title = active ? 'Notifications active' : 'Settings';
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

function bindNotificationSettingsHandlers() {
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
}
