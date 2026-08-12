// Clave de API de Google Gemini (inyectada por build.js desde GitHub Secrets)
const GEMINI_API_KEY = "%%GEMINI_API_KEY%%";

// Cloudinary — subida de archivos (Cotizaciones) directo desde el navegador,
// vía upload preset "unsigned" (no requiere firma ni secreto, se puede dejar
// en texto plano acá). Completar tras crear la cuenta free en cloudinary.com.
const CLOUDINARY_CLOUD_NAME    = "o9pxufbw";
const CLOUDINARY_UPLOAD_PRESET = "s9klsnsy";

// Configuración de Firebase
var FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDZvB1KGgM9TZyVifLoH0xMNs-v1f6ITTg",
  authDomain:        "vimeco-sdg.firebaseapp.com",
  databaseURL:       "https://vimeco-sdg-default-rtdb.firebaseio.com",
  projectId:         "vimeco-sdg",
  storageBucket:     "vimeco-sdg.firebasestorage.app",
  messagingSenderId: "268046088340",
  appId:             "1:268046088340:web:8ac5820db702458d1d5c81"
};
