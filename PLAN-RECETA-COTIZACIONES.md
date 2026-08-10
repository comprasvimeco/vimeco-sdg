# Plan: separar receta de precio, Cotizaciones, Cómputo rediseñado, Presupuesto

Escrito el 2026-08-10 al cierre de una sesión larga, para que otra sesión lo
retome sin necesitar el contexto completo de la conversación original. Lee
también la memoria del proyecto (`project_backlog_2026_08_10`,
`project_gastos_generales_carga_fija`, `project_carga_catalogo_general`,
`feedback_firebase_patch_por_linea`, `feedback_firebase_delete_paths`) si
está disponible — tiene decisiones y errores ya resueltos que no hace falta
repetir.

**Regla de trabajo de este proyecto (ver `CLAUDE.md`):** una pantalla o
funcionalidad por vez, verificada en la app real (skill `verify`) y
commiteada antes de pasar a la siguiente. No construir varias fases
encadenadas sin probar las anteriores. Usar plan mode antes de tocar el
motor de cálculo o el esquema de datos.

## Por qué este cambio de rumbo

Hasta ahora (`item.js`, v009-v016) un ítem de la Biblioteca guarda su Análisis
de Precio con un **costo unitario cacheado usando precios globales de
materiales** (`materiales.json`, un precio único por material). El dueño del
proyecto se dio cuenta de que esto no refleja la realidad: **cada obra va a
tener sus propios precios** de materiales y mano de obra (distintos
proveedores, distintas cotizaciones), mientras que la **receta** (qué
materiales/equipos/mano de obra lleva un ítem y en qué cantidad) sí es
reutilizable entre obras.

Decisión de fondo acordada: separar **receta** (Biblioteca, compartida) de
**precio** (por obra, vía Cotizaciones). El costo cacheado de un ítem en la
Biblioteca pasa a ser sólo una referencia con precios globales — el costo
real de usar ese ítem en una obra puntual sale de aplicar los precios de esa
obra a la misma receta.

## Orden de trabajo acordado con el dueño del proyecto

En este orden, cada uno verificado y commiteado antes de pasar al
siguiente:

1. **Biblioteca: separar receta de precio**
2. **Cómputo rediseñado** (tabla tipo pliego)
3. **Análisis de Precio visible y editable desde el Cómputo**
4. **Cotizaciones** (entidad + pantalla)
5. **Fuente en Materiales**
6. **Fuente en Ítems**
7. **Precios de materiales por obra**
8. **Presupuesto**
9. **Calculadora flotante** (selección de rangos con "+"/"++")

---

## 1. Biblioteca: separar receta de precio — ✅ Hecho (2026-08-10)

**Decisión final (más fuerte que lo previsto originalmente en este punto):**
la Biblioteca no guarda ningún costo. `item.html` (ahora "Receta") es un
editor puro de rendimiento + líneas de materiales/equipos/mano de obra, sin
ningún número calculado en pantalla. `costoUnitarioCache` se dejó de
escribir y de leer en toda la app (el campo viejo quedó huérfano en los 3
ítems que ya lo tenían, sin borrar — nadie lo lee más).

El costo se calcula en vivo con `window.calcCostoUnitarioItem()`
(`js/calcCostos.js`), a partir de la receta + rendimiento del ítem y los
precios generales — la usan `computo.js` y `carga-fija.js` (que antes leían
`costoUnitarioCache` directamente y se habrían roto si el campo
desaparecía sin más). Verificado que el cómputo de la obra "Prueba" da
exactamente el mismo costo unitario que el cache viejo tenía
(`cerco_perimetral`: $14.821,35 en ambos casos) y que el Coeficiente K de
Carga Fija se sigue calculando sobre ese costo sin problemas.

Wording: se optó por renombrar "Análisis de Precio" → **"Receta"** (título
de `item.html`, botón en `biblioteca.js`) — el nombre anterior ya no
describía bien una pantalla sin costo.

## 2. Cómputo rediseñado (tabla tipo pliego)

## 2. Cómputo rediseñado (tabla tipo pliego) — ✅ Hecho (2026-08-10)

Basado en la estructura de la hoja COMPUTO de `Planilla_Arquitectura_v2.xlsm`
(columnas CODIGO/DESCRIPCION/CANTIDAD/UNIDAD/COSTO UNITARIO/COSTO SUBTOTAL,
agrupado por rubro con subtotales) y en cómo se ve `CyP Taller Río
Cuarto.xlsx`.

**Resumen de lo implementado** (detalle completo en el historial de
`C:\Users\Usuario\.claude\plans\rippling-toasting-blanket.md` de la sesión):
tabla agrupada por rubro con subtotal por grupo y total general; rubro
renombrable por obra vía `/obras/{obraKey}/computoRubros/{rubroKey}` (path
separado de las líneas, no anidado — sin migración de datos); nombre de
línea editable vía `nombreOverride` en la línea; alta rápida de ítem desde
el buscador de la línea (`createSearchableSelect` + `onCreateNew`, mismo
patrón que la alta rápida de materiales en `item.js` v015); columna de
Unidad visible por línea (pedido explícito del dueño del proyecto durante
la verificación — antes sólo estaba en el placeholder de Cantidad, que
desaparece al tipear). `computo.js` pasó a `PATCH`/`PUT` por línea en vez
de reescribir el árbol completo (mismo criterio que `carga-fija.js`).

**Bug encontrado y corregido durante la verificación:** una línea nueva sin
ítem asignado se guardaba como `{itemKey: null, cantidad: null}` — un PUT
a Firebase con *todos* los campos en `null` no crea el nodo (Firebase trata
cada valor `null` como "borrar ese campo"), así que la línea desaparecía
silenciosamente al recargar. Se agregó `creadoEn: Date.now()` a toda línea
nueva para garantizar que el nodo se persista.

Cambios sobre `computo.html`/`js/computo.js` (histórico, previo a implementar):

- **Tabla agrupada por rubro**, con subtotal por rubro y total general (hoy
  es una lista plana sin agrupar — se decidió explícitamente no agrupar en
  la v011 porque no hacía falta todavía; ahora sí).
- **Rubro renombrable por grupo, por obra** (confirmado con el dueño del
  proyecto: "por grupo", no por línea individual) — el título del rubro que
  se ve en el Cómputo de una obra puntual se puede reescribir para calzar
  con el pliego, sin tocar el nombre del rubro en la Biblioteca. Esquema:
  algo como `/obras/{obraKey}/computo/rubroOverrides/{rubroKey}: nombre` —
  a definir el path exacto al planificar.
- **Nombre de ítem editable por línea** — cada línea de Cómputo puede
  mostrar un nombre distinto al del ítem en la Biblioteca (mismo criterio:
  reusar la misma receta técnica bajo una etiqueta distinta para el pliego).
  Esquema: agregar `nombreOverride` (nullable) a la línea de Cómputo
  (`/obras/{obraKey}/computo/{lineaKey}`).
- **Alta de ítem nuevo sin salir de Cómputo** — si el ítem que hace falta no
  existe en la Biblioteca, poder crearlo ahí mismo (nombre, unidad,
  rendimiento numérico, rubro) y que quede guardado en `/items` para la
  próxima obra — mismo patrón que ya se armó para materiales en `item.js`
  (`openQuickMaterialModal`/`saveQuickMaterial`, ver v015). La receta
  completa (líneas de materiales/equipos/MO) de ese ítem nuevo se carga
  después desde `item.html`, no hace falta meterla en el modal rápido de
  Cómputo (mismo criterio que la alta rápida de materiales, que tampoco pide
  todos los datos de golpe).
- Cómputo pasa a ser, en palabras del dueño del proyecto, "libre de armar" —
  no es sólo elegir de una lista rígida, es una herramienta para armar la
  planilla de esa obra puntual, que en la práctica va a ser distinta obra a
  obra.

**Nota técnica a no olvidar:** `computo.js` todavía guarda las líneas con un
`_fbPut` del árbol completo en algunos casos — revisar si con el rediseño
conviene pasar a `PATCH` por línea, mismo criterio que ya se aplicó en
`carga-fija.js` (ver memoria `feedback_firebase_patch_por_linea`) para
evitar perder líneas si se edita rápido.

## 3. Rendimientos por obra (ex "Análisis de Precio visible desde el Cómputo") — ✅ Hecho (2026-08-10)

La pregunta abierta original (¿editar desde Cómputo modifica el ítem global
o crea una copia?) se resolvió con un modelo más rico que las dos opciones
que se habían planteado: un ítem no tiene una sola receta, tiene **varias
versiones de Rendimiento** — la "Teórica" (la de referencia, sigue siendo
`/items/{key}` de siempre, intacta) y opcionalmente una por cada obra donde
se usó (`/items/{key}/versionesObra/{obraKey}`), cada una con su propia
receta completa (no comparten líneas) y su propio rendimiento. Objetivo:
poder comparar con el tiempo "este ítem en la obra X rindió/costó tanto, el
teórico es tanto, en la obra Y fue así".

La pantalla `item.html` pasó de llamarse "Receta" a **"Rendimientos"**
(mismo cambio en el botón de `biblioteca.js`) y ahora tiene un selector de
versiones (pestañas Teórico/obra). La versión de una obra se crea sola la
primera vez que se edita algo estando en esa pestaña (arranca como copia en
memoria de la teórica). La pestaña Teórica sigue sin mostrar costo (igual
que el punto 1); las de obra sí muestran un resumen de costo (mismo
`calcCostoUnitarioItem` de siempre) para poder comparar entre obras.

Desde cada línea de `computo.js` hay un link directo (ícono, pestaña nueva)
a `item.html?key=...&obra=...` que cae en la versión de esa obra — se
decidió no reimplementar el editor de receta dentro de Cómputo para no
duplicar lo que ya existe en `item.js`. `computo.js`/`carga-fija.js` usan la
versión propia de la obra si existe; si no, caen a la Teórica — sin cambios
para las obras que no tengan versión propia todavía.

Verificado en la app real (obra "Prueba"): la versión se creó con la receta
completa copiada, el costo se recalculó en vivo y coincidió entre
`item.html` y `computo.js`/`carga-fija.js`, y la Teórica quedó intacta.
Datos de prueba limpiados de la RTDB al terminar.

### 3b. Cómputo totalmente libre + "Análisis de Precio" como pantalla propia — ✅ Hecho (2026-08-10)

Ampliación pedida después de usar el punto 2/3 en la práctica: una línea de
Cómputo ya no necesita apuntar a un ítem de Biblioteca desde que se crea.
Pasa a tener **Rubro + Ítem + Unidad de texto libre** (sin buscador, sin
validar contra la Biblioteca) + Cantidad, con **costo $0 de base**. El
mecanismo de rubro-por-grupo del punto 2 (`computoRubros`) quedó obsoleto y
se sacó del código — el agrupamiento visual con subtotal ahora es por el
campo `rubro` de cada línea, editable ahí mismo.

El botón "Ver/editar rendimientos" pasa a llamarse **"Análisis de Precio"**
y navega en la **misma pestaña** (antes abría en una nueva): si la línea ya
tiene ítem vinculado, va al flujo del punto 3 de siempre
(`item.html?key=...&obra=...`); si no, a un modo nuevo
(`item.html?linea=...&obra=...`, sin `key`) que muestra un buscador de
ítems existentes en Biblioteca + alta rápida (con **rubro obligatorio**,
a diferencia del alta desde Biblioteca donde es opcional) — al vincular o
crear, la línea de Cómputo queda con `itemKey` y cae en el AP normal de esa
obra. `item.html` también suma costo por línea (costo unitario del
material/equipo/rol + costo total) visible en las pestañas de obra —
Teórico sigue sin mostrar ningún costo. Al crear un ítem (desde Biblioteca
o desde el AP) se abre directo su Rendimientos en vez de quedarse en la
lista.

**Migración automática:** las líneas viejas (con `itemKey` obligatorio,
`nombreOverride`, rubro heredado del ítem) se completan solas la primera
vez que se cargan (`rubro`/`nombre`/`unidad` derivados del ítem vinculado +
`computoRubros` viejo) y quedan fijas — verificado con las 5 líneas reales
que ya tenía la obra "Prueba", sin perder nada.

## 4. Cotizaciones (entidad + pantalla)

Confirmado con el dueño del proyecto: Cotizaciones es una **entidad real**
desde ahora (no texto libre), con carga **manual** (la carga con IA queda
para más adelante, no es un requisito de este paso — "Cotizaciones no tiene
por qué ser con IA nomás").

Esquema propuesto (a confirmar/ajustar al planificar):

```
/cotizaciones/{cotizacionKey}: {
  nombre,            // ej. "CyP Taller Río Cuarto", "Presupuesto Corralón Pérez", "CHANDÍAS"
  obraKey,           // nullable -- null para fuentes generales (CHANDÍAS, catálogos de referencia)
  proveedor,         // nullable
  fecha,
  tipo,              // 'manual' por ahora; 'ia' a futuro
  creadoEn
}
```

Pantalla nueva `cotizaciones.html`/`js/cotizaciones.js`, CRUD básico (mismo
patrón que `obras.js`/`materiales.js`: lista + modal alta/edición + borrado
con confirmación).

**Ya hay 2 fuentes reales para dar de alta apenas exista la pantalla:**
"CyP Taller Río Cuarto" (fuente de los 139 materiales cargados el
2026-08-10, ver memoria `project_carga_catalogo_general`) y "CHANDÍAS"
(fuente de los ítems generales pendientes de `Planilla_Arquitectura_v2.xlsm`,
ver memoria `project_gastos_generales_carga_fija`).

## 5. Fuente en Materiales

Agregar `fuenteCotizacionKey` (nullable) a `/materiales/{key}`, con un
selector tipo combobox (reusar `js/searchable-select.js`, ya armado y
verificado en v015/v016) en el modal de `materiales.html`.

**Backfill:** los 139 materiales cargados el 2026-08-10 no tienen fuente
todavía — una vez que exista la Cotización "CyP Taller Río Cuarto" (paso 4),
taggearlos a todos con esa key. Se puede hacer con un script puntual contra
la RTDB (mismo criterio que se usó para la carga inicial), no hace falta
una migración en la UI.

## 6. Fuente en Ítems

Mismo campo (`fuenteCotizacionKey`) en `/items/{key}`, mismo combobox, en el
modal de "Editar datos" de `item.html` y en el alta/edición de
`biblioteca.js`. Preparado para cuando se carguen los ítems "principales" de
Chandías (pendiente de otra ronda, ver memoria
`project_gastos_generales_carga_fija` — falta definir la conversión de
horas/unidad de la planilla a `rendimiento` uds./jornada antes de poder
cargarlos).

## 7. Precios de materiales por obra

Una Cotización asociada a una obra (`obraKey` no nulo) puede traer sus
propios precios de materiales, que **pisan el precio global sólo al
calcular costos dentro de esa obra**. Esquema propuesto:

```
/cotizaciones/{cotizacionKey}/precios/{materialKey}: { precioUSD, precioARS, precioFormula, fecha }
```

Al calcular el costo de un ítem **en el contexto de una obra puntual**
(Cómputo/Presupuesto de esa obra), para cada línea de material de la receta:
buscar si alguna Cotización asociada a esa obra tiene un precio para ese
material (la más reciente gana si hay varias) — si no hay ninguna, usar el
precio global de `/materiales/{key}`. Esto es **cálculo en vivo**, no un
valor cacheado — mismo criterio que ya usa todo el sistema (conversión de
USD a ARS en vivo con la cotización del dólar del día, cache de
`costoUnitarioCache` que se autorefresca al abrir el ítem, etc.) en vez de
guardar valores que se desactualizan.

**Importante:** sin ninguna Cotización asociada a una obra, el
comportamiento tiene que ser idéntico al de hoy (precio global) — esto es
aditivo, no debería romper nada de lo ya cargado (obras "Prueba"/"a", ítems
cerco_perimetral/platea_con_malla/zapata_corrida).

## 8. Presupuesto

El objetivo original de la sesión de hoy, todavía no construido. Con
Cómputo (costo, punto 2) y Carga Fija (coeficiente K, ya hecho en v013)
existentes: aplicar K al costo unitario (con precios de esa obra, punto 7)
de cada ítem del Cómputo para sacar el precio unitario, y totalizar
cantidad × precio. El dueño del proyecto ya vio la Carga Fija funcionando y
le pareció bien ("Ya vi la carga y me parece que funciona bien").

Este paso probablemente conviene planificarlo recién cuando 1-7 estén
resueltos, porque el "costo unitario de un ítem" que usa el Presupuesto va a
salir del nuevo mecanismo de precios por obra (punto 7), no de
`costoUnitarioCache` a secas.

## 9. Calculadora flotante (selección de rangos)

Idea ya anotada en memoria (`project_calculadora_rangos_futuro`, sesión
2026-08-07) y reconfirmada por el dueño del proyecto el 2026-08-10:

- Apretar **"+"** (fuera de una celda) abre un modo de selección de celdas
  (rango arrastrando, o clicks sueltos tipo Ctrl+click de Excel) que las va
  sumando.
- Apretar **"="** (o **"++"**, a definir cuál) abre una mini calculadora con
  el mismo sistema de selección pero permitiendo otras operaciones, no sólo
  suma.

La memoria original decía explícitamente "no implementar todavía, retomar
cuando exista Cómputo/Presupuesto" — con el Cómputo rediseñado (punto 2) y
el Presupuesto (punto 8) ya existiendo como tablas reales de celdas, este es
el momento. Diseñar como una extensión de `js/calc.js`
(`attachCalcInput`/`getCalcFormula`, ya con soporte de fórmulas persistentes
desde v016) — la selección de rango tendría que insertar algo como
`=SUMA(celda1,celda2,...)` en el campo activo y reusar el mismo motor de
`evalFormula` que ya existe, extendiéndolo para resolver referencias a otras
celdas en vez de sólo literales numéricos.

---

## Cómo arrancar la próxima sesión

1. Empezar por el punto 1 (separar receta de precio en Biblioteca — es
   sobre todo wording/UI, bajo riesgo) y usar **plan mode** antes de tocar
   nada, como pide `CLAUDE.md` para cambios de esquema/motor de cálculo.
2. Ir punto por punto en el orden de arriba, verificando en la app real
   (skill `verify`) y commiteando cada uno antes de seguir — no encadenar
   varios sin probar, es la causa de que el intento anterior de este
   proyecto (Python/FastAPI) se haya abandonado.
3. Los puntos 3 y 8 tienen preguntas de negocio abiertas marcadas arriba —
   preguntarle al dueño del proyecto antes de asumir, no inferir del código.
