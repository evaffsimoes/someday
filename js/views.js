/**
 * cue — Rendering: tabs, event list, detail modal, calendar and calendar exports.
 */

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
  const locStr = [event.city, event.venue].filter(Boolean).join(' · ');
  const imageSrc = safeImageUrl(event.image);

  const imageHTML = imageSrc
    ? `<img src="${escapeAttr(imageSrc)}" class="queue-img" alt="Event image">`
    : '<div class="queue-img-placeholder">' + iconSvg('ticket') + '</div>';

  const eventIsPast = isPast(event);
  return `
    <div class="queue-swipe-wrapper">
      <div class="queue-item ${eventIsPast ? 'is-past' : ''}" data-view="${escapeAttr(event.id)}">
        ${imageHTML}

        <div class="queue-info">
          <div class="queue-artist">${escapeHtml(event.artist || 'Untitled event')}</div>
          <div class="queue-date-row">
            <span>${escapeHtml(fmtEventWhen(event))}</span>
          </div>
          ${locStr ? `<div class="queue-loc-row"><span>${escapeHtml(locStr)}</span></div>` : ''}
          ${event.company ? `<div class="queue-loc-row queue-company"><span>With ${escapeHtml(event.company)}</span></div>` : ''}
          ${eventTagsHTML(event)}
        </div>

        <div class="queue-arrow">›</div>
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
    const locationText = [nextEvent.city, nextEvent.venue].filter(Boolean).join(' · ');
    const heroImgSrc = safeImageUrl(nextEvent.image);
    // Only the bottom of the poster is darkened, so the artwork stays visible
    const heroBgStyle = heroImgSrc
      ? `background-image: linear-gradient(180deg, rgba(9, 9, 11, 0) 25%, rgba(9, 9, 11, 0.55) 55%, rgba(9, 9, 11, 0.95) 100%), url('${escapeAttr(heroImgSrc)}');`
      : '';

    spotlightSlot.innerHTML = `
      <div class="hero-spotlight-card${heroImgSrc ? '' : ' hero-no-image'}" style="${heroBgStyle}" data-view="${escapeAttr(nextEvent.id)}">
        <div class="hero-eyebrow">Next up</div>
        <div class="hero-title">${escapeHtml(nextEvent.artist || 'Next event')}</div>
        <div class="hero-when">${escapeHtml(fmtEventWhen(nextEvent))}</div>
        ${locationText ? `<div class="hero-where">${escapeHtml(locationText)}</div>` : ''}
        ${eventTagsHTML(nextEvent)}
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
    const locationText = [event.city, event.venue].filter(Boolean).join(' · ');
    const overlay = document.getElementById('eventModalOverlay');
    const content = document.getElementById('eventModalContent');

    if (!overlay || !content) {
      alert('Modal element missing');
      return;
    }

  const dayBadgeText = isPast(event) ? '' : relativeDayLabel(event);

  const ticketHTML = (() => {
    let html = '';
    if (event.ticketFile) {
      html += `<a href="${escapeAttr(event.ticketFile)}" download="${escapeAttr(event.ticketFileName || 'ticket')}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost detail-ticket-link">
          ${iconSvg('ticket')} Open attached ticket (${escapeHtml(event.ticketFileName || 'File')}) ↗
        </a>`;
    }
    if (!event.ticketInfo) return html;
    const info = event.ticketInfo.trim();
    const isUrl = /^https?:\/\//i.test(info) || /^www\./i.test(info);
    const hrefUrl = /^www\./i.test(info) ? `https://${info}` : info;
    if (isUrl) {
      html += `<a href="${escapeAttr(hrefUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost detail-ticket-link">
          ${iconSvg('ticket')} Open ticket link ↗
        </a>`;
    } else {
      html += `<div class="detail-ticket-info">
          <span class="detail-section-label">Ticket details</span>
          ${escapeHtml(info)}
        </div>`;
    }
    return html;
  })();

  content.innerHTML = `
    <div class="event-modal-header">
      <button class="modal-close" id="closeModalBtn" type="button" aria-label="Close event details">${iconSvg('close')}</button>
    </div>

    ${safeImageUrl(event.image)
      ? `<img class="event-detail-image" src="${escapeAttr(safeImageUrl(event.image))}" alt="Poster">`
      : `<div class="event-detail-placeholder" aria-label="No event photo">${iconSvg('ticket')}</div>`}

    <div class="detail-title-row">
      <h2 class="event-detail-title">${escapeHtml(event.artist || 'Untitled event')}</h2>
      ${event.ticketStatus && ticketLabel(event.ticketStatus) ? `<span class="ticket-badge ${escapeAttr(event.ticketStatus)}">${escapeHtml(ticketLabel(event.ticketStatus))}</span>` : ''}
    </div>

    ${ticketHTML ? `<div class="detail-ticket">${ticketHTML}</div>` : ''}

    <div class="detail-meta">
      <div class="detail-meta-row detail-meta-when">
        <span class="detail-meta-icon">${iconSvg('calendar')}</span>
        <span class="detail-meta-text">${escapeHtml(fmtEventWhen(event))}</span>
        ${dayBadgeText ? `<span class="day-chip${dayBadgeText === 'Today' || dayBadgeText === 'Happening now' ? ' day-chip-today' : ''}">${escapeHtml(dayBadgeText)}</span>` : ''}
      </div>

      ${locationText ? `
        <div class="detail-meta-row">
          <span class="detail-meta-icon">${iconSvg('location')}</span>
          <a href="https://maps.google.com/?q=${encodeURIComponent(locationText)}" target="_blank" rel="noopener noreferrer" class="map-link detail-map-link">${escapeHtml(locationText)} <span aria-hidden="true">↗</span></a>
        </div>
      ` : ''}

      ${event.company ? `
        <div class="detail-meta-row">
          <span class="detail-meta-icon">${iconSvg('users')}</span>
          <span class="detail-meta-text">With <strong>${escapeHtml(event.company)}</strong></span>
        </div>
      ` : ''}
    </div>

    ${event.description ? `
      <div class="detail-about">
        <div class="detail-section-label">About</div>
        <p>${escapeHtml(event.description)}</p>
      </div>
    ` : ''}

    <div class="detail-actions">
      <button class="btn btn-primary" id="gcalFromModalBtn" type="button">Add to calendar</button>
      <button class="btn btn-ghost" id="editFromModalBtn" type="button">Edit</button>
    </div>
    <button class="detail-delete" id="btnDelFromModal" type="button">Delete event</button>
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

  // Weeks start on Monday
  const firstDay = (new Date(year, month, 1).getDay() + 6) % 7;
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
      const weekColumn = (firstDay + day - 1) % 7;
      visibleEvents.forEach(event => {
        const isMultiDay = event.endDate && event.endDate !== event.startDate;
        const isStart = event.startDate === dateKey;
        const isEnd = event.endDate === dateKey;

        const pill = document.createElement('div');
        const categoryClass = event.category === 'Festival' ? 'festival'
          : (event.category === 'Other' || event.category === 'Party') ? 'other' : 'concert';
        pill.className = `cal-event-pill cal-event-${categoryClass}`;
        pill.title = event.artist || 'Event';
        pill.setAttribute('aria-label', event.artist || 'Event');

        if (isMultiDay) {
          // Multi-day events read as one bar across the days; the name shows where the bar starts
          // and again at the start of each week row
          if (!isStart) pill.classList.add('cal-event-continues-left');
          if (!isEnd) pill.classList.add('cal-event-continues-right');
          if (weekColumn === 0) pill.classList.add('cal-event-week-start');
          if (weekColumn === 6) pill.classList.add('cal-event-week-end');
          pill.textContent = isStart || weekColumn === 0 ? (event.artist || 'Event') : '';
        } else {
          pill.textContent = event.artist || 'Event';
        }

        cell.appendChild(pill);
      });

      const hiddenEventCount = dayEvents.length - visibleEvents.length;
      if (hiddenEventCount > 0) {
        const more = document.createElement('div');
        more.className = 'cal-more';
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
    title.textContent = `Events on ${fmtDate(dateStr)}`;
    const rest = state.events
      .filter(event => !isPast(event) && event.startDate)
      .filter(event => {
        if (event.endDate) return !(dateStr >= event.startDate && dateStr <= event.endDate);
        return event.startDate !== dateStr;
      })
      .sort((a, b) => a.startDate.localeCompare(b.startDate));

    let html = '';
    if (dayEvents.length) {
      html += `<div class="month-header month-header-accent">${escapeHtml(fmtDate(dateStr))}</div>`;
      html += dayEvents.map(renderQueueItem).join('');
    } else {
      html += '<div class="empty">No events this day.</div>';
    }

    if (rest.length) {
      html += '<div class="month-header month-header-spaced">Other upcoming</div>';
      html += rest.map(renderQueueItem).join('');
    }

    list.innerHTML = html || '<div class="empty">No events this month.</div>';
  } else {
    title.textContent = 'Upcoming events';
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
