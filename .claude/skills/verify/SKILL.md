---
name: verify
description: Cómo verificar cambios del Sistema de Gestión VIMECO en la app real (PWA estática + Firebase RTDB)
---

# Verificar VIMECO Sistema de Gestión

PWA estática sin build para dev: servir el repo y abrir las páginas con un navegador.

## Servir

```bash
npx http-server -p 8123 -c-1 --silent   # en la raíz del repo, en background
```

## Manejar con Playwright (headless)

- `npm i playwright` en el scratchpad + `npx playwright install chromium`.
- Contexto con `serviceWorkers: 'block'` (evita que el SW cachee).
- **Firebase**: mientras `js/config.js` tenga los valores `TODO`, no hay backend real conectado —
  las funciones de `js/firebase.js` van a fallar. No inventar datos de prueba en el código de la
  app: si hace falta mockear para probar una pantalla, mockear a nivel de fetch en el test, no en
  el código fuente.
- Cuando exista un proyecto Firebase real: recordar que va a ser producción desde el día uno (no
  hay entorno de staging separado, como en vimeco-oc). GET son seguros; no clickear acciones que
  escriban salvo que se quiera escribir de verdad.

## Regla de esta app

Cada pantalla nueva se verifica acá (cargar en el navegador, click a través del flujo real) antes
de darla por terminada y pasar a la siguiente. No alcanza con que el código "se vea bien".
