/* VIMECO S.A. — Sistema de Gestión — Varios proveedores de un material por obra

   Esquema (aditivo sobre el de project_rediseno_fuentes_precios):
   - /materiales/{k}/precios/{obraKey}: el precio que USA la obra (el
     proveedor elegido). Es lo único que leen calcCostos.js y todo el cálculo,
     así que nada del motor sabe que existe la comparativa. Lleva
     `proveedorKey` para saber cuál de la comparativa es.
   - /materiales/{k}/proveedores/{obraKey}/{provKey}: los OTROS proveedores
     cargados para esa obra, los que no están elegidos. El elegido vive sólo
     en precios/{obraKey}: no se duplica, así no hay dos copias que se
     desfasen. Elegir otro es mudar uno a precios y el anterior a proveedores.
   - Va como nodo hermano y no adentro de precios/{obraKey} porque un PUT
     ahí borraría los hijos anidados (incidente del 2026-08-11).
   - Precios viejos sin `proveedorKey`: su key se deduce del nombre del
     proveedor, así entran a la comparativa sin migrar nada.

   Las funciones que escriben NO agrupan el undo por su cuenta: las llama
   cada pantalla adentro de su propio window.undoAgrupar (anidar dos grupos
   cerraría el de afuera). Raíces null siempre: /materiales es compartido. */

(function () {
  window.provKeyDe = function (nombre) {
    const slug = window.normBusqueda(nombre).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return slug || 'sin-proveedor';
  };

  function elegidoKeyDe(precio) {
    if (!precio) return null;
    return precio.proveedorKey || window.provKeyDe(precio.proveedor);
  }

  // Lo que se guarda de un precio, sin los campos de armado de la comparativa.
  function limpio(p) {
    const out = {};
    ['precioUSD', 'precioARS', 'precioFormula', 'precioFormulaMoneda', 'proveedor', 'fecha', 'cotizacionUsada', 'origenCotizacionKey']
      .forEach(c => { if (p[c] !== undefined && p[c] !== null) out[c] = p[c]; });
    return out;
  }

  function pathMaterial(material, obraKey) {
    if (!material || !material.key || !obraKey) throw new Error('Falta el material o la obra');
    return `/materiales/${material.key}`;
  }

  function pathProveedor(material, obraKey, provKey) {
    if (!provKey) throw new Error('Falta el proveedor');
    return `${pathMaterial(material, obraKey)}/proveedores/${obraKey}/${provKey}.json`;
  }

  function setProveedorLocal(material, obraKey, provKey, valor) {
    material.proveedores = material.proveedores || {};
    const deObra = { ...(material.proveedores[obraKey] || {}) };
    if (valor) deObra[provKey] = valor; else delete deObra[provKey];
    if (Object.keys(deObra).length) material.proveedores[obraKey] = deObra;
    else delete material.proveedores[obraKey];
  }

  function setPrecioLocal(material, obraKey, valor) {
    material.precios = { ...(material.precios || {}) };
    if (valor) material.precios[obraKey] = valor; else delete material.precios[obraKey];
  }

  // Filas de la comparativa de una obra: el elegido primero, después el
  // resto del más barato al más caro.
  window.comparativaPrecios = function (material, obraKey) {
    if (!material || !obraKey) return [];
    const elegido = (material.precios || {})[obraKey];
    const eKey = elegidoKeyDe(elegido);
    const otros = Object.entries(((material.proveedores || {})[obraKey]) || {})
      .filter(([k]) => k !== eKey)
      .map(([provKey, p]) => ({ ...p, provKey, elegido: false }))
      .sort((a, b) => (a.precioARS ?? Infinity) - (b.precioARS ?? Infinity));
    return elegido ? [{ ...elegido, provKey: eKey, elegido: true }, ...otros] : otros;
  };

  // Guarda el precio de un proveedor en la comparativa de la obra. Pasa a
  // ser el que usa la obra si es un proveedor nuevo en la comparativa (el
  // último que se agrega queda elegido), si es el mismo proveedor que el
  // elegido, o si se pide con opts.elegir. Editar una alternativa que ya
  // estaba no la elige.
  // opts.provKeyAnterior: la key de la fila que se estaba editando, por si
  // se le cambió el nombre al proveedor (cambia la key: se borra la vieja).
  window.guardarPrecioProveedor = async function (material, obraKey, precioData, opts) {
    opts = opts || {};
    const base = pathMaterial(material, obraKey);
    const key = window.provKeyDe(precioData.proveedor);
    const anterior = opts.provKeyAnterior || null;
    const elegido = (material.precios || {})[obraKey];
    const eKey = elegidoKeyDe(elegido);
    const datos = limpio(precioData);
    const enProveedores = k => !!(((material.proveedores || {})[obraKey]) || {})[k];

    const esNuevo = !anterior && key !== eKey && !enProveedores(key);
    const esElegido = !elegido || esNuevo || key === eKey || (anterior && anterior === eKey) || opts.elegir;
    if (esElegido) {
      // Si se elige uno nuevo por encima de otro proveedor, el anterior no se
      // pierde: baja a la comparativa.
      if (elegido && eKey !== key && eKey !== anterior) {
        await _fbPut(pathProveedor(material, obraKey, eKey), limpio(elegido));
        setProveedorLocal(material, obraKey, eKey, limpio(elegido));
      }
      const nuevo = { ...datos, proveedorKey: key };
      await _fbPut(`${base}/precios/${obraKey}.json`, nuevo);
      setPrecioLocal(material, obraKey, nuevo);
      if (enProveedores(key)) {
        await _fbDel(pathProveedor(material, obraKey, key));
        setProveedorLocal(material, obraKey, key, null);
      }
    } else {
      await _fbPut(pathProveedor(material, obraKey, key), datos);
      setProveedorLocal(material, obraKey, key, datos);
    }
    if (anterior && anterior !== key && anterior !== eKey && enProveedores(anterior)) {
      await _fbDel(pathProveedor(material, obraKey, anterior));
      setProveedorLocal(material, obraKey, anterior, null);
    }
    return { provKey: key, elegido: !!esElegido };
  };

  // Pasa a usar en la obra el precio de otro proveedor de la comparativa.
  window.elegirProveedorPrecio = async function (material, obraKey, provKey) {
    const base = pathMaterial(material, obraKey);
    const target = (((material.proveedores || {})[obraKey]) || {})[provKey];
    if (!target) return;
    const elegido = (material.precios || {})[obraKey];
    const eKey = elegidoKeyDe(elegido);
    if (elegido && eKey !== provKey) {
      await _fbPut(pathProveedor(material, obraKey, eKey), limpio(elegido));
      setProveedorLocal(material, obraKey, eKey, limpio(elegido));
    }
    const nuevo = { ...limpio(target), proveedorKey: provKey };
    await _fbPut(`${base}/precios/${obraKey}.json`, nuevo);
    setPrecioLocal(material, obraKey, nuevo);
    await _fbDel(pathProveedor(material, obraKey, provKey));
    setProveedorLocal(material, obraKey, provKey, null);
  };

  // Saca un proveedor de la comparativa. El elegido sólo se puede sacar si
  // es el único (la obra queda sin precio propio, como siempre); si hay
  // otros, primero hay que elegir uno de ellos. Devuelve false si no borró.
  window.eliminarProveedorPrecio = async function (material, obraKey, provKey) {
    const base = pathMaterial(material, obraKey);
    const elegido = (material.precios || {})[obraKey];
    if (elegido && elegidoKeyDe(elegido) === provKey) {
      if (window.comparativaPrecios(material, obraKey).length > 1) return false;
      await _fbDel(`${base}/precios/${obraKey}.json`);
      setPrecioLocal(material, obraKey, null);
      return true;
    }
    await _fbDel(pathProveedor(material, obraKey, provKey));
    setProveedorLocal(material, obraKey, provKey, null);
    return true;
  };

  const fmtFechaCorta = iso => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };

  // De dónde sale el precio que usa una obra sin precio propio: el vigente
  // (el más reciente entre todas, ver precioDefaultDe en calcCostos.js).
  // null si la obra tiene precio propio o si no hay ninguno en ninguna obra.
  window.textoPrecioVigente = function (material, obraKey, obrasMap) {
    if (!material || (material.precios || {})[obraKey]) return null;
    const def = window.precioDefaultDe(material);
    if (!def) return 'Este material no tiene precio cargado en ninguna obra.';
    const p = def.precio;
    const partes = [
      p.precioARS != null ? fmtARSFijo(p.precioARS) : (p.precioUSD != null ? fmtUSD(p.precioUSD) : null),
      p.proveedor || 'sin proveedor',
      p.fecha ? fmtFechaCorta(p.fecha) : 'sin fecha',
      `de ${(obrasMap && obrasMap[def.obraKey]) || def.obraKey}`,
    ].filter(Boolean);
    return `Esta obra no tiene precio propio: usa el vigente — ${partes.join(' · ')}.`;
  };

  // Tabla de la comparativa dentro de una ficha de precio.
  // opts: { editandoKey, soloLectura, onEditar(fila), onNuevo(), onElegir(provKey), onEliminar(provKey) }
  window.renderComparativaPrecios = function (container, material, obraKey, opts) {
    opts = opts || {};
    const filas = window.comparativaPrecios(material, obraKey);
    if (!filas.length) { container.innerHTML = ''; return; }
    const ref = filas[0].elegido ? filas[0].precioARS : null;
    const conPrecio = filas.filter(f => f.precioARS != null);
    const minimo = conPrecio.length > 1 ? Math.min(...conPrecio.map(f => f.precioARS)) : null;
    const vacio = '<span class="text-muted">—</span>';
    const dif = f => {
      if (f.elegido || ref == null || !ref || f.precioARS == null) return '';
      const pct = (f.precioARS - ref) / ref;
      return `<span class="${pct < 0 ? 'cmp-baja' : 'cmp-sube'}">${pct > 0 ? '+' : ''}${fmtPct(pct)}</span>`;
    };
    const ro = !!opts.soloLectura;
    const cuerpo = filas.map(f => `
      <tr data-prov="${escHtml(f.provKey)}" class="${f.provKey === opts.editandoKey ? 'cmp-editando' : ''}">
        <td><input type="radio" name="cmp-elegido" class="cmp-elegir" ${f.elegido ? 'checked' : ''} ${ro ? 'disabled' : ''} title="Usar este precio en la obra"></td>
        <td class="cmp-prov">${f.proveedor ? escHtml(f.proveedor) : vacio}${f.precioARS != null && f.precioARS === minimo ? ' <span class="cmp-tag">más barato</span>' : ''}</td>
        <td>${f.fecha ? fmtFechaCorta(f.fecha) : vacio}</td>
        <td class="num">${f.precioARS != null ? fmtARSFijo(f.precioARS) : vacio}</td>
        <td class="num">${f.cotizacionUsada ? fmtARSFijo(f.cotizacionUsada) : vacio}</td>
        <td class="num">${f.precioUSD != null ? fmtUSD(f.precioUSD) : vacio}</td>
        <td class="num">${dif(f)}</td>
        <td>${ro ? '' : '<button type="button" class="cmp-del" title="Sacar de la comparativa">×</button>'}</td>
      </tr>`).join('');
    container.innerHTML = `
      <div class="cmp-head">
        <label>Proveedores en esta obra</label>
        ${ro ? '' : '<button type="button" class="btn btn-sm btn-outline cmp-nuevo">+ Otro proveedor</button>'}
      </div>
      <div class="cmp-wrap"><table class="cmp-tabla">
        <thead><tr><th title="Elegido: el que usa la obra">Usa</th><th>Proveedor</th><th>Fecha</th><th class="num">Precio $</th><th class="num">Cotiz.</th><th class="num">USD</th><th class="num">vs. elegido</th><th></th></tr></thead>
        <tbody>${cuerpo}</tbody>
      </table></div>
      <span class="form-hint">Tocá una fila para ver o editar sus datos abajo. El tildado es el que se usa en el costo.</span>`;

    const nuevo = container.querySelector('.cmp-nuevo');
    if (nuevo) nuevo.addEventListener('click', () => opts.onNuevo && opts.onNuevo());
    container.querySelectorAll('tbody tr').forEach(tr => {
      const fila = filas.find(f => f.provKey === tr.dataset.prov);
      tr.addEventListener('click', e => {
        if (e.target.closest('.cmp-elegir, .cmp-del')) return;
        opts.onEditar && opts.onEditar(fila);
      });
      const radio = tr.querySelector('.cmp-elegir');
      radio.addEventListener('change', () => { if (!fila.elegido) opts.onElegir && opts.onElegir(fila.provKey); });
      const del = tr.querySelector('.cmp-del');
      if (del) del.addEventListener('click', () => opts.onEliminar && opts.onEliminar(fila.provKey));
    });
  };
})();
