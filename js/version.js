/* VIMECO S.A. — Número de versión deployada, legible desde cualquier pantalla.
   Lo bumpea build.js en el mismo paso que el del drawer de app.html, para que
   los dos digan siempre lo mismo. Lo usa el cierre de un presupuesto
   (js/cierreDatos.js), que guarda con qué versión se calculó: si algún día una
   fórmula cambia, eso es lo que dice contra qué motor se había cerrado. */
window.APP_VERSION = 'v203';
