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

## Deshacer (Ctrl+Z)

`js/undo.js` es el motor, y engancha en el único lugar por el que la app escribe: las tres
funciones de `js/firebase.js` le avisan qué van a tocar antes de tocarlo. Por eso el undo cubre
las 21 pantallas sin que ninguna sepa que existe — mismo argumento que el login en `js/auth.js`.

- Todo cambio se guarda como "este path valía X y pasó a valer Y". Deshacer escribe X, rehacer
  escribe Y, y aplicar un valor es PUT si hay algo o DELETE si es null.
- **Los snapshots son siempre del nodo entero**, nunca campo por campo: un PUT borra los hijos
  anidados que no vengan en el body, así que restaurar con media foto sería perder datos en el
  propio undo. Por lo mismo el inverso de un PATCH son PUT por sub-path, no un PATCH inverso
  (un PATCH mergea y dejaría vivo lo que el cambio original agregó adentro).
- **Un gesto, un Ctrl+Z.** Las escrituras se agrupan por acto del usuario: mover una línea son
  dos PATCH y una fórmula viva recalcula en cascada, pero se deshacen juntas.
- La pila vive en memoria y en la pestaña: al recargar o cambiar de pantalla arranca vacía.
- Antes de revertir se controla que nadie haya tocado el dato en el medio. Si otro lo cambió,
  no se pisa y se avisa.

### Al agregar una pantalla o una operación nueva

- Si la pantalla **no** escucha en tiempo real (`_fbListen`), registrá su recarga al final del
  archivo: `window.registrarRecargaUndo(loadAll)`. Si escucha, dejá que el listener pinte el
  cambio aunque haya foco en la tabla — se pregunta con `window.undoRecienAplicado()`.
- Escrituras que no son un acto del usuario (migraciones, sembrados, el candado de modo lectura)
  van dentro de `window.undoOmitir(() => ...)`, para que no queden como un paso deshacible.
- Operaciones que escriben muchas veces se envuelven en `window.undoAgrupar(etiqueta, raices, fn)`.
  Con `raices` saca una foto de esos nodos, que es barato pero **sólo sirve para nodos de esta
  obra y de esta operación**: reponer la foto de un nodo compartido (`/materiales`) borraría lo
  que otro agregó ahí mientras tanto. Para esos casos va `null` como raíces, y cada escritura se
  anota por separado.
- Las versiones vacías de esa API están en `js/ui.js`, así una pantalla puede llamarlas sin
  preguntar si el undo está cargado. `js/undo.js` las pisa, y por eso va siempre después.

## Acceso (login con Google)

El sitio es público — GitHub Pages no puede no serlo fuera de Enterprise Cloud. Lo que está
protegido son los datos: las reglas de la RTDB exigen cuenta de Google autenticada y presente en
la allowlist.

- `js/auth.js` es el portero. `_authToken()` **no resuelve hasta que Firebase confirmó si hay
  sesión**: como las pantallas llaman a `_fbGet` apenas cargan, quedan esperando solas. Por eso
  ninguna de las 19 pantallas necesita saber que el login existe.
- `js/firebase.js` cuelga ese token como `?auth=` en las cuatro funciones que hablan con la base.
  Son el único camino a la RTDB: autenticar ahí autentica la app entera.
- El SDK de Firebase entra **sólo para Auth** (`js/vendor/firebase-*-compat.js`, v12.18.0 pineada),
  por el refresco del token y la persistencia de sesión. Los datos siguen por REST, sin SDK.
- `database.rules.json` es la copia versionada de las reglas. La que manda es la de la consola de
  Firebase: si se cambia una, cambiar la otra.

### Quién entra

Dos caminos, alcanza con uno:

1. **Mail `@vimeco.com.ar`** — entra solo, sin carga previa. El alta y la baja las maneja el
   dominio de la empresa: si se desactiva la cuenta ahí, deja de poder entrar.
2. **Estar en `/usuarios` con `activo: true`** — para cuentas de afuera del dominio (las
   `@gmail.com` del equipo, un externo puntual).

Y un portazo que gana sobre los dos: `/usuarios/{mail}/activo: false` bloquea a esa cuenta aunque
sea del dominio, sin tener que tocar su cuenta de la empresa.

La lógica está escrita dos veces y **las dos tienen que coincidir**: `database.rules.json` (la que
manda) y `_authAutorizado()` en `js/auth.js` (sólo para dar un mensaje claro en el login).

### Dar o sacar acceso a alguien

A mano, en la consola de Firebase → Realtime Database → `/usuarios`. La key es el mail en
minúsculas con los puntos cambiados por comas (las keys de RTDB no admiten puntos):

```
/usuarios/alguien@gmail,com
    activo: true          ← false saca el acceso al instante, también a los del dominio
    rol:    "admin"       ← guardado desde el día uno; todavía no se usa
    alta:   "2026-08-21"
```

No hay pantalla de administración de usuarios a propósito: `/usuarios` es de sólo lectura para la
app, así una cuenta comprometida no puede darse permisos a sí misma.

## Dominio (a completar)

Todavía no hay reglas de negocio definidas acá. Se documentan a medida que se acuerdan con el
dueño del proyecto — no se asumen del intento anterior.
