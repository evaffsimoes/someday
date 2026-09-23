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
        firebase.initializeApp(config);
      }
      auth = firebase.auth();
      db = firebase.firestore();
      isConfigured = true;

      // Enable offline persistence for Firestore if supported
      db.enablePersistence({ synchronizeTabs: true }).catch(() => {
        // Ignore persistence errors in unsupported environments
      });

      auth.onAuthStateChanged(async user => {
        currentUser = user;
        updateAuthUI(user);
        if (user) {
          await syncCloudEvents();
        }
      });
    } catch (err) {
      console.warn('cue Cloud Sync initialization error:', err);
    }
  }

  async function signInWithGoogle() {
    if (!isConfigured || !auth) {
      alert('Cloud Sync requires setting up your Firebase credentials in js/config.js.');
      return;
    }

    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await auth.signInWithPopup(provider);
    } catch (error) {
      if (error.code === 'auth/popup-blocked' || error.code === 'auth/operation-not-supported-in-this-environment') {
        try {
          const provider = new firebase.auth.GoogleAuthProvider();
          await auth.signInWithRedirect(provider);
        } catch (redirectErr) {
          console.error('Google login redirect failed:', redirectErr);
          alert('Login failed: ' + redirectErr.message);
        }
      } else if (error.code !== 'auth/popup-closed-by-user') {
        console.error('Google login failed:', error);
        alert('Login failed: ' + error.message);
      }
    }
  }

  async function signOutUser() {
    if (!auth) return;
    try {
      await auth.signOut();
      currentUser = null;
      updateAuthUI(null);
    } catch (err) {
      console.error('Sign out error:', err);
    }
  }

  async function syncCloudEvents() {
    if (!currentUser || !db) return;
    try {
      const userRef = db.collection('users').doc(currentUser.uid);
      const doc = await userRef.get();

      let cloudEvents = [];
      if (doc.exists && Array.isArray(doc.data().events)) {
        cloudEvents = doc.data().events;
      }

      // Merge local events and cloud events
      if (window.cueAppState && Array.isArray(window.cueAppState.events)) {
        const merged = dedupeEvents([...cloudEvents, ...window.cueAppState.events]);
        window.cueAppState.events = merged;

        // Save merged events locally and in cloud
        if (typeof window.cueSaveEvents === 'function') {
          await window.cueSaveEvents(true); // skip cloud loop to avoid recursion
        }

        await userRef.set({
          events: merged,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          email: currentUser.email,
          displayName: currentUser.displayName
        }, { merge: true });

        if (typeof window.cueRenderApp === 'function') {
          window.cueRenderApp();
        }
      }
    } catch (err) {
      console.error('Cloud events sync failed:', err);
    }
  }

  async function saveEventToCloud() {
    if (!currentUser || !db) return;
    try {
      const userRef = db.collection('users').doc(currentUser.uid);
      await userRef.set({
        events: window.cueAppState?.events || [],
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        email: currentUser.email,
        displayName: currentUser.displayName
      }, { merge: true });
    } catch (err) {
      console.error('Failed saving event to cloud:', err);
    }
  }

  function updateAuthUI(user) {
    const avatarBtn = document.getElementById('accountBtn');
    const avatarImg = document.getElementById('accountAvatarImg');
    const accountStatusBadge = document.getElementById('accountStatusBadge');
    const accountUserInfo = document.getElementById('accountUserInfo');
    const accountLoginBtn = document.getElementById('accountLoginBtn');
    const accountLogoutBtn = document.getElementById('accountLogoutBtn');

    if (!avatarBtn) return;

    if (user) {
      if (user.photoURL && avatarImg) {
        avatarImg.src = user.photoURL;
        avatarImg.style.display = 'block';
      }
      if (accountStatusBadge) {
        accountStatusBadge.className = 'status-badge status-synced';
        accountStatusBadge.textContent = 'Synced with Cloud';
      }
      if (accountUserInfo) {
        accountUserInfo.innerHTML = `
          <div class="user-name">${escapeHtml(user.displayName || 'User')}</div>
          <div class="user-email">${escapeHtml(user.email || '')}</div>
        `;
        accountUserInfo.style.display = 'block';
      }
      if (accountLoginBtn) accountLoginBtn.style.display = 'none';
      if (accountLogoutBtn) accountLogoutBtn.style.display = 'inline-flex';
    } else {
      if (avatarImg) {
        avatarImg.style.display = 'none';
      }
      if (accountStatusBadge) {
        accountStatusBadge.className = 'status-badge status-local';
        accountStatusBadge.textContent = isConfigured ? 'Not signed in (Local Storage)' : 'Local Storage Mode';
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
    isConfigured: () => isConfigured
  };
})();
