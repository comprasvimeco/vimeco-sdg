/* VIMECO S.A. — Sistema de Gestión — Armar Cómputo con IA
   Sólo disponible con el cómputo de la obra completamente vacío (ver
   actualizarBotonComputoIA en computo.js): se sube un presupuesto (PDF o
   foto), Gemini extrae rubros e ítems (nombre, unidad, cantidad — sin
   precios, eso no se usa acá), el usuario revisa/corrige, y al confirmar se
   crean los rubros (/obras/{obra}/rubrosComputo) y líneas
   (/obras/{obra}/computo) de una sola vez, en el mismo orden del documento.
   El archivo no se sube a ningún lado, sólo se lee para extraer.

   Comparte scope global con computo.js (mismo patrón que cotizaciones-ia.js
   con cotizaciones-obra.js) — usa `$`, `obraKey`, `rubros`, `loadAll` de ahí
   sin redeclararlos. */

(function () {
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const TIPOS_OK = ['application/pdf', 'image/jpeg', 'image/png'];
  const GEMINI_TIMEOUT_MS = 90000;
  const GEMINI_MODEL = 'gemini-3.5-flash-lite'; // ver nota de cuota en cotizaciones-ia.js
  const GEMINI_MODEL_FALLBACK = 'gemini-3.5-flash'; // si el lite da 503 "high demand", ver cotizaciones-ia.js

  const GEMINI_PROMPT = 'Sos un asistente que extrae el rubrado (cómputo) de un presupuesto de ' +
    'obra de construcción argentino, a partir de un PDF o foto del documento. Los presupuestos ' +
    'suelen estar organizados en rubros o capítulos numerados (ej. "1 - Movimiento de suelos") ' +
    'que agrupan ítems numerados dentro (ej. "1.1 Excavación", "1.2 Relleno y compactación"), ' +
    'cada uno con su unidad de medida y cantidad. Extraé esa estructura completa: 1) cada rubro ' +
    'con su nombre (sin el número de rubro, sólo el texto descriptivo), 2) dentro de cada rubro, ' +
    'cada ítem con su nombre (sin el número de ítem), unidad de medida (ej. m2, m3, ml, kg, u, gl) ' +
    'y cantidad numérica. Si el documento no tiene rubros explícitos y es una lista plana de ' +
    'ítems, agrupalos todos en un único rubro llamado "General". No inventes ítems que no estén ' +
    'en el documento, no extraigas precios ni importes (no interesan acá), y no te saltees ningún ' +
    'ítem aunque la cantidad no figure (dejala vacía en ese caso). Si el documento no es un ' +
    'cómputo o presupuesto de obra o no se puede leer, devolvé "rubros" como un array vacío.';

  const GEMINI_SCHEMA = {
    type: 'OBJECT',
    properties: {
      rubros: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            nombre: { type: 'STRING' },
            items: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  nombre: { type: 'STRING' },
                  unidad: { type: 'STRING' },
                  cantidad: { type: 'NUMBER' },
                },
                required: ['nombre'],
              },
            },
          },
          required: ['nombre', 'items'],
        },
      },
    },
    required: ['rubros'],
  };

  let state = null; // { file, rubros: [{ rubroRowId, nombre, items: [{ itemRowId, nombre, unidad, cantidad }] }], nextRubroId, nextItemId }

  function openComputoIAModal() {
    state = { file: null, rubros: [], nextRubroId: 1, nextItemId: 1 };

    $('cia-archivo-input').value = '';
    $('cia-file-nombre').textContent = 'Ningún archivo elegido';
    $('cia-file-nombre').classList.remove('tiene-archivo');
    $('cia-archivo-error').classList.add('hidden');
    $('cia-revision-error').classList.add('hidden');
    $('cia-extraccion-hint').classList.add('hidden');
    $('cia-ia-loading').classList.add('hidden');
    $('cia-paso-archivo').classList.remove('hidden');
    $('cia-paso-revision').classList.add('hidden');
    $('cia-modal-confirmar').classList.add('hidden');
    $('modal-computo-ia').classList.remove('hidden');
  }

  function closeComputoIAModal() {
    $('modal-computo-ia').classList.add('hidden');
    state = null;
  }

  async function handleArchivoSeleccionado(file) {
    const errEl = $('cia-archivo-error');
    const nombreEl = $('cia-file-nombre');
    errEl.classList.add('hidden');
    if (!file) return;

    const tipoOk = TIPOS_OK.includes(file.type) || /\.(pdf|jpe?g|png)$/i.test(file.name);
    if (!tipoOk) {
      errEl.textContent = 'El archivo tiene que ser un PDF o una foto (JPG/PNG).';
      errEl.classList.remove('hidden');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      errEl.textContent = 'El archivo es demasiado grande (máx. 10MB).';
      errEl.classList.remove('hidden');
      return;
    }

    nombreEl.textContent = file.name;
    nombreEl.classList.add('tiene-archivo');
    state.file = file;
    await extraerYMostrarRevision();
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
      reader.readAsDataURL(file);
    });
  }

  async function llamarGemini(model, base64, mimeType) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
    try {
      return await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
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
              thinkingConfig: { thinkingLevel: 'MINIMAL' },
            },
          }),
        }
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function callGeminiExtract(file) {
    if (!GEMINI_API_KEY) throw new Error('Gemini no configurado');
    const base64 = await fileToBase64(file);
    let resp = await llamarGemini(GEMINI_MODEL, base64, file.type);
    if (resp.status === 503) resp = await llamarGemini(GEMINI_MODEL_FALLBACK, base64, file.type);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    const text = data && data.candidates && data.candidates[0]
      && data.candidates[0].content && data.candidates[0].content.parts
      && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
    if (!text) throw new Error('Respuesta vacía de Gemini');
    return JSON.parse(text);
  }

  function estadoDesdeExtraccion(extraido) {
    const rubrosDetectados = (extraido && extraido.rubros) || [];
    return rubrosDetectados
      .filter(r => r && (r.nombre || (r.items && r.items.length)))
      .map(r => ({
        rubroRowId: state.nextRubroId++,
        nombre: r.nombre || '',
        items: (r.items || []).filter(it => it && it.nombre).map(it => ({
          itemRowId: state.nextItemId++,
          nombre: it.nombre || '',
          unidad: it.unidad || '',
          cantidad: typeof it.cantidad === 'number' ? it.cantidad : null,
        })),
      }));
  }

  async function extraerYMostrarRevision() {
    $('cia-paso-archivo').classList.add('hidden');
    $('cia-paso-revision').classList.remove('hidden');
    const hintEl = $('cia-extraccion-hint');
    const loadingEl = $('cia-ia-loading');
    hintEl.classList.add('hidden');
    $('cia-rubros-lista').classList.add('hidden');
    $('btn-cia-add-rubro').classList.add('hidden');
    loadingEl.classList.remove('hidden');

    const extraido = await callGeminiExtract(state.file).catch(() => null);

    loadingEl.classList.add('hidden');
    $('cia-rubros-lista').classList.remove('hidden');
    $('btn-cia-add-rubro').classList.remove('hidden');
    hintEl.classList.remove('hidden');

    if (extraido) {
      state.rubros = estadoDesdeExtraccion(extraido);
      const totalItems = state.rubros.reduce((acc, r) => acc + r.items.length, 0);
      hintEl.textContent = state.rubros.length
        ? `Se detectaron ${state.rubros.length} rubro(s) con ${totalItems} ítem(s) — revisá y corregí antes de confirmar.`
        : 'No se detectó ningún rubro automáticamente — cargalos a mano.';
    } else {
      hintEl.textContent = 'No se pudo leer el presupuesto con IA — cargá el cómputo a mano.';
    }

    if (!state.rubros.length) agregarRubroManual();
    renderRubros();
    $('cia-modal-confirmar').classList.remove('hidden');
  }

  function nuevoItemVacio() {
    return { itemRowId: state.nextItemId++, nombre: '', unidad: '', cantidad: null };
  }

  function agregarRubroManual() {
    state.rubros.push({ rubroRowId: state.nextRubroId++, nombre: '', items: [nuevoItemVacio()] });
  }

  // Guarda en `state.rubros` lo tipeado en el DOM antes de un re-render
  // completo (agregar/eliminar rubro o ítem), para no perderlo.
  function capturarValoresDom() {
    state.rubros.forEach(r => {
      const rubroEl = document.querySelector(`.cia-rubro[data-rubro-row="${r.rubroRowId}"]`);
      if (!rubroEl) return;
      const nombreInput = rubroEl.querySelector('.cia-rubro-nombre');
      if (nombreInput) r.nombre = nombreInput.value;
      r.items.forEach(it => {
        const itemEl = rubroEl.querySelector(`.cia-item[data-item-row="${it.itemRowId}"]`);
        if (!itemEl) return;
        it.nombre = itemEl.querySelector('.cia-item-nombre').value;
        it.unidad = itemEl.querySelector('.cia-item-unidad').value;
        const cantidadRaw = itemEl.querySelector('.cia-item-cantidad').value;
        const cantidad = parseFloat(cantidadRaw.replace(',', '.'));
        it.cantidad = cantidadRaw.trim() === '' || isNaN(cantidad) ? null : cantidad;
      });
    });
  }

  function eliminarRubro(rubroRowId) {
    capturarValoresDom();
    state.rubros = state.rubros.filter(r => r.rubroRowId !== rubroRowId);
    renderRubros();
  }

  function eliminarItem(rubroRowId, itemRowId) {
    capturarValoresDom();
    const r = state.rubros.find(r => r.rubroRowId === rubroRowId);
    if (r) r.items = r.items.filter(it => it.itemRowId !== itemRowId);
    renderRubros();
  }

  function agregarItem(rubroRowId) {
    capturarValoresDom();
    const r = state.rubros.find(r => r.rubroRowId === rubroRowId);
    if (r) r.items.push(nuevoItemVacio());
    renderRubros();
  }

  function renderRubros() {
    const container = $('cia-rubros-lista');
    if (!state.rubros.length) {
      container.innerHTML = '<p class="text-muted" style="font-size:.85rem;">Sin rubros todavía — agregá uno manual o subí un archivo.</p>';
      return;
    }

    container.innerHTML = state.rubros.map(r => `
      <div class="cia-rubro" data-rubro-row="${r.rubroRowId}">
        <div class="cia-rubro-top">
          <input type="text" class="form-control cia-rubro-nombre" placeholder="Nombre del rubro" value="${escHtml(r.nombre)}">
          <button type="button" class="cia-rubro-add-item" title="Agregar ítem en este rubro">${icSvg('plus')}</button>
          <button type="button" class="cia-rubro-del" title="Eliminar rubro">${icSvg('x')}</button>
        </div>
        ${r.items.map(it => `
          <div class="cia-item" data-item-row="${it.itemRowId}">
            <input type="text" class="form-control cia-item-nombre" placeholder="Ítem" value="${escHtml(it.nombre)}">
            <input type="text" class="form-control cia-item-unidad" placeholder="Unidad" value="${escHtml(it.unidad || '')}">
            <input type="text" class="form-control cia-item-cantidad" placeholder="Cantidad" value="${it.cantidad != null ? it.cantidad : ''}">
            <button type="button" class="cia-item-del" title="Eliminar ítem">${icSvg('x')}</button>
          </div>`).join('')}
      </div>`).join('');

    container.querySelectorAll('.cia-rubro').forEach(rubroEl => {
      const rubroRowId = parseInt(rubroEl.dataset.rubroRow, 10);
      rubroEl.querySelector('.cia-rubro-add-item').addEventListener('click', () => agregarItem(rubroRowId));
      rubroEl.querySelector('.cia-rubro-del').addEventListener('click', () => eliminarRubro(rubroRowId));
      rubroEl.querySelectorAll('.cia-item').forEach(itemEl => {
        const itemRowId = parseInt(itemEl.dataset.itemRow, 10);
        itemEl.querySelector('.cia-item-del').addEventListener('click', () => eliminarItem(rubroRowId, itemRowId));
      });
    });
  }

  async function confirmarComputoIA() {
    capturarValoresDom();
    const errEl = $('cia-revision-error');
    errEl.classList.add('hidden');

    // El botón sólo está habilitado con el cómputo vacío, pero se re-chequea
    // acá por si se abrió una segunda pestaña o quedó una carga a medias.
    if (computoCargado()) {
      errEl.textContent = 'El cómputo ya no está vacío — cerrá este modal, recargá la página e intentá de nuevo.';
      errEl.classList.remove('hidden');
      return;
    }

    const rubrosValidos = state.rubros
      .map(r => ({ nombre: (r.nombre || '').trim(), items: r.items.filter(it => (it.nombre || '').trim()) }))
      .filter(r => r.nombre && r.items.length);

    if (!rubrosValidos.length) {
      errEl.textContent = 'Cargá al menos un rubro con nombre y un ítem con nombre.';
      errEl.classList.remove('hidden');
      return;
    }

    const btn = $('cia-modal-confirmar');
    btn.disabled = true;
    btn.textContent = 'Creando…';

    const fallos = [];
    let totalItems = 0;
    const writes = [];
    // En una obra sin rubros los ítems extraídos van todos a una sola lista: el
    // rubro que los contiene existe por el modelo, pero no se ve ni se imprime.
    const plana = sinRubros();
    const nuevoRubroId = () => 'rubro_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const rubroUnico = plana ? nuevoRubroId() : null;
    if (plana) {
      writes.push(
        _fbPut(`/obras/${obraKey}/rubrosComputo/${rubroUnico}.json`, { nombre: '', orden: 1 })
          .catch(() => fallos.push('la lista de ítems'))
      );
    }
    let ordenPlano = 0;

    rubrosValidos.forEach((r, i) => {
      const rubroId = plana ? rubroUnico : nuevoRubroId();
      if (!plana) {
        writes.push(
          _fbPut(`/obras/${obraKey}/rubrosComputo/${rubroId}.json`, { nombre: r.nombre, orden: i + 1 })
            .catch(() => fallos.push(`rubro "${r.nombre}"`))
        );
      }
      r.items.forEach((it, j) => {
        const lineaKey = 'linea_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        totalItems++;
        writes.push(
          _fbPut(`/obras/${obraKey}/computo/${lineaKey}.json`, {
            rubroId, nombre: it.nombre.trim(), unidad: (it.unidad || '').trim(),
            cantidad: it.cantidad, itemKey: null, orden: plana ? ++ordenPlano : j + 1,
            creadoEn: Date.now(),
          }).catch(() => fallos.push(`"${it.nombre}" (${r.nombre})`))
        );
      });
    });
    await Promise.all(writes);

    btn.disabled = false;
    btn.textContent = 'Confirmar y crear cómputo';

    if (fallos.length) {
      showToast(`Cómputo creado con errores en: ${fallos.join(', ')}.`, 'warning');
    } else {
      showToast(plana
        ? `Cómputo creado: ${totalItems} ítem(s).`
        : `Cómputo creado: ${rubrosValidos.length} rubro(s), ${totalItems} ítem(s).`, 'success');
    }
    closeComputoIAModal();
    await loadAll();
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('computo-ia-icon').innerHTML = icSvg('sparkles');
    $('cia-modal-close').addEventListener('click', closeComputoIAModal);
    $('cia-modal-cancel').addEventListener('click', closeComputoIAModal);
    $('btn-cia-elegir-archivo').addEventListener('click', () => $('cia-archivo-input').click());
    $('cia-archivo-input').addEventListener('change', e => handleArchivoSeleccionado(e.target.files[0]));

    const dropzone = $('cia-dropzone');
    ['dragover', 'dragenter'].forEach(evt => dropzone.addEventListener(evt, e => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    }));
    ['dragleave', 'dragend'].forEach(evt => dropzone.addEventListener(evt, () => dropzone.classList.remove('dragover')));
    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) handleArchivoSeleccionado(file);
    });

    $('btn-cia-add-rubro').addEventListener('click', () => {
      capturarValoresDom();
      agregarRubroManual();
      renderRubros();
    });
    $('cia-modal-confirmar').addEventListener('click', confirmarComputoIA);
  });

  window.openComputoIAModal = openComputoIAModal;
})();
