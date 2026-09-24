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
        console.warn('In-app redirect result check:', err);
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

    if (code === 'auth/operation-not-allowed' || code === 'auth/configuration-not-found') {
      alert(`Firebase Auth Error [${code}]:\n\nGoogle Sign-In is not enabled yet in your Firebase project.\n\nPlease go to Firebase Console -> Authentication -> Sign-in method and click "Enable" on Google.`);
    } else if (code === 'auth/unauthorized-domain') {
      alert(`Firebase Auth Error [${code}]:\n\nThis domain (${window.location.hostname}) is not authorized.\n\nPlease go to Firebase Console -> Authentication -> Settings -> Authorized Domains and add ${window.location.hostname}.`);
    } else {
      alert(`Google Sign-In Error:\n${message}`);
    }
  }

  async function signInWithGoogle() {
    if (!isConfigured || !auth) {
      alert('Cloud Sync requires setting up your Firebase credentials in js/config.js.');
      return;
    }

    try {
      // 1. Native Capacitor Google Auth Plugin for Android App
      const isNative = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
      const GoogleAuth = (window.Capacitor && window.Capacitor.Plugins) ? window.Capacitor.Plugins.GoogleAuth : null;

      if (GoogleAuth && typeof GoogleAuth.signIn === 'function') {
        try {
          if (!isNative && typeof GoogleAuth.initialize === 'function') {
            try {
              await GoogleAuth.initialize({
                clientId: '87973671324-928p1drimqk383fofkf4n7cpcnstpsfr.apps.googleusercontent.com',
                scopes: ['profile', 'email'],
                grantOfflineAccess: true
              });
            } catch (initErr) {
              console.warn('GoogleAuth.initialize error:', initErr);
            }
          }
          const googleUser = await GoogleAuth.signIn();
          const idToken = googleUser?.authentication?.idToken || googleUser?.idToken || googleUser?.authentication?.id_token;
          if (idToken) {
            const credential = firebase.auth.GoogleAuthProvider.credential(idToken);
            const userCred = await auth.signInWithCredential(credential);
            if (userCred?.user) {
              currentUser = userCred.user;
              updateAuthUI(userCred.user);
              await syncCloudEvents();
              return;
            }
          }
        } catch (nativeErr) {
          console.warn('Native Google Auth error:', nativeErr);
        }
      }

      // 2. Standard Firebase Web Popup
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });

      const result = await auth.signInWithPopup(provider);
      if (result?.user) {
        currentUser = result.user;
        updateAuthUI(result.user);
        await syncCloudEvents();
      }
    } catch (error) {
      handleAuthError(error);
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
    const avatarImg = document.getElementById('accountAvatarImg');
    const accountStatusBadge = document.getElementById('accountStatusBadge');
    const accountUserInfo = document.getElementById('accountUserInfo');
    const accountLoginBtn = document.getElementById('accountLoginBtn');
    const accountLogoutBtn = document.getElementById('accountLogoutBtn');

    if (user) {
      if (avatarImg) {
        if (user.photoURL) {
          avatarImg.src = user.photoURL;
          avatarImg.style.display = 'block';
        } else {
          avatarImg.style.display = 'none';
        }
      }
      if (accountStatusBadge) {
        accountStatusBadge.className = 'status-badge status-synced';
        accountStatusBadge.textContent = '✓ Synced with Cloud';
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
