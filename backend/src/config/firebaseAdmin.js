const admin = require('firebase-admin');

function getFirebaseAdmin() {
  const hasServiceAccount = process.env.FIREBASE_PROJECT_ID
    && process.env.FIREBASE_CLIENT_EMAIL
    && process.env.FIREBASE_PRIVATE_KEY
    && !process.env.FIREBASE_PROJECT_ID.startsWith('your-')
    && !process.env.FIREBASE_CLIENT_EMAIL.startsWith('your-')
    && !process.env.FIREBASE_PRIVATE_KEY.startsWith('your-');

  if (!hasServiceAccount) {
    return null;
  }

  if (!admin.apps.length) {
    try {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      });
    } catch (error) {
      console.error(`Firebase Admin initialization failed: ${error.message}`);
      return null;
    }
  }

  return admin;
}

module.exports = getFirebaseAdmin;
