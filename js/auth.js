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
          alert(`Google Sign-In (Android Native) Error:\n${nativeErr?.message || nativeErr?.error || errStr}\n\nSe o erro for 10 ou DEVELOPER_ERROR, verifique se a SHA-1 da chave de assinatura foi adicionada na Firebase Console.`);
          return;
        }
      }
    }

    if (isNative) {
      alert('O plugin de autenticação nativa do Android não está pronto nesta compilação.');
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
    isConfigured: () => isConfigured
  };
})();
