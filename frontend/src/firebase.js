import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const hasPlaceholder = (value) => !value || value.startsWith('your-');

export const firebaseConfigured = Object.values(config).every((value) => !hasPlaceholder(value));
export const firebaseAuth = firebaseConfigured ? getAuth(initializeApp(config)) : null;