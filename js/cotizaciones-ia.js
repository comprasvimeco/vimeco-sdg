/* VIMECO S.A. — Sistema de Gestión — Cotizaciones (extracción con IA)
   Sobre un presupuesto de proveedor YA guardado en la carpeta de la obra:
   leerlo con IA, revisar/corregir materiales y precios detectados (o
   cargarlos a mano), y aplicarlos a /materiales/{key}/precios/{obraKey}.
   La subida del archivo y el listado viven en cotizaciones-obra.js, que
   además declara el `$` que este archivo NO redeclara — ambos corren en el
   mismo scope global. */

(function () {
  // La latencia real de Gemini varía bastante (se vieron casos legítimos de
  // 5s a 40s en pruebas) — 90s da margen sin dejarlo colgado indefinidamente.
  const GEMINI_TIMEOUT_MS = 90000;

  // Modelo multimodal vigente a agosto 2026. Se usa la variante "flash-lite"
  // (no "gemini-3.5-flash" a secas) a propósito: el tier free de
  // gemini-3.5-flash tiene sólo 20 requests/día (se agotó en pruebas reales
  // el 2026-08-12), inviable para uso real. flash-lite comparte capacidades
  // multimodales/schema y tiene cuota diaria mucho mayor en el free tier.
  // Revisar ai.google.dev/gemini-api/docs/models si esto arranca a fallar
  // con 404 más adelante (modelos se dan de baja con el tiempo).
  const GEMINI_MODEL = 'gemini-3.5-flash-lite';
  const GEMINI_PROMPT = 'Sos un asistente que extrae datos de presupuestos de proveedores de ' +
    'materiales de construcción para una empresa constructora argentina. Analizá el documento ' +
    'adjunto (PDF o foto de un presupuesto) y extraé: 1) el proveedor que lo emite, 2) la fecha ' +
    '(vacía si no figura), 3) cada línea de material con unidad, cantidad si figura, precio ' +
    'unitario, y si el precio está en pesos argentinos o dólares (mirá el símbolo, la mención ' +
    'explícita o el contexto; si no queda claro, asumí ARS), 4) si la descripción del material ' +
    'menciona un tamaño de envase explícito (ej. "18 L", "3.6 L", "25 Kg") y el precio unitario ' +
    'es por ese envase completo (no por la unidad de medida simple), extraé sólo el número de ese ' +
    'tamaño en "contenidoEnvase" (ej. 18, 3.6, 25) — dejalo vacío si no aplica o no está claro. ' +
    'No inventes materiales que no estén escritos en el documento. Si el documento no es un ' +
    'presupuesto o no se puede leer, devolvé "lineas" como un array vacío.';
  const GEMINI_SCHEMA = {
    type: 'OBJECT',
    properties: {
      proveedor: { type: 'STRING' },
      fecha: { type: 'STRING', description: 'YYYY-MM-DD, vacío si no figura' },
      lineas: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            material: { type: 'STRING' },
            unidad: { type: 'STRING' },
            cantidad: { type: 'NUMBER' },
            precioUnitario: { type: 'NUMBER' },
            moneda: { type: 'STRING', enum: ['ARS', 'USD'] },
            contenidoEnvase: { type: 'NUMBER', description: 'Tamaño del envase si el precio es por envase completo, ej. 18 para "18 L". Vacío si no aplica.' },
          },
          required: ['material', 'precioUnitario', 'moneda'],
        },
      },
    },
    required: ['lineas'],
  };

  let state = null; // { obraKey, cotizacionKey, cotizacion, onDone, allMateriales, file, lineas, nextRowId }

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  // Cloudinary guarda los PDF como "raw" y los devuelve con un tipo genérico,
  // así que el mime que Gemini necesita se deduce de lo que se registró al
  // subir (o de la extensión), nunca del blob descargado.
  function mimeDeCotizacion(c) {
    const tipo = c.archivoTipo || '';
    if (tipo === 'application/pdf' || tipo === 'image/jpeg' || tipo === 'image/png') return tipo;
    const nombre = c.archivoNombre || '';
    if (/\.pdf$/i.test(nombre)) return 'application/pdf';
    if (/\.png$/i.test(nombre)) return 'image/png';
    return 'image/jpeg';
  }

  function slugKey(nombre) {
    return nombre.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').substring(0, 40)
      + '_' + Date.now();
  }

  let sessionCounter = 0;

  async function openCotizacionModal(obraKey, cotizacionKey, cotizacion, onDone) {
    state = {
      obraKey, cotizacionKey, cotizacion, onDone,
      sessionId: ++sessionCounter,
      allMateriales: [], lineas: [], nextRowId: 1,
    };

    document.getElementById('cotiz-file-nombre').textContent = cotizacion.archivoNombre || 'Archivo';
    document.getElementById('cotiz-revision-error').classList.add('hidden');
    document.getElementById('cotiz-extraccion-hint').classList.add('hidden');
    document.getElementById('cotiz-ia-loading').classList.add('hidden');
    document.getElementById('cotiz-modal-confirmar').classList.add('hidden');
    document.getElementById('cotiz-proveedor').value = cotizacion.proveedor || '';
    document.getElementById('cotiz-fecha').value = cotizacion.fecha || todayIso();
    document.getElementById('modal-cotizacion').classList.remove('hidden');

    // Se guarda la promesa (no se espera acá) para no bloquear el arranque de
    // la extracción — pero extraerYMostrarRevision() la espera antes de armar
    // la tabla, así el buscador de materiales de cada línea nunca se crea con
    // la lista todavía vacía por una carrera con este fetch.
    state.materialesPromise = _fbGet('/materiales.json')
      .then(data => {
        state.allMateriales = Object.entries(data || {}).map(([key, m]) => ({ key, ...m }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
      })
      .catch(() => { state.allMateriales = []; });

    await extraerYMostrarRevision();
  }

  function closeCotizacionModal() {
    document.getElementById('modal-cotizacion').classList.add('hidden');
    state = null;
  }

  // El archivo puede estar todavía en memoria (recién subido en esta sesión);
  // si no, se baja de Cloudinary para poder mandárselo a Gemini.
  async function obtenerArchivo() {
    const enSesion = window.cotizFilesEnSesion && window.cotizFilesEnSesion[state.cotizacionKey];
    if (enSesion) return enSesion;
    const url = state.cotizacion.archivoUrl;
    if (!url) throw new Error('La cotización no tiene archivo guardado.');
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return await resp.blob();
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
      reader.readAsDataURL(file);
    });
  }

  async function callGeminiExtract(file, mimeType) {
    if (!GEMINI_API_KEY) throw new Error('Gemini no configurado');
    const base64 = await fileToBase64(file);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
    let resp;
    try {
      resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ parts: [
              { text: GEMINI_PROMPT },
              { inlineData: { mimeType, data: base64 } },
            ] }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: GEMINI_SCHEMA,
              // Extracción estructurada simple, no hace falta razonamiento
              // profundo — con "medium" (default de gemini-3.5-flash) cada
              // llamada tardaba ~60-70s, con "minimal" baja a pocos segundos
              // sin perder precisión (probado con presupuestos de prueba).
              thinkingConfig: { thinkingLevel: 'MINIMAL' },
            },
          }),
        }
      );
    } finally {
      clearTimeout(timeoutId);
    }
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    const text = data && data.candidates && data.candidates[0]
      && data.candidates[0].content && data.candidates[0].content.parts
      && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
    if (!text) throw new Error('Respuesta vacía de Gemini');
    return JSON.parse(text);
  }

  function normalizarTexto(s) {
    return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  }

  // Clave para comparar nombres de material al dar de alta: además de lo que
  // hace normalizarTexto, se van los espacios y la puntuación, así "Rodillo
  // lana 22cm" y "Rodillo Lana 22 cm" cuentan como el mismo material y no se
  // crean dos entradas casi idénticas en la biblioteca.
  function claveNombre(s) {
    return normalizarTexto(s || '').replace(/[^a-z0-9]/g, '');
  }

  // Puntaje 0-1: qué fracción de las palabras (≥3 letras) del nombre del
  // material del catálogo aparece dentro del texto detectado por la IA.
  // "Latex interior" vs. "revive latex interior base 18 l a" → 1.0 (las dos
  // palabras aparecen), aunque el texto no sea igual ni lo contenga entero.
  function scoreMaterial(nombreMaterialNorm, targetNorm) {
    const palabras = nombreMaterialNorm.split(/\s+/).filter(w => w.length >= 3);
    if (!palabras.length) return 0;
    const encontradas = palabras.filter(w => targetNorm.includes(w)).length;
    return encontradas / palabras.length;
  }

  // Siempre propone el mejor candidato encontrado (aunque no sea un match
  // perfecto ni único) — el usuario lo revisa y corrige en la tabla, mejor
  // eso que forzarlo a buscar desde cero un material que en realidad ya
  // estaba ahí con un nombre parecido pero no idéntico.
  function matchearMaterialPorNombre(nombreDetectado) {
    if (!nombreDetectado) return null;
    const target = normalizarTexto(nombreDetectado);
    if (!target) return null;
    const exacto = state.allMateriales.find(m => normalizarTexto(m.nombre) === target);
    if (exacto) return exacto.key;

    let mejor = null, mejorScore = 0, mejorPalabras = 0;
    for (const m of state.allMateriales) {
      const nombreNorm = normalizarTexto(m.nombre);
      const score = scoreMaterial(nombreNorm, target);
      const nPalabras = nombreNorm.split(/\s+/).filter(w => w.length >= 3).length;
      // A igual puntaje, gana el nombre más específico (más palabras
      // matcheadas), para no preferir un nombre corto genérico.
      if (score > mejorScore || (score === mejorScore && nPalabras > mejorPalabras)) {
        mejor = m; mejorScore = score; mejorPalabras = nPalabras;
      }
    }
    return mejorScore >= 0.5 ? mejor.key : null;
  }

  function crearLineaDesdeExtraccion(l) {
    const detalle = [l.unidad, l.cantidad != null ? `cant: ${l.cantidad}` : ''].filter(Boolean).join(' · ');
    const materialKey = matchearMaterialPorNombre(l.material);
    // Gemini sólo detecta UNA moneda por línea — hay que resolver la otra acá
    // mismo (misma conversión que attachDualPrecioInputs), porque renderLineas
    // setea `.value` directo sin evento 'input', así que el auto-cálculo
    // cruzado normal (que escucha 'input') no se dispara solo. Sin esto,
    // confirmarCotizacion encontraba el campo sin tocar vacío/NaN y
    // descartaba la línea entera aunque se viera "completa" en pantalla.
    const tieneNumero = typeof l.precioUnitario === 'number';
    const dual = tieneNumero ? window.resolveDualPrecio(l.moneda === 'USD' ? 'USD' : 'ARS', l.precioUnitario) : null;
    return {
      rowId: state.nextRowId++,
      textoDetectado: detalle ? `${l.material} (${detalle})` : (l.material || ''),
      materialKey,
      // Cuando el matcheo no encuentra nada en el catálogo, la línea arranca
      // como material nuevo con lo que detectó la IA ya precargado (nombre y
      // unidad, editables) en vez de quedar vacía obligando a buscar a mano
      // algo que no existe. El material recién se crea al aplicar precios:
      // así el modal es la única fuente de verdad hasta el final y no hay
      // listas que resincronizar en el medio.
      materialNuevo: materialKey ? null : {
        nombre: (l.material || '').trim(),
        unidad: (l.unidad || '').trim(),
      },
      precioUSD: dual ? dual.precioUSD : null,
      precioARS: dual ? dual.precioARS : null,
      precioFormula: null,
      // Envase detectado (ej. lata de 18L) cuando el precio de arriba es por
      // el envase completo, no por la unidad de medida del catálogo — se
      // ofrece un botón para convertir, nunca se divide solo.
      contenidoEnvase: (typeof l.contenidoEnvase === 'number' && l.contenidoEnvase > 0) ? l.contenidoEnvase : null,
      envaseConvertido: false,
      aplicar: true,
      select: null,
    };
  }

  async function extraerYMostrarRevision() {
    // El botón de confirmar queda oculto hasta que termine de extraer: si el
    // usuario lo clickeara mientras Gemini todavía está respondiendo,
    // encontraría la tabla vacía (state.lineas todavía sin poblar).
    const hintEl = document.getElementById('cotiz-extraccion-hint');
    const loadingEl = document.getElementById('cotiz-ia-loading');
    hintEl.classList.add('hidden');
    document.getElementById('cotiz-lineas-lista').classList.add('hidden');
    document.getElementById('btn-cotiz-add-linea').classList.add('hidden');
    loadingEl.classList.remove('hidden');

    const sessionId = state.sessionId; // para descartar la respuesta de un modal ya cerrado
    const mimeType = mimeDeCotizacion(state.cotizacion);
    const [extraido] = await Promise.all([
      obtenerArchivo()
        .then(file => callGeminiExtract(file, mimeType))
        .catch(() => null),
      state.materialesPromise,
    ]);
    if (!state || state.sessionId !== sessionId) return;

    loadingEl.classList.add('hidden');
    document.getElementById('cotiz-lineas-lista').classList.remove('hidden');
    document.getElementById('btn-cotiz-add-linea').classList.remove('hidden');
    hintEl.classList.remove('hidden');

    if (extraido) {
      if (extraido.proveedor) document.getElementById('cotiz-proveedor').value = extraido.proveedor;
      if (extraido.fecha && /^\d{4}-\d{2}-\d{2}$/.test(extraido.fecha)) document.getElementById('cotiz-fecha').value = extraido.fecha;
      const detectadas = (extraido.lineas || []).filter(l => l && l.material);
      state.lineas = detectadas.map(crearLineaDesdeExtraccion);
      const nuevos = state.lineas.filter(l => l.materialNuevo).length;
      hintEl.textContent = detectadas.length
        ? `Se detectaron ${detectadas.length} línea(s) con IA — revisá y corregí antes de confirmar.`
          + (nuevos ? ` ${nuevos === 1 ? '1 material no está' : `${nuevos} materiales no están`} en la biblioteca: se ${nuevos === 1 ? 'va' : 'van'} a crear al aplicar los precios.` : '')
        : 'No se detectó ninguna línea automáticamente — cargalas a mano.';
    } else {
      hintEl.textContent = 'No se pudo leer el presupuesto con IA (sin conexión, sin cuota o formato ilegible) — el archivo sigue guardado; podés cargar los materiales a mano o cerrar y reintentar más tarde.';
    }

    if (!state.lineas.length) agregarLineaManual();
    renderLineas();
    document.getElementById('cotiz-modal-confirmar').classList.remove('hidden');
  }

  function agregarLineaManual() {
    state.lineas.push({
      rowId: state.nextRowId++,
      textoDetectado: '',
      materialKey: null,
      materialNuevo: null,
      precioUSD: null,
      precioARS: null,
      precioFormula: null,
      contenidoEnvase: null,
      envaseConvertido: false,
      aplicar: true,
      select: null,
    });
  }

  // Guarda en `state.lineas` lo que el usuario haya tipeado en el DOM antes
  // de un re-render completo (agregar/eliminar línea) para no perderlo.
  function capturarValoresDom() {
    state.lineas.forEach(l => {
      const row = document.querySelector(`.cotiz-linea[data-row="${l.rowId}"]`);
      if (!row) return;
      const usdInput = row.querySelector('.cl-usd');
      const arsInput = row.querySelector('.cl-ars');
      const usd = parseMoneyString(usdInput.value);
      const ars = parseMoneyString(arsInput.value);
      l.precioUSD = isNaN(usd) ? null : usd;
      l.precioARS = isNaN(ars) ? null : ars;
      l.precioFormula = getCalcFormula(usdInput) || getCalcFormula(arsInput);
      l.aplicar = row.querySelector('.cl-aplicar').checked;
      if (l.materialNuevo) {
        l.materialNuevo.nombre = row.querySelector('.cl-nuevo-nombre').value.trim();
        l.materialNuevo.unidad = row.querySelector('.cl-nuevo-unidad').value.trim();
      }
      const envaseInput = row.querySelector('.cl-envase');
      if (envaseInput) {
        const contenido = parseFloat(envaseInput.value);
        l.contenidoEnvase = contenido > 0 ? contenido : null;
      }
    });
  }

  function eliminarLinea(rowId) {
    capturarValoresDom();
    state.lineas = state.lineas.filter(l => l.rowId !== rowId);
    renderLineas();
  }

  function materialOptions() {
    return state.allMateriales.map(m => ({ value: m.key, label: m.nombre, sublabel: m.unidad }));
  }

  function renderLineas() {
    const container = document.getElementById('cotiz-lineas-lista');
    if (!state.lineas.length) {
      container.innerHTML = '<p class="text-muted" style="font-size:.85rem;">Sin líneas todavía — agregá una manual o subí un archivo.</p>';
      return;
    }

    container.innerHTML = state.lineas.map(l => `
      <div class="cotiz-linea" data-row="${l.rowId}">
        <div class="cotiz-linea-top">
          ${l.textoDetectado ? `<span class="cotiz-linea-detectado" title="${escHtml(l.textoDetectado)}">${escHtml(l.textoDetectado)}</span>` : '<span></span>'}
          <label class="cotiz-linea-aplicar"><input type="checkbox" class="cl-aplicar" ${l.aplicar ? 'checked' : ''}> Aplicar</label>
          <button class="cotiz-linea-del" type="button" title="Eliminar línea">${icSvg('x')}</button>
        </div>
        ${l.materialNuevo ? `
        <div class="cotiz-material-nuevo">
          <span class="cotiz-chip-nuevo">Nuevo</span>
          <input type="text" class="form-control cl-nuevo-nombre" placeholder="Nombre del material" value="${escHtml(l.materialNuevo.nombre || '')}">
          <input type="text" class="form-control cl-nuevo-unidad" placeholder="Unidad" value="${escHtml(l.materialNuevo.unidad || '')}">
          <button type="button" class="cotiz-link-btn cl-buscar-existente">Buscar existente</button>
        </div>` : '<div class="linea-select-container cl-material"></div>'}
        <div class="form-row">
          <div>
            <span class="cotiz-precio-label">Precio USD</span>
            <input type="text" class="form-control cl-usd" placeholder="ej: 5 o =50*100">
          </div>
          <div>
            <span class="cotiz-precio-label">Precio $ (ARS)</span>
            <input type="text" class="form-control cl-ars" placeholder="ej: 5000">
          </div>
        </div>
        ${l.contenidoEnvase && !l.envaseConvertido ? `
        <div class="cotiz-envase-hint">
          <span>El precio de arriba es por un envase de</span>
          <input type="number" step="any" min="0" class="cotiz-envase-input cl-envase" value="${l.contenidoEnvase}">
          <button type="button" class="btn btn-sm btn-outline cl-convertir">Convertir a precio por unidad</button>
        </div>` : ''}
      </div>`).join('');

    state.lineas.forEach(l => {
      const row = container.querySelector(`.cotiz-linea[data-row="${l.rowId}"]`);
      if (!row) return;

      row.querySelector('.cotiz-linea-del').addEventListener('click', () => eliminarLinea(l.rowId));

      const usdInput = row.querySelector('.cl-usd');
      const arsInput = row.querySelector('.cl-ars');
      usdInput.value = l.precioUSD != null ? formatMoneyString(l.precioUSD) : '';
      arsInput.value = l.precioARS != null ? formatMoneyString(l.precioARS) : '';
      setCalcFormula(usdInput, l.precioFormula || null);
      attachCalcInput(usdInput);
      attachMoneyInput(usdInput);
      attachCalcInput(arsInput);
      attachMoneyInput(arsInput);
      attachDualPrecioInputs({ usdInput, arsInput });

      if (l.materialNuevo) {
        l.select = null;
        row.querySelector('.cl-buscar-existente').addEventListener('click', () => {
          capturarValoresDom();
          l.materialNuevo = null;
          l.materialKey = null;
          renderLineas();
        });
      } else {
        l.select = createSearchableSelect(row.querySelector('.cl-material'), {
          options: materialOptions(),
          value: l.materialKey,
          placeholder: 'Buscar material…',
          onChange: key => { l.materialKey = key; },
          onCreateNew: texto => openQuickMaterialInline(texto, l.rowId),
        });
      }

      const convertirBtn = row.querySelector('.cl-convertir');
      if (convertirBtn) {
        convertirBtn.addEventListener('click', () => {
          const contenido = parseFloat(row.querySelector('.cl-envase').value);
          if (!contenido || contenido <= 0) return;
          if (usdInput.value.trim().startsWith('=')) usdInput.blur();
          if (arsInput.value.trim().startsWith('=')) arsInput.blur();
          const usd = parseMoneyString(usdInput.value);
          const ars = parseMoneyString(arsInput.value);
          if (!isNaN(usd)) {
            l.precioUSD = roundLimpio(usd / contenido);
            setCalcFormula(usdInput, null); usdInput.value = formatMoneyString(l.precioUSD);
          }
          if (!isNaN(ars)) {
            l.precioARS = roundLimpio(ars / contenido);
            setCalcFormula(arsInput, null); arsInput.value = formatMoneyString(l.precioARS);
          }
          l.envaseConvertido = true;
          row.querySelector('.cotiz-envase-hint').remove();
          showToast('Precio convertido a valor por unidad.');
        });
      }
    });
  }

  // --- Alta rápida de material (desde una línea de la revisión) ---
  let pendingQuickRowId = null;

  function openQuickMaterialInline(texto, rowId) {
    pendingQuickRowId = rowId;
    document.getElementById('cqm-nombre').value = texto || '';
    document.getElementById('cqm-unidad').value = '';
    document.getElementById('cqm-error').classList.add('hidden');
    document.getElementById('modal-cotiz-quick-material').classList.remove('hidden');
    setTimeout(() => document.getElementById('cqm-nombre').focus(), 50);
  }

  async function saveQuickMaterialInline() {
    const nombre = document.getElementById('cqm-nombre').value.trim();
    const unidad = document.getElementById('cqm-unidad').value.trim();
    const errEl = document.getElementById('cqm-error');
    if (!nombre || !unidad) {
      errEl.textContent = 'Nombre y unidad son requeridos.';
      errEl.classList.remove('hidden');
      return;
    }
    const key = slugKey(nombre);
    try {
      await _fbPut(`/materiales/${key}.json`, { nombre, unidad, creadoEn: Date.now() });
      state.allMateriales.push({ key, nombre, unidad });
      state.allMateriales.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
      document.getElementById('modal-cotiz-quick-material').classList.add('hidden');
      showToast('Material creado.');
      // Todos los buscadores ya montados siguen con el catálogo viejo: sin
      // este refresco, el material recién creado no aparecía en ninguna otra
      // línea y en la propia el input quedaba en blanco (setValue no
      // encontraba el label).
      const opciones = materialOptions();
      state.lineas.forEach(l => { if (l.select) l.select.setOptions(opciones); });
      const linea = state.lineas.find(l => l.rowId === pendingQuickRowId);
      if (linea) {
        linea.materialKey = key;
        linea.materialNuevo = null;
        if (linea.select) linea.select.setValue(key);
      }
    } catch (_) {
      errEl.textContent = 'Error al guardar. Intentá de nuevo.';
      errEl.classList.remove('hidden');
    }
  }

  // --- Confirmar: aplicar precios sobre un archivo ya guardado ---
  async function confirmarCotizacion() {
    const errEl = document.getElementById('cotiz-revision-error');
    errEl.classList.add('hidden');

    const proveedor = document.getElementById('cotiz-proveedor').value.trim();
    const fecha = document.getElementById('cotiz-fecha').value || todayIso();

    document.querySelectorAll('.cotiz-linea.tiene-error').forEach(r => r.classList.remove('tiene-error'));

    const aLineas = [];
    const problemas = [];
    for (const l of state.lineas) {
      const row = document.querySelector(`.cotiz-linea[data-row="${l.rowId}"]`);
      if (!row) continue;
      if (!row.querySelector('.cl-aplicar').checked) continue;

      const materialKey = l.select ? l.select.getValue() : null;
      const nuevoNombre = l.materialNuevo ? row.querySelector('.cl-nuevo-nombre').value.trim() : '';
      const nuevaUnidad = l.materialNuevo ? row.querySelector('.cl-nuevo-unidad').value.trim() : '';
      const usdInput = row.querySelector('.cl-usd');
      const arsInput = row.querySelector('.cl-ars');
      if (usdInput.value.trim().startsWith('=')) usdInput.blur();
      if (arsInput.value.trim().startsWith('=')) arsInput.blur();
      const precioUSD = parseMoneyString(usdInput.value);
      const precioARS = parseMoneyString(arsInput.value);
      const precioOk = !isNaN(precioUSD) && precioUSD >= 0 && !isNaN(precioARS) && precioARS >= 0;
      const materialOk = !!materialKey || (!!nuevoNombre && !!nuevaUnidad);

      // Una línea del todo vacía (típicamente la manual que se agrega sola
      // cuando la IA no detectó nada) se ignora sin molestar; una empezada a
      // medias sí se avisa, en vez de descartarse en silencio como antes.
      if (!materialKey && !nuevoNombre && !precioOk) continue;
      if (!materialOk || !precioOk) {
        row.classList.add('tiene-error');
        const falta = [];
        if (!materialKey && !nuevoNombre) falta.push('el material');
        else if (!materialKey && !nuevaUnidad) falta.push('la unidad del material nuevo');
        if (!precioOk) falta.push('el precio');
        problemas.push(`${nuevoNombre || l.textoDetectado || 'Una línea'}: falta ${falta.join(' y ')}.`);
        continue;
      }

      const material = materialKey ? state.allMateriales.find(m => m.key === materialKey) : null;
      const fc = getCalcFormulaConMoneda(usdInput, arsInput);
      aLineas.push({
        materialKey,
        materialNuevo: materialKey ? null : { nombre: nuevoNombre, unidad: nuevaUnidad },
        materialNombre: material ? material.nombre : nuevoNombre,
        precioUSD, precioARS,
        precioFormula: fc.formula, precioFormulaMoneda: fc.moneda,
      });
    }

    if (problemas.length) {
      errEl.textContent = problemas.length === 1
        ? problemas[0]
        : `Hay ${problemas.length} líneas incompletas — ${problemas.join(' ')}`;
      errEl.classList.remove('hidden');
      // La lista de líneas scrollea dentro del modal: sin esto, el error puede
      // quedar fuera de la vista y parecer que el botón no hizo nada.
      const primeraMala = document.querySelector('.cotiz-linea.tiene-error');
      if (primeraMala) primeraMala.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }

    const cotizacionKey = state.cotizacionKey;
    const btn = document.getElementById('cotiz-modal-confirmar');

    // Sin líneas válidas no hay nada que aplicar, pero el archivo ya está
    // guardado: se conservan proveedor y fecha y se cierra sin trabar al
    // usuario (antes esto era un callejón sin salida que perdía el archivo).
    if (!aLineas.length) {
      btn.disabled = true;
      btn.textContent = 'Guardando…';
      try {
        await _fbPatch(`/obras/${state.obraKey}/cotizaciones/${cotizacionKey}.json`, { proveedor, fecha });
      } catch (_) { /* el archivo ya está guardado; los datos son secundarios */ }
      btn.disabled = false;
      btn.textContent = 'Aplicar precios';
      showToast('No se aplicó ningún precio (ninguna línea tenía material y precio). El archivo sigue guardado.', 'warning');
      const onDoneSinLineas = state.onDone;
      closeCotizacionModal();
      if (typeof onDoneSinLineas === 'function') onDoneSinLineas();
      return;
    }

    const cotizacionUsada = window.dolarOficialVenta();
    if (!cotizacionUsada) {
      errEl.textContent = 'No se pudo obtener la cotización del dólar. Reintentá en un momento.';
      errEl.classList.remove('hidden');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Guardando…';

    const fallos = [];

    // Los materiales nuevos se crean recién acá, con el dólar ya resuelto:
    // así no queda basura en la biblioteca si la confirmación se aborta antes.
    // Dos resguardos contra duplicados: si mientras tanto apareció uno con el
    // mismo nombre en el catálogo se reusa ese, y dos líneas de esta misma
    // cotización con el mismo nombre crean un solo material.
    const creadosPorNombre = {};
    let creados = 0;
    for (const l of aLineas) {
      if (l.materialKey) continue;
      const nombre = l.materialNuevo.nombre;
      const norm = claveNombre(nombre);
      if (creadosPorNombre[norm]) { l.materialKey = creadosPorNombre[norm]; continue; }
      const existente = state.allMateriales.find(m => claveNombre(m.nombre) === norm);
      if (existente) { l.materialKey = existente.key; creadosPorNombre[norm] = existente.key; continue; }

      const key = slugKey(nombre);
      try {
        await _fbPut(`/materiales/${key}.json`, { nombre, unidad: l.materialNuevo.unidad, creadoEn: Date.now() });
        l.materialKey = key;
        creadosPorNombre[norm] = key;
        state.allMateriales.push({ key, nombre, unidad: l.materialNuevo.unidad });
        creados++;
      } catch (_) {
        fallos.push(nombre);
      }
    }

    for (const l of aLineas) {
      if (!l.materialKey) continue; // no se pudo crear el material: ya está en `fallos`
      try {
        await _fbPut(`/materiales/${l.materialKey}/precios/${state.obraKey}.json`, {
          precioUSD: l.precioUSD, precioARS: l.precioARS,
          precioFormula: l.precioFormula, precioFormulaMoneda: l.precioFormulaMoneda,
          proveedor, fecha, cotizacionUsada, origenCotizacionKey: cotizacionKey,
        });
      } catch (_) {
        fallos.push(l.materialNombre);
      }
    }

    // PATCH y no PUT: el registro ya existe (lo creó la subida) y tiene los
    // datos del archivo, que no hay que pisar.
    try {
      await _fbPatch(`/obras/${state.obraKey}/cotizaciones/${cotizacionKey}.json`, {
        proveedor, fecha,
        lineasAplicadas: aLineas.filter(l => l.materialKey).map(l => ({ materialKey: l.materialKey, materialNombre: l.materialNombre, precioUSD: l.precioUSD, precioARS: l.precioARS })),
        estado: fallos.length ? 'aplicada_parcial' : 'aplicada',
        procesadoEn: Date.now(),
      });
    } catch (_) {
      // El archivo y los precios ya se guardaron; el detalle de la cotización
      // es evidencia, no crítico para el cálculo — no reintentar acá.
    }

    const detalleCreados = creados ? ` Se ${creados === 1 ? 'creó 1 material nuevo' : `crearon ${creados} materiales nuevos`}.` : '';
    showToast(fallos.length
      ? `Precios aplicados.${detalleCreados} No se pudo aplicar el precio de: ${fallos.join(', ')}.`
      : `Precios aplicados.${detalleCreados}`, fallos.length ? 'warning' : 'success');

    btn.disabled = false;
    btn.textContent = 'Aplicar precios';
    const onDone = state.onDone;
    closeCotizacionModal();
    if (typeof onDone === 'function') onDone();
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('cotiz-modal-close').addEventListener('click', closeCotizacionModal);
    document.getElementById('cotiz-modal-cancel').addEventListener('click', closeCotizacionModal);
    document.getElementById('btn-cotiz-add-linea').addEventListener('click', () => {
      capturarValoresDom();
      agregarLineaManual();
      renderLineas();
    });
    document.getElementById('cotiz-modal-confirmar').addEventListener('click', confirmarCotizacion);

    document.getElementById('cqm-close').addEventListener('click', () => document.getElementById('modal-cotiz-quick-material').classList.add('hidden'));
    document.getElementById('cqm-cancel').addEventListener('click', () => document.getElementById('modal-cotiz-quick-material').classList.add('hidden'));
    document.getElementById('cqm-save').addEventListener('click', saveQuickMaterialInline);
  });

  window.openCotizacionModal = openCotizacionModal;
})();
