import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDAyNvuiIHuFWA365E7EibRPUo0zQgGhh4",
  authDomain: "tracking-jb.firebaseapp.com",
  projectId: "tracking-jb",
  storageBucket: "tracking-jb.firebasestorage.app",
  messagingSenderId: "398937186608",
  appId: "1:398937186608:web:3ce9b3f9a3ed5bfd89e8f5",
  measurementId: "G-4S4HYPT9SC"
};

// Initialize Firebase app as singleton
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);

export { app, db };
