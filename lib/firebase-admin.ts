// Firebase Admin SDK singleton
// Initialized once and safely reused across Vercel serverless invocations

import { initializeApp, getApps, cert, App } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";

let app: App;
let db: Firestore;

function getAdminApp(): App {
  if (getApps().length === 0) {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

    if (
      !process.env.FIREBASE_PROJECT_ID ||
      !process.env.FIREBASE_CLIENT_EMAIL ||
      !privateKey
    ) {
      throw new Error(
        "Missing Firebase Admin environment variables: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY"
      );
    }

    app = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey,
      }),
    });
  } else {
    app = getApps()[0];
  }
  return app;
}

export function getAdminDb(): Firestore {
  if (!db) {
    getAdminApp();
    db = getFirestore();
  }
  return db;
}
