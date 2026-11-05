// firebase.js — configuração e conexão com o Firebase (movida do app.js sem alteração).
// Importe este arquivo APENAS uma vez, a partir do app.js (iniciar o Firebase duas vezes dá erro).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, collection, getDocs, doc, writeBatch, addDoc, runTransaction, serverTimestamp, deleteDoc, updateDoc, arrayUnion, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// Configuração do aplicativo web FayDai-Estoque.
const firebaseConfig = {
  apiKey: "AIzaSyDQw-x8-GUxkS41pAiOYwJjawgnMvxyuYk",
  authDomain: "faydai-estoque.firebaseapp.com",
  projectId: "faydai-estoque",
  storageBucket: "faydai-estoque.firebasestorage.app",
  messagingSenderId: "703117192541",
  appId: "1:703117192541:web:3eeeba198d137eee440cb4",
  measurementId: "G-W6ET4LEQHM"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };
export { signInWithEmailAndPassword, onAuthStateChanged, signOut, collection, getDocs, doc, writeBatch, addDoc, runTransaction, serverTimestamp, deleteDoc, updateDoc, arrayUnion, query, where, orderBy, limit };
