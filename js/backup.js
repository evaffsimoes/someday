/**
 * cue — Exporting and importing backups as .json files.
 */

function bindBackupHandlers() {
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

      await shrinkEventImages(importedEvents);
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
}
