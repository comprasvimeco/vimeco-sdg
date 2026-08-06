# VIMECO — Sistema de Gestión (presupuestos y costos de obra)

## Cómo trabajamos

Este proyecto reemplaza un intento anterior (Python/FastAPI) que se abandonó: se le pasaron las
planillas de golpe y se le pidió el programa completo de una, sin verificar nada en el camino.
El resultado no fue confiable ni usable. **No se repite ese método.**

- **Una pantalla o funcionalidad por vez.** Se termina, se verifica funcionando en la app real
  (ver skill `verify`), y recién ahí se pasa a la siguiente. Nada de construir varias fases
  encadenadas sin probar las anteriores.
- **Preguntar antes de asumir reglas de negocio.** Las planillas de la empresa son la fuente de
  verdad para el cálculo, pero las decisiones de alcance y prioridad las toma el dueño del
  proyecto, no se infieren.
- Usar plan mode antes de tocar el motor de cálculo o el esquema de datos una vez que existan.
- Commit al cerrar cada pantalla/funcionalidad verificada, con el número de versión (ver abajo).

## Versión en commits

El hook `.githooks/prepare-commit-msg` inyecta automáticamente el número de versión deployada en
cada commit, leyendo `app.html` (`hdr-drop-version`) y sumando 1. Mismo mecanismo que vimeco-oc.

```
feat: descripción  →  feat: v002 descripción
```

### Si el hook no funciona (nueva clon / reinstalación)
```
git config core.hooksPath .githooks
```

### Regla de proceso para commits
1. `git pull --rebase` antes de `git commit`, para leer en `app.html` la última versión bumpeada por CI.
2. El hook se encarga del número; solo escribir la descripción en el mensaje.

## Stack y estructura

PWA estática (HTML/CSS/JS), sin build de frontend. Deploy en GitHub Pages vía GitHub Actions
(`deploy.yml`). Backend: Firebase Realtime Database, accedida por REST (sin SDK) — mismo patrón
que vimeco-oc en `js/firebase.js`.

- `build.js` — incrementa versión en `app.html`, bump del cache del service worker, inyecta
  `GEMINI_API_KEY` desde GitHub Secrets
- `js/config.js` — `FIREBASE_CONFIG` (TODO: crear el proyecto Firebase y completar valores reales)
- `sw.js` — network-first para código de la app, cache-first para assets pesados

## Dominio (a completar)

Todavía no hay reglas de negocio definidas acá. Se documentan a medida que se acuerdan con el
dueño del proyecto — no se asumen del intento anterior.
