/**
 * cue — Firebase Configuration for Google Sign-In & Cloud Sync
 * 
 * Instructions to enable Cloud Sync & Google Login:
 * 1. Go to Firebase Console: https://console.firebase.google.com/
 * 2. Create a new project (or select an existing one).
 * 3. Go to Authentication -> Sign-in method -> Enable "Google".
 * 4. Go to Firestore Database -> Create database (in production mode).
 * 5. Go to Project Settings -> Add Web App to get your config credentials.
 * 6. Replace the placeholder values below with your credentials.
 */

window.CUE_FIREBASE_CONFIG = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};
