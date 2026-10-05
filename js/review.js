/**
 * cue — The add / edit event form.
 */

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
      if (file.type.startsWith('image/')) {
        // Ticket screenshots are compressed like posters, at a size that keeps QR codes readable
        const prepared = await prepareImage(file);
        editedTicketFile = `data:${prepared.mediaType};base64,${prepared.base64}`;
      } else {
        if (file.size > 1.5 * 1024 * 1024) {
          alert('Ticket file is too large. Please use a PDF under 1.5 MB, or a screenshot of the ticket.');
          ticketFileInput.value = '';
          return;
        }
        const base64 = await fileToBase64(file);
        editedTicketFile = `data:${file.type || 'application/pdf'};base64,${base64}`;
      }
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
        image: await shrinkImageDataUrl(editedImage),
        updatedAt: Date.now()
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
