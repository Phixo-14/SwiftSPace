'use strict';

const functions = require('firebase-functions/v1');
const { defineSecret, defineString } = require('firebase-functions/params');

const webhookSecret = defineSecret('AUTH_DELETE_WEBHOOK_SECRET');
const backendApiUrl = defineString('BACKEND_API_URL', {
  default: 'https://swiftspace-api.onrender.com/api',
});

exports.removeDeletedFirebaseUser = functions
  .region('us-central1')
  .runWith({ failurePolicy: true, secrets: [webhookSecret], timeoutSeconds: 120 })
  .auth.user()
  .onDelete(async (user) => {
    const response = await fetch(`${backendApiUrl.value()}/auth/firebase-user-deleted`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-firebase-delete-secret': webhookSecret.value(),
      },
      body: JSON.stringify({ uid: user.uid }),
      signal: AbortSignal.timeout(90000),
    });

    if (!response.ok) {
      throw new Error(`Backend account cleanup failed with HTTP ${response.status}.`);
    }
  });