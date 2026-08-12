/* VIMECO S.A. — Sistema de Gestión — Cotizaciones (Datos de obra)
   Subir un presupuesto de proveedor (PDF/foto), revisar/corregir materiales
   y precios detectados (o cargados a mano), y aplicarlos a
   /materiales/{key}/precios/{obraKey}. El archivo se guarda en Cloudinary
   (js/storage.js). No declara `$` acá — datos-obra.js ya lo declara a nivel
   de script y ambos corren en el mismo scope global. */

(function () {
  const MAX_FILE_BYTES = 10 * 1024 * 1024; // límite de subida del plan free de Cloudinary
  const TIPOS_OK = ['application/pdf', 'image/jpeg', 'image/png'];

  let state = null; // { obraKey, onDone, allMateriales, file, lineas, nextRowId }

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function slugKey(nombre) {
    return nombre.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').substring(0, 40)
      + '_' + Date.now();
  }

  async function openCotizacionModal(obraKey, onDone) {
    state = { obraKey, onDone, allMateriales: [], file: null, lineas: [], nextRowId: 1 };

    document.getElementById('cotiz-modal-title').textContent = 'Subir cotización';
    document.getElementById('cotiz-archivo-input').value = '';
    document.getElementById('cotiz-archivo-error').classList.add('hidden');
    document.getElementById('cotiz-revision-error').classList.add('hidden');
    document.getElementById('cotiz-extraccion-hint').classList.add('hidden');
    document.getElementById('cotiz-paso-archivo').classList.remove('hidden');
    document.getElementById('cotiz-paso-revision').classList.add('hidden');
    document.getElementById('cotiz-modal-confirmar').classList.add('hidden');
    document.getElementById('cotiz-proveedor').value = '';
    document.getElementById('cotiz-fecha').value = todayIso();
    document.getElementById('modal-cotizacion').classList.remove('hidden');

    // Se guarda la promesa (no se espera acá) para no bloquear la elección de
    // archivo — pero irAPasoRevision() la espera antes de armar la tabla, así
    // el buscador de materiales de cada línea nunca se crea con la lista
    // todavía vacía por una carrera con este fetch.
    state.materialesPromise = _fbGet('/materiales.json')
      .then(data => {
        state.allMateriales = Object.entries(data || {}).map(([key, m]) => ({ key, ...m }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
      })
      .catch(() => { state.allMateriales = []; });
  }

  function closeCotizacionModal() {
    document.getElementById('modal-cotizacion').classList.add('hidden');
    state = null;
  }

  async function handleArchivoSeleccionado(file) {
    const errEl = document.getElementById('cotiz-archivo-error');
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

    state.file = file;
    await irAPasoRevision();
  }

  async function irAPasoRevision() {
    document.getElementById('cotiz-paso-archivo').classList.add('hidden');
    document.getElementById('cotiz-paso-revision').classList.remove('hidden');
    document.getElementById('cotiz-modal-confirmar').classList.remove('hidden');
    if (state.materialesPromise) await state.materialesPromise;
    if (!state.lineas.length) agregarLineaManual();
    renderLineas();
  }

  function agregarLineaManual() {
    state.lineas.push({
      rowId: state.nextRowId++,
      textoDetectado: '',
      materialKey: null,
      precioUSD: null,
      precioARS: null,
      precioFormula: null,
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
        <div class="linea-select-container cl-material"></div>
        <div class="form-row">
          <input type="text" class="form-control cl-usd" placeholder="USD, ej: 5 o =50*100">
          <input type="text" class="form-control cl-ars" placeholder="$, ej: 5000">
        </div>
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

      l.select = createSearchableSelect(row.querySelector('.cl-material'), {
        options: materialOptions(),
        value: l.materialKey,
        placeholder: 'Buscar material…',
        onChange: key => { l.materialKey = key; },
        onCreateNew: texto => openQuickMaterialInline(texto, l.rowId),
      });
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
      const linea = state.lineas.find(l => l.rowId === pendingQuickRowId);
      if (linea) {
        linea.materialKey = key;
        if (linea.select) linea.select.setValue(key);
      }
    } catch (_) {
      errEl.textContent = 'Error al guardar. Intentá de nuevo.';
      errEl.classList.remove('hidden');
    }
  }

  // --- Confirmar: subir archivo, aplicar precios, guardar registro ---
  async function confirmarCotizacion() {
    const errEl = document.getElementById('cotiz-revision-error');
    errEl.classList.add('hidden');

    const proveedor = document.getElementById('cotiz-proveedor').value.trim();
    const fecha = document.getElementById('cotiz-fecha').value || todayIso();

    const aLineas = [];
    for (const l of state.lineas) {
      const row = document.querySelector(`.cotiz-linea[data-row="${l.rowId}"]`);
      if (!row) continue;
      if (!row.querySelector('.cl-aplicar').checked) continue;

      const materialKey = l.select ? l.select.getValue() : l.materialKey;
      const usdInput = row.querySelector('.cl-usd');
      const arsInput = row.querySelector('.cl-ars');
      if (usdInput.value.trim().startsWith('=')) usdInput.blur();
      if (arsInput.value.trim().startsWith('=')) arsInput.blur();
      const precioUSD = parseMoneyString(usdInput.value);
      const precioARS = parseMoneyString(arsInput.value);
      if (!materialKey || isNaN(precioUSD) || precioUSD < 0 || isNaN(precioARS) || precioARS < 0) continue;

      const material = state.allMateriales.find(m => m.key === materialKey);
      aLineas.push({
        materialKey,
        materialNombre: material ? material.nombre : materialKey,
        precioUSD, precioARS,
        precioFormula: getCalcFormula(usdInput) || getCalcFormula(arsInput),
      });
    }

    if (!aLineas.length) {
      errEl.textContent = 'Marcá al menos una línea con material y precio válidos para aplicar.';
      errEl.classList.remove('hidden');
      return;
    }

    const cotizacionUsada = window.dolarOficialVenta();
    if (!cotizacionUsada) {
      errEl.textContent = 'No se pudo obtener la cotización del dólar. Reintentá en un momento.';
      errEl.classList.remove('hidden');
      return;
    }

    const btn = document.getElementById('cotiz-modal-confirmar');
    btn.disabled = true;
    btn.textContent = 'Guardando…';

    const cotizacionKey = 'cotiz_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    let archivoUrl;

    try {
      archivoUrl = await _stUpload(state.file, `cotizaciones/${state.obraKey}`);
    } catch (err) {
      errEl.textContent = 'No se pudo subir el archivo. Revisá la configuración de Cloudinary (Cloud name / upload preset en js/config.js) o probá de nuevo.';
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Confirmar y guardar';
      return;
    }

    const fallos = [];
    for (const l of aLineas) {
      try {
        await _fbPut(`/materiales/${l.materialKey}/precios/${state.obraKey}.json`, {
          precioUSD: l.precioUSD, precioARS: l.precioARS, precioFormula: l.precioFormula,
          proveedor, fecha, cotizacionUsada, origenCotizacionKey: cotizacionKey,
        });
      } catch (_) {
        fallos.push(l.materialNombre);
      }
    }

    try {
      await _fbPut(`/obras/${state.obraKey}/cotizaciones/${cotizacionKey}.json`, {
        proveedor, fecha,
        archivoNombre: state.file.name,
        archivoTipo: state.file.type || '',
        archivoUrl,
        lineasAplicadas: aLineas.map(l => ({ materialKey: l.materialKey, materialNombre: l.materialNombre, precioUSD: l.precioUSD, precioARS: l.precioARS })),
        estado: fallos.length ? 'aplicada_parcial' : 'aplicada',
        creadoEn: Date.now(),
      });
    } catch (_) {
      // El archivo y los precios ya se guardaron; el registro de la cotización
      // es evidencia, no crítico para el cálculo — no reintentar acá.
    }

    showToast(fallos.length
      ? `Cotización guardada. No se pudo aplicar el precio de: ${fallos.join(', ')}.`
      : 'Cotización guardada y precios aplicados.', fallos.length ? 'warning' : 'success');

    btn.disabled = false;
    btn.textContent = 'Confirmar y guardar';
    const onDone = state.onDone;
    closeCotizacionModal();
    if (typeof onDone === 'function') onDone();
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('cotiz-modal-close').addEventListener('click', closeCotizacionModal);
    document.getElementById('cotiz-modal-cancel').addEventListener('click', closeCotizacionModal);
    document.getElementById('cotiz-archivo-input').addEventListener('change', e => handleArchivoSeleccionado(e.target.files[0]));
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
