import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { config } from './config.js';

const credential = process.env.GOOGLE_APPLICATION_CREDENTIALS
  ? applicationDefault()
  : cert({
    projectId: config.firebaseProjectId,
    clientEmail: config.firebaseClientEmail,
    privateKey: config.firebasePrivateKey,
  });

const app = getApps()[0] || initializeApp({
  credential,
  projectId: config.firebaseProjectId,
});

export const firebaseAuth = getAuth(app);
export const firestore = getFirestore(app);
