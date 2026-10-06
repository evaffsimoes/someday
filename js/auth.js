/**
 * cue — Auth & Cloud Sync Module (Firebase Auth + Firestore)
 */

window.CueAuth = (() => {
  let db = null;
  let auth = null;
  let currentUser = null;
  let isConfigured = false;

  function init() {
    const config = window.CUE_FIREBASE_CONFIG;
    if (
      !config ||
      !config.apiKey ||
      config.apiKey === 'YOUR_FIREBASE_API_KEY' ||
      typeof firebase === 'undefined'
    ) {
      console.log('cue Cloud Sync: Firebase credentials not configured or SDK missing. Operating in offline/local storage mode.');
      updateAuthUI(null);
      return;
    }

    try {
      if (!firebase.apps.length) {
        // Sanitize config for web JS SDK (strip android appId if present)
        const appConfig = {
          apiKey: config.apiKey,
          authDomain: config.authDomain,
          databaseURL: config.databaseURL,
          projectId: config.projectId,
          storageBucket: config.storageBucket
        };
        if (config.appId && config.appId.includes(':web:')) {
          appConfig.appId = config.appId;
        }
        firebase.initializeApp(appConfig);
      }
      auth = firebase.auth();
      db = firebase.firestore();
      // Some Android WebViews block Firestore's default streaming connection and every read then
      // fails as "client is offline"; let the SDK fall back to long polling when that happens
      db.settings({ experimentalAutoDetectLongPolling: true, merge: true });
      isConfigured = true;

      // Retry the initial sync once the connection comes back
      window.addEventListener('online', () => {
        if (currentUser) syncCloudEvents();
      });

      // Enable offline persistence for Firestore if supported
      db.enablePersistence({ synchronizeTabs: true }).catch(() => {
        // Ignore persistence errors in unsupported environments
      });

      auth.useDeviceLanguage();
      auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});

      auth.onAuthStateChanged(async user => {
        currentUser = user;
        updateAuthUI(user);
        if (user) {
          await syncCloudEvents();
        }
      });

      auth.getRedirectResult().then(async result => {
        if (result && result.user) {
          currentUser = result.user;
          updateAuthUI(result.user);
          await syncCloudEvents();
        }
      }).catch(err => {
        if (err.code !== 'auth/popup-closed-by-user') {
          handleAuthError(err);
        }
      });
    } catch (err) {
      console.warn('cue Cloud Sync initialization error:', err);
    }
  }

  function handleAuthError(error) {
    if (!error) return;
    const code = error.code || '';
    const message = error.message || String(error);

    // Ignore harmless popup closed, cancelled, or storage partitioning errors
    if (
      code === 'auth/popup-closed-by-user' ||
      code === 'auth/cancelled-popup-request' ||
      message.includes('missing initial state') ||
      message.includes('sessionStorage')
    ) {
      console.warn('Auth popup closed or state reset:', message);
      return;
    }

    if (code === 'auth/api-key-not-valid') {
      alert(`Firebase Auth Error [auth/api-key-not-valid]:\n\nYour API key is not valid for Firebase Authentication.\n\nTo fix this in Firebase Console:\n1. Open https://console.firebase.google.com/u/0/project/cue-events-21ac9/settings/general/\n2. Check your Web App API Key.\n3. Ensure "Google Sign-In" is enabled under Authentication -> Sign-in method.`);
    } else if (code === 'auth/operation-not-allowed' || code === 'auth/configuration-not-found') {
      alert(`Firebase Auth Error [${code}]:\n\nGoogle Sign-In is not enabled yet in your Firebase project.\n\nPlease go to Firebase Console -> Authentication -> Sign-in method and click "Enable" on Google.`);
    } else if (code === 'auth/unauthorized-domain') {
      alert(`Firebase Auth Error [${code}]:\n\nThis domain (${window.location.hostname}) is not authorized.\n\nPlease go to Firebase Console -> Authentication -> Settings -> Authorized Domains and add ${window.location.hostname}.`);
    } else {
      alert(`Google Sign-In Error:\n${message}`);
    }
  }

  const GOOGLE_CLIENT_ID = '149306620761-0p7493812f2oirsg37u95o5cfqvf42tg.apps.googleusercontent.com';

  async function signInWithGoogle() {
    if (!auth) {
      alert('Firebase Auth is not initialized or credentials are missing.');
      return;
    }

    const isNative = window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform();
    const GoogleAuthPlugin = window.Capacitor?.Plugins?.GoogleAuth || window.plugins?.GoogleAuth;

    // 1. Native Capacitor GoogleAuth plugin (opens native Android account picker)
    if (GoogleAuthPlugin && typeof GoogleAuthPlugin.signIn === 'function') {
      try {
        if (typeof GoogleAuthPlugin.initialize === 'function') {
          try {
            await GoogleAuthPlugin.initialize({
              clientId: GOOGLE_CLIENT_ID,
              scopes: ['profile', 'email'],
              grantOfflineAccess: true
            });
          } catch (initErr) {
            console.warn('GoogleAuth initialize warning:', initErr);
          }
        }
        const gUser = await GoogleAuthPlugin.signIn();
        const idToken = gUser?.authentication?.idToken || gUser?.idToken;

        if (idToken) {
          const credential = firebase.auth.GoogleAuthProvider.credential(idToken);
          const userCred = await auth.signInWithCredential(credential);
          currentUser = userCred.user;
          updateAuthUI(userCred.user);
          await syncCloudEvents();
          return;
        }
      } catch (nativeErr) {
        console.error('Native GoogleAuth plugin error:', nativeErr);
        const errStr = JSON.stringify(nativeErr) || String(nativeErr);
        if (isNative) {
          // Do NOT redirect the WebView on native app, present useful diagnosis instead
          alert(`Google Sign-In (Android Native) Error:\n${nativeErr?.message || nativeErr?.error || errStr}\n\nIf the error code is 10 or DEVELOPER_ERROR, verify that the SHA-1 signing key fingerprint is added to your Firebase Console.`);
          return;
        }
      }
    }

    if (isNative) {
      alert('Android native authentication plugin is not ready in this build.');
      return;
    }

    // 2. Google Identity Services (GIS) Web SDK (only for browser)
    if (window.google && window.google.accounts && window.google.accounts.id) {
      try {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: async (response) => {
            if (response && response.credential) {
              try {
                const credential = firebase.auth.GoogleAuthProvider.credential(response.credential);
                const userCred = await auth.signInWithCredential(credential);
                currentUser = userCred.user;
                updateAuthUI(userCred.user);
                await syncCloudEvents();
              } catch (err) {
                handleAuthError(err);
              }
            }
          }
        });

        window.google.accounts.id.prompt(notification => {
          if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
            fallbackGoogleSignIn();
          }
        });
        return;
      } catch (gisErr) {
        console.warn('GIS Auth error, trying fallback:', gisErr);
      }
    }

    await fallbackGoogleSignIn();
  }

  async function fallbackGoogleSignIn() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope('profile');
    provider.addScope('email');

    try {
      const result = await auth.signInWithPopup(provider);
      if (result && result.user) {
        currentUser = result.user;
        updateAuthUI(result.user);
        await syncCloudEvents();
      }
    } catch (popupErr) {
      if (popupErr.code === 'auth/popup-closed-by-user' || popupErr.code === 'auth/cancelled-popup-request') {
        return;
      }
      try {
        await auth.signInWithRedirect(provider);
      } catch (redirectErr) {
        handleAuthError(redirectErr);
      }
    }
  }

  function signOutUser() {
    currentUser = null;
    updateAuthUI(null);

    // Keep existing local events intact so user never loses their agenda
    if (typeof window.cueRenderApp === 'function') {
      try { window.cueRenderApp(); } catch (_) {}
    }

    // Fire-and-forget background native GoogleAuth signout
    setTimeout(() => {
      try {
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.GoogleAuth) {
          window.Capacitor.Plugins.GoogleAuth.signOut().catch(() => {});
        }
      } catch (_) {}
      try {
        if (auth) auth.signOut().catch(() => {});
      } catch (_) {}
    }, 10);
  }

  /*
   * Cloud layout (a Firestore document is limited to 1 MB):
   *   users/{uid}                 -> { events: [...] } text fields only
   *   users/{uid}/media/{eventId} -> { image, ticketFile, ticketFileName }
   */
  const TRANSIENT_SYNC_ERRORS = ['unavailable', 'deadline-exceeded', 'resource-exhausted'];
  let syncRetries = 0;
  const MEDIA_SYNCED_KEY = 'cue-media-synced-v1';
  const MAX_MEDIA_DOC_CHARS = 900 * 1024;
  const shownSyncWarnings = new Set();

  function warnSyncOnce(kind, message, err) {
    console.error(`Cloud sync (${kind}) failed:`, err);
    if (shownSyncWarnings.has(kind)) return;
    shownSyncWarnings.add(kind);
    if (typeof window.cueToast === 'function') window.cueToast(message);
  }

  function withoutMedia(event) {
    const { image, ticketFile, ...rest } = event;
    return rest;
  }

  function hashString(value) {
    let hash = 0;
    for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0;
    return `${value.length}:${hash}`;
  }

  function mediaSignature(event) {
    if (!event.image && !event.ticketFile) return '';
    return `${hashString(event.image || '')}|${hashString(event.ticketFile || '')}`;
  }

  function loadSyncedMedia() {
    try {
      return JSON.parse(localStorage.getItem(`${MEDIA_SYNCED_KEY}-${currentUser.uid}`) || '{}');
    } catch (_) {
      return {};
    }
  }

  function storeSyncedMedia(synced) {
    try {
      localStorage.setItem(`${MEDIA_SYNCED_KEY}-${currentUser.uid}`, JSON.stringify(synced));
    } catch (_) {}
  }

  // Same event on both sides: the most recently edited copy wins (local wins ties).
  // Returns the merged list and the ids whose cloud copy was taken.
  function mergeEvents(localEvents, cloudEvents) {
    const cloudById = new Map(cloudEvents.filter(event => event && event.id).map(event => [event.id, event]));
    const localIds = new Set();
    const fromCloud = new Set();

    const merged = localEvents.map(event => {
      localIds.add(event.id);
      const cloud = cloudById.get(event.id);
      if (cloud && (cloud.updatedAt || 0) > (event.updatedAt || 0)) {
        fromCloud.add(event.id);
        return { ...cloud, image: cloud.image || event.image, ticketFile: cloud.ticketFile || event.ticketFile };
      }
      return event;
    });
    cloudEvents.forEach(event => {
      if (event && !localIds.has(event.id)) {
        fromCloud.add(event.id);
        merged.push(event);
      }
    });

    const deduped = typeof window.cueDedupeEvents === 'function' ? window.cueDedupeEvents(merged) : merged;
    return { merged: deduped, fromCloud };
  }

  async function syncCloudEvents() {
    if (!currentUser || !db || !window.cueAppState) return;
    const userRef = db.collection('users').doc(currentUser.uid);

    let cloudEvents = [];
    try {
      const doc = await userRef.get();
      if (doc.exists && Array.isArray(doc.data().events)) cloudEvents = doc.data().events;
      syncRetries = 0;
    } catch (err) {
      // Network hiccups at start-up are common on phones: retry quietly before warning
      if (TRANSIENT_SYNC_ERRORS.includes(err.code) && syncRetries < 3) {
        syncRetries++;
        setTimeout(syncCloudEvents, 3000 * syncRetries);
        return;
      }
      warnSyncOnce('read', `Couldn't load your events from the cloud (${err.code || 'unknown error'}). They're still saved on this device.`, err);
      return;
    }

    const media = new Map();
    try {
      const snapshot = await userRef.collection('media').get();
      snapshot.forEach(doc => media.set(doc.id, doc.data()));
    } catch (err) {
      warnSyncOnce('media', 'Event images couldn\'t be synced to the cloud.', err);
    }

    const { merged, fromCloud } = mergeEvents(window.cueAppState.events, cloudEvents);
    const synced = loadSyncedMedia();
    merged.forEach(event => {
      const cloudMedia = media.get(event.id);
      if (!cloudMedia) return;
      // Cloud media replaces local media when the cloud copy of the event was newer; otherwise it only fills gaps
      const preferCloud = fromCloud.has(event.id);
      if (cloudMedia.image && (preferCloud || !event.image)) event.image = cloudMedia.image;
      if (cloudMedia.ticketFile && (preferCloud || !event.ticketFile)) {
        event.ticketFile = cloudMedia.ticketFile;
        event.ticketFileName = cloudMedia.ticketFileName || event.ticketFileName || '';
      }
      // Remember what the cloud holds so unchanged media is not uploaded again
      synced[event.id] = mediaSignature(cloudMedia);
    });
    storeSyncedMedia(synced);

    // Old cloud data may still hold full-size posters
    if (typeof window.cueShrinkEventImages === 'function') await window.cueShrinkEventImages(merged);

    window.cueAppState.events = merged;
    if (typeof window.cueSaveEvents === 'function') await window.cueSaveEvents(true);
    if (typeof window.cueRenderApp === 'function') window.cueRenderApp();

    await saveEventToCloud();
  }

  async function saveEventToCloud() {
    if (!currentUser || !db) return;
    const events = window.cueAppState?.events || [];
    const userRef = db.collection('users').doc(currentUser.uid);

    try {
      await userRef.set({
        events: events.map(withoutMedia),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        email: currentUser.email,
        displayName: currentUser.displayName
      }, { merge: true });
    } catch (err) {
      warnSyncOnce('events', 'Couldn\'t sync your events to the cloud. They\'re still saved on this device.', err);
      return;
    }

    await syncMedia(userRef, events);
  }

  // Uploads only the images/tickets that changed since the last sync, and removes deleted ones
  async function syncMedia(userRef, events) {
    const synced = loadSyncedMedia();
    const currentIds = new Set();
    const writes = [];

    events.forEach(event => {
      if (!event.id) return;
      currentIds.add(event.id);
      const signature = mediaSignature(event);
      if ((synced[event.id] || '') === signature) return;

      if (!signature) {
        writes.push({ id: event.id, signature, run: () => userRef.collection('media').doc(event.id).delete() });
        return;
      }

      const data = { image: event.image || '', ticketFile: event.ticketFile || '', ticketFileName: event.ticketFileName || '' };
      if (data.image.length + data.ticketFile.length > MAX_MEDIA_DOC_CHARS) {
        // Ticket too big for a cloud document: it stays on this device only
        data.ticketFile = '';
        data.ticketFileName = '';
        warnSyncOnce('ticket-size', 'A ticket file is too large to sync and is only saved on this device.', null);
      }
      writes.push({ id: event.id, signature, run: () => userRef.collection('media').doc(event.id).set(data) });
    });

    Object.keys(synced).forEach(id => {
      if (!currentIds.has(id)) {
        writes.push({ id, signature: null, run: () => userRef.collection('media').doc(id).delete() });
      }
    });

    for (const write of writes) {
      try {
        await write.run();
        if (write.signature === null || write.signature === '') delete synced[write.id];
        else synced[write.id] = write.signature;
      } catch (err) {
        warnSyncOnce('media', 'Event images couldn\'t be synced to the cloud.', err);
        break;
      }
    }
    storeSyncedMedia(synced);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function updateAuthUI(user) {
    const avatarImg = document.getElementById('accountAvatarImg');
    const accountStatusBadge = document.getElementById('accountStatusBadge');
    const accountSubText = document.getElementById('accountSubText');
    const accountUserInfo = document.getElementById('accountUserInfo');
    const accountUserName = document.getElementById('accountUserName');
    const accountLoginBtn = document.getElementById('accountLoginBtn');
    const accountLogoutBtn = document.getElementById('accountLogoutBtn');

    if (accountStatusBadge) {
      accountStatusBadge.style.display = 'none'; // Remove "synced with cloud" badge as requested
    }

    if (user) {
      if (avatarImg) {
        if (user.photoURL) {
          avatarImg.src = user.photoURL;
          avatarImg.style.display = 'block';
        } else {
          avatarImg.style.display = 'none';
        }
      }
      if (accountSubText) {
        accountSubText.textContent = 'Your events are automatically synced across devices.';
      }
      if (accountUserName) {
        accountUserName.textContent = user.displayName || 'Signed in';
      }
      if (accountUserInfo) {
        accountUserInfo.style.display = 'block';
      }
      if (accountLoginBtn) accountLoginBtn.style.display = 'none';
      if (accountLogoutBtn) accountLogoutBtn.style.display = 'inline-flex';
    } else {
      if (avatarImg) {
        avatarImg.style.display = 'none';
      }
      if (accountSubText) {
        accountSubText.textContent = 'Sign in with Google to sync your events across devices.';
      }
      if (accountUserInfo) {
        accountUserInfo.style.display = 'none';
      }
      if (accountLoginBtn) accountLoginBtn.style.display = isConfigured ? 'inline-flex' : 'block';
      if (accountLogoutBtn) accountLogoutBtn.style.display = 'none';
    }
  }

  return {
    init,
    signInWithGoogle,
    signOutUser,
    syncCloudEvents,
    saveEventToCloud,
    getUser: () => currentUser,
    // Waits for the saved session to be restored (e.g. when a post is shared right as the app opens)
    getIdToken: async () => {
      if (!auth) return null;
      const user = currentUser || await new Promise(resolve => {
        const unsubscribe = auth.onAuthStateChanged(restored => {
          unsubscribe();
          resolve(restored);
        });
      });
      return user ? user.getIdToken() : null;
    },
    isConfigured: () => isConfigured
  };
})();
