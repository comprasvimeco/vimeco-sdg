/* VIMECO S.A. — Cerrar un presupuesto: la foto de una oferta enviada.

   Un presupuesto que se mandó a una licitación tiene que seguir dando el mismo
   número para siempre. No lo hacía: parte de lo que entra al cálculo es
   GLOBAL y compartido entre obras — la ficha de cada equipo (/equipos: costo
   USD, vida útil, uso anual, potencia, consumo) es el caso que rompió una
   oferta ya enviada al corregirle los HP a dos máquinas mientras se preparaba
   la licitación siguiente. El modo lectura por obra (js/ui.js) no alcanza:
   cuida los datos DE la obra, no el catálogo.

   La idea de acá es una sola: **se congelan las entradas, no las salidas**.
   Todo el presupuesto —y con él los A.P, los auxiliares, la Carga Fija, el
   Plan de Avance y los Insumos— nace de window.cargarPresupuestoObra
   (js/presupuestoDatos.js), que lee once cosas de la base. Un cierre guarda
   esas once cosas y después vuelve a correr exactamente la misma cadena de
   cálculo sobre la foto. Ninguna fórmula se duplica y ninguna pantalla
   aprende un segundo modo de calcular: si el número vivo y el congelado
   difieren, es porque cambió un dato, que es justo lo que se quería evitar.

   Lo único que congelar entradas NO puede tapar es un cambio en las fórmulas
   (js/calcCostos.js). Para eso está la huella: al cerrar se guarda el
   resultado número por número, y cada vez que el cierre se abre se recalcula
   y se compara. Si el motor cambió, el cierre lo dice en la cara en vez de
   mentir en silencio.

   Guardado en /obras/{obraKey}/cierres/{cierreKey}:
     meta      nombre, fecha, autor, versión de la app, notas, anulado
     datos     las once fuentes congeladas (ver armarSnapshotCierre)
     resultado la huella (ver huellaDeCierre) */

(function () {

  const num = v => (v == null || isNaN(v) ? null : Number(v));

  /* Dos números "iguales al centavo". La comparación es prácticamente exacta:
     la tolerancia sólo cubre el ida y vuelta por JSON de la base, muy por
     debajo de cualquier cambio real de fórmula (que mueve centavos, no
     billonésimas). Sin ella, un redondeo de serialización se leería como "el
     motor cambió" y el aviso perdería todo su valor. */
  function iguales(a, b) {
    a = num(a); b = num(b);
    if (a === null || b === null) return a === b;
    return a === b || Math.abs(a - b) <= Math.max(1e-9, Math.abs(a) * 1e-12);
  }

  /* ===== Armar la foto ===== */

  // Ítems que la obra realmente usa: los del Cómputo y los de los análisis
  // auxiliares. Un auxiliar usado como insumo dentro de otro A.P es siempre un
  // auxiliar de esta obra (/obras/{k}/auxiliares), así que su receta ya entra
  // por esa puerta — no hace falta recorrer la cadena a mano.
  function itemKeysUsados(modelo) {
    const keys = new Set();
    Object.values(modelo.computo || {}).forEach(l => { if (l.itemKey) keys.add(l.itemKey); });
    (modelo.auxiliares || []).forEach(a => { if (a.itemKey) keys.add(a.itemKey); });
    return keys;
  }

  /* Las once fuentes de window.leerFuentesObra, recortadas a lo que esta obra
     usa. El recorte no se toma por fe: quien cierra reconstruye el modelo
     desde esta foto y lo compara contra el vivo antes de guardar nada
     (verificarSnapshot, más abajo). */
  window.armarSnapshotCierre = function (modelo) {
    const obraKey = modelo.obraKey;

    // La obra entera menos dos nodos: `cierres` —si entrara, cada cierre
    // contendría a los anteriores y el nodo crecería en potencias— y
    // `cotizaciones`, que son archivos de proveedor y no participan del
    // cálculo. Todo lo demás (computo, rubrosComputo, auxiliares, roles,
    // cargaFija, planAvance, encabezado, export, paramsMO, paramsEquipos,
    // dolar, presupuestoOficial, numeración) viaja tal cual.
    const obra = { ...modelo.obra };
    delete obra.cierres;
    delete obra.cotizaciones;

    const items = {};
    const refsMaterial = new Set();
    const refsEquipo   = new Set();

    itemKeysUsados(modelo).forEach(itemKey => {
      const it = modelo.catalogos.items.find(i => i.key === itemKey);
      if (!it) return;
      const base = { ...it };
      delete base.key;                 // la key es el nombre del nodo, no un campo
      const versiones = base.versionesObra;
      delete base.versionesObra;
      // De cada ítem va SÓLO la versión de esta obra, no las de las otras
      // veinte. Sin versión propia manda el ítem plano, igual que en vivo
      // (window.versionDeItem, js/calcCostos.js).
      const propia = versiones && versiones[obraKey];
      if (propia) base.versionesObra = { [obraKey]: propia };
      items[itemKey] = base;

      Object.values((propia || base).lineas || {}).forEach(l => {
        if (!l.refKey) return;
        if (l.tipo === 'material') refsMaterial.add(l.refKey);
        else if (l.tipo === 'equipo') refsEquipo.add(l.refKey);
      });
    });

    // De cada material va el precio YA RESUELTO por window.resolverPreciosObra,
    // guardado bajo la key de esta obra. Así el fallback "el precio de fecha
    // más reciente entre todas las obras" (precioDefaultDe, js/calcCostos.js)
    // queda congelado sin tener que tocar esa función: sobre la foto,
    // resolverPreciosObra encuentra precio propio y devuelve lo mismo.
    const materiales = {};
    refsMaterial.forEach(key => {
      const m = modelo.catalogos.materiales.find(x => x.key === key);
      if (!m) return;
      const base = { ...m };
      delete base.key;
      delete base.precios;
      const precio = modelo.preciosObra[key];
      if (precio) base.precios = { [obraKey]: precio };
      materiales[key] = base;
    });

    const equipos = {};
    refsEquipo.forEach(key => {
      const e = modelo.catalogos.equipos.find(x => x.key === key);
      if (!e) return;
      const base = { ...e };
      delete base.key;
      equipos[key] = base;
    });

    return { obra, items, materiales, equipos };
  };

  /* Las once fuentes de vuelta, desde la foto. Ocho de ellas salen del propio
     nodo de la obra, que se guardó entero. */
  window.fuentesDesdeCierre = function (datos) {
    const obra = datos.obra || {};
    const cargaFija = obra.cargaFija || {};
    return {
      obra,
      computo:     obra.computo       || null,
      rubros:      obra.rubrosComputo || null,
      auxiliares:  obra.auxiliares    || null,
      items:       datos.items        || null,
      materiales:  datos.materiales   || null,
      equipos:     datos.equipos      || null,
      roles:       obra.roles         || null,
      cfLineas:    cargaFija.lineas   || null,
      cfConfig:    cargaFija.config   || null,
      encabezado:  obra.encabezado    || null,
    };
  };

  /* Modelo completo (presupuesto + plan + insumos) a partir de una foto.
     Es la misma cadena que corre sobre datos vivos — de eso se trata. */
  window.modeloDesdeCierre = async function (obraKey, datos) {
    const modelo = await window.cargarPresupuestoObra(obraKey, { fuentes: window.fuentesDesdeCierre(datos) });
    if (!modelo) return null;
    const planDatos = await window.cargarPlanAvanceObra(obraKey, { planAvance: (datos.obra || {}).planAvance || {} });
    const plan = modelo.k == null ? null : window.calcPlanAvance(
      window.gruposRubroDesdePresupuesto(modelo), planDatos.config, planDatos.distItems, planDatos.distRubros);
    return { modelo, plan, planConfig: planDatos.config };
  };

  /* ===== La huella =====

     Números, no estructura: es lo que se compara para saber si el cierre
     sigue dando lo mismo. Se guarda con claves nombradas y no con arrays
     porque la base borra los nulos, y un array con un hueco vuelve como
     objeto de índices — un formato que cambia de forma según los datos no
     sirve para comparar.

     Las líneas salen del árbol de rubros, o sea lo que se ve en pantalla. Una
     línea del Cómputo que apunte a un rubro inexistente no tiene fila propia
     acá, pero sí entra al `total` (ver presupuestoDatos.js), así que un cambio
     suyo igual queda detectado. */
  window.huellaDeCierre = function (modelo, plan, insumos) {
    const h = {
      costoComputo: num(modelo.costoComputo),
      k:            num(modelo.k),
      total:        num(modelo.total),
      gastosFijos:  num(modelo.cargaFija.gastosFijos),
      precioSinIva: num(modelo.cargaFija.precioSinIva),
      precioConIva: num(modelo.cargaFija.precioConIva),
      lineas: {}, rubros: {}, auxiliares: {},
    };

    modelo.rubros.forEach(r => {
      h.rubros[r.key] = { costo: num(r.subtotalCosto), total: num(r.subtotal) };
      r.lineas.forEach(l => {
        h.lineas[l.key] = { cu: num(l.costoUnitario), pu: num(l.precioUnitario), tot: num(l.total) };
      });
    });

    (modelo.auxiliares || []).forEach(a => {
      h.auxiliares[a.key] = { cu: num(a.costoUnitario), tot: num(a.costoTotal) };
    });

    if (plan) {
      h.plan = { total: num(plan.total), anticipo: num(plan.anticipoMonto), periodos: {} };
      for (let i = 0; i < plan.n; i++) {
        h.plan.periodos[window.pkPeriodo(i)] = {
          certif: num(plan.parcialMonto[i]),
          acum:   num(plan.acumMonto[i]),
        };
      }
    }

    // De Insumos alcanza con el total de cada grupo: las cantidades salen del
    // mismo Cómputo y las mismas recetas que ya compara el presupuesto línea
    // por línea, así que lo único que esto agrega —y para lo único que hace
    // falta— es detectar un cambio en js/insumosDatos.js.
    if (insumos) {
      h.insumos = {
        materiales: num(insumos.materiales.costoTotal),
        equipos:    num(insumos.equipos.costoTotal),
        manoDeObra: num(insumos.manoDeObra.costoTotal),
      };
    }

    return h;
  };

  // Nombres con los que se muestra cada diferencia. Los de primer nivel son
  // fijos; los de línea/rubro/auxiliar/período se resuelven contra el modelo
  // recalculado, en etiquetaDeDif.
  const ETIQUETAS = {
    costoComputo: 'Costo del Cómputo', k: 'Coeficiente K', total: 'Total del Presupuesto',
    gastosFijos: 'Gastos fijos (Carga Fija)', precioSinIva: 'Precio sin IVA', precioConIva: 'Precio con IVA',
    cu: 'costo unitario', pu: 'precio unitario', tot: 'total', costo: 'costo',
    certif: 'certificación', acum: 'acumulado', anticipo: 'Anticipo',
  };

  /* Compara dos huellas y devuelve las diferencias, con la ruta de cada una:
     ['total'], ['lineas', '<key>', 'pu'], ['plan', 'periodos', 'p3', 'acum']…
     Recorre las dos por igual, así una clave que aparece en una sola (una
     línea que dejó de calcularse, por ejemplo) también sale listada. */
  window.compararHuellas = function (guardada, recalculada) {
    const difs = [];

    function recorrer(a, b, ruta) {
      if (difs.length >= 200) return;   // un cambio de fórmula difiere en todo; no hace falta listarlo entero
      const esObj = v => v !== null && typeof v === 'object';
      if (esObj(a) || esObj(b)) {
        const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
        keys.forEach(k => recorrer((a || {})[k], (b || {})[k], ruta.concat(k)));
        return;
      }
      if (!iguales(a, b)) difs.push({ ruta, guardado: num(a), recalculado: num(b) });
    }

    recorrer(guardada, recalculada, []);
    return difs;
  };

  /* Texto legible de una diferencia. `modelo` es el recalculado desde la foto:
     de ahí salen el número y el nombre de cada línea, rubro y auxiliar. */
  window.etiquetaDeDif = function (dif, modelo) {
    const [nivel, key, campo] = dif.ruta;
    const sufijo = ETIQUETAS[campo] || campo || '';

    if (nivel === 'lineas' || nivel === 'rubros') {
      let nombre = key;
      (modelo.rubros || []).forEach(r => {
        if (nivel === 'rubros' && r.key === key) nombre = `${r.numero} ${r.nombre}`;
        if (nivel === 'lineas') r.lineas.forEach(l => { if (l.key === key) nombre = `${l.numero} ${l.nombre}`; });
      });
      return `${nombre} · ${sufijo}`;
    }
    if (nivel === 'auxiliares') {
      const a = (modelo.auxiliares || []).find(x => x.key === key);
      return `${a ? `${a.numero} ${a.nombre}` : key} · ${sufijo}`;
    }
    if (nivel === 'plan') {
      if (key === 'periodos') return `Plan de Avance · período ${dif.ruta[2]} · ${ETIQUETAS[dif.ruta[3]] || dif.ruta[3]}`;
      return `Plan de Avance · ${ETIQUETAS[key] || key}`;
    }
    if (nivel === 'insumos') return `Insumos · ${ETIQUETAS[key] || key}`;
    return ETIQUETAS[nivel] || nivel;
  };

  /* ===== Cerrar =====

     Se arma la foto, se reconstruye el modelo DESDE la foto y se compara
     contra el vivo. Si algo difiere no se guarda nada: un cierre que nace
     mintiendo no sirve para nada, y lo único que puede hacerlo diferir es un
     recorte incompleto (un ítem, un material o un equipo que no se llevó).

     Devuelve { ok: true, cierreKey } o { ok: false, difs, modelo }. */
  window.cerrarPresupuesto = async function (modelo, plan, insumos, meta) {
    const obraKey = modelo.obraKey;
    const datos = window.armarSnapshotCierre(modelo);
    // El catálogo de rubros de Biblioteca no entra al cálculo, pero sí a lo que
    // muestran el Cómputo y el A.P (js/computo.js, js/item.js) cuando se los
    // abre parados en esta versión. Es chico y se lee acá, que es lo único
    // asincrónico de armar la foto.
    const rubros = await _fbGet('/rubros.json');
    if (rubros) datos.rubros = rubros;
    const huellaViva = window.huellaDeCierre(modelo, plan, insumos);

    // JSON ida y vuelta: la foto tiene que sobrevivir al viaje a la base, y
    // así de paso se verifica sobre exactamente lo que se va a guardar.
    const datosGuardables = JSON.parse(JSON.stringify(datos));
    const rehecho = await window.modeloDesdeCierre(obraKey, datosGuardables);
    if (!rehecho) return { ok: false, difs: [{ ruta: ['obra'], guardado: null, recalculado: null }], modelo: null };

    const insumosRehechos = window.calcularInsumosObra(rehecho.modelo);
    const huellaFoto = window.huellaDeCierre(rehecho.modelo, rehecho.plan, insumosRehechos);
    const difs = window.compararHuellas(huellaViva, huellaFoto);
    if (difs.length) return { ok: false, difs, modelo: rehecho.modelo };

    const cierreKey = 'cierre_' + Date.now();
    const usuario = (window._authUsuario && window._authUsuario()) || {};
    const cierre = {
      meta: {
        nombre: meta.nombre,
        notas: meta.notas || null,
        fecha: new Date().toISOString(),
        // Repetido de `resultado` a propósito: la lista de cierres muestra el
        // total de cada uno y con esto le alcanza con leer `meta`, sin bajar
        // fotos que pesan lo que pesa la obra entera.
        total: num(modelo.total),
        autorMail: usuario.mail || null,
        autorNombre: usuario.nombre || null,
        appVersion: window.APP_VERSION || null,
      },
      datos: datosGuardables,
      resultado: huellaViva,
    };

    // Fuera de la pila de deshacer: la foto pesa lo que pesa la obra entera y
    // la pila vive en memoria. Para revertir un cierre está anular, que deja
    // rastro — que es justamente lo que se quiere de una oferta enviada.
    await window.undoOmitir(() => _fbPut(`/obras/${obraKey}/cierres/${cierreKey}.json`, cierre));
    return { ok: true, cierreKey };
  };

  /* Abrir un cierre: el modelo reconstruido desde la foto más el veredicto de
     la huella. `difs` vacío = el cierre sigue dando exactamente lo que se
     envió. Con diferencias, el número que vale sigue siendo el de
     `cierre.resultado` — la foto se recalculó con otro motor. */
  window.abrirCierre = async function (obraKey, cierre) {
    const rehecho = await window.modeloDesdeCierre(obraKey, cierre.datos);
    if (!rehecho) return null;
    const insumos = window.calcularInsumosObra(rehecho.modelo);
    const huellaHoy = window.huellaDeCierre(rehecho.modelo, rehecho.plan, insumos);
    return {
      ...rehecho,
      insumos,
      difs: window.compararHuellas(cierre.resultado || {}, huellaHoy),
    };
  };

  /* Marcar una versión como la que se presentó. No cambia nada del cálculo: es
     para encontrarla entre las de trabajo, y para que no se la pueda borrar
     —una oferta enviada sólo se anula, dejando el rastro. */
  window.marcarVersionEnviada = async function (obraKey, cierreKey, enviada) {
    await window.undoOmitir(() => _fbPatch(`/obras/${obraKey}/cierres/${cierreKey}/meta.json`,
      { enviada: enviada ? true : null }));
  };

  /* Borrar una versión de trabajo. Una marcada como enviada no se borra: para
     eso está anular, que conserva los números. */
  window.borrarVersion = async function (obraKey, cierreKey) {
    const meta = await _fbGet(`/obras/${obraKey}/cierres/${cierreKey}/meta.json`);
    if (meta && meta.enviada) throw new Error('Una versión marcada como enviada no se borra: anulala.');
    // Fuera de la pila de deshacer, igual que al guardarla: la foto pesa lo que
    // pesa la obra entera y la pila vive en memoria.
    await window.undoOmitir(() => _fbDel(`/obras/${obraKey}/cierres/${cierreKey}.json`));
  };

  /* ===== Restaurar =====

     Devolver la obra a una versión guardada. Es el otro lado del uso real: los
     A.P. se arman con los costos reales, se guarda una versión, se los retoca
     para llegar al precio final — y después se puede volver a los reales.

     Se restaura **sólo lo de la obra**. El catálogo global (la ficha de cada
     equipo, el nombre y la unidad de materiales e ítems) no se toca: es
     compartido, y reponerle una foto le movería el costo a todas las otras
     obras que use esas máquinas. Lo que sí se hace es decir qué quedó distinto,
     para decidirlo a mano — ver difsCatalogoGlobal. */

  // Sub-nodos de la obra que forman su presupuesto. Se restauran enteros (PUT):
  // volver a una versión es reemplazar la lista, no mezclarla. Quedan afuera a
  // propósito la identidad (nombre, ubicación, año), el estado, el candado de
  // modo lectura, las cotizaciones (archivos de proveedor) y los cierres.
  const NODOS_OBRA = ['computo', 'rubrosComputo', 'computoRubros', 'auxiliares', 'roles',
                      'cargaFija', 'planAvance', 'encabezado', 'export', 'datosExtra',
                      'paramsMO', 'paramsEquipos', 'dolar'];
  const CAMPOS_OBRA = ['presupuestoOficial', 'sinRubros', 'numeracionPersonalizada',
                       'estiloNumeracion', 'encabezadoSembrado'];

  // Campos de la ficha de un equipo que entran al costo diario
  // (calcDesgloseCostoEquipo). Son los que importa avisar si cambiaron.
  const CAMPOS_EQUIPO = ['costoUSD', 'vidaUtil', 'usoAnual', 'potencia', 'consumoCombustibleLtsPorHp'];

  /* Qué difiere hoy, en el catálogo global, respecto de la foto. Lo que esta
     lista muestra es justamente lo que restaurar NO va a arreglar. */
  window.difsCatalogoGlobal = async function (datos) {
    const [equiposHoy, materialesHoy, itemsHoy] = await Promise.all([
      _fbGet('/equipos.json'), _fbGet('/materiales.json'), _fbGet('/items.json'),
    ]);
    const difs = [];

    Object.entries(datos.equipos || {}).forEach(([key, foto]) => {
      const hoy = (equiposHoy || {})[key];
      const nombre = `${foto.tipo || ''} ${foto.codigo || ''}`.trim() || key;
      if (!hoy) { difs.push({ tipo: 'Equipo', nombre, campo: '—', enVersion: 'existía', hoy: 'ya no está' }); return; }
      CAMPOS_EQUIPO.forEach(c => {
        if ((foto[c] ?? null) !== (hoy[c] ?? null)) {
          difs.push({ tipo: 'Equipo', nombre, campo: c, enVersion: foto[c] ?? '—', hoy: hoy[c] ?? '—' });
        }
      });
    });

    [['Material', datos.materiales, materialesHoy], ['Ítem', datos.items, itemsHoy]].forEach(([tipo, fotoMapa, hoyMapa]) => {
      Object.entries(fotoMapa || {}).forEach(([key, foto]) => {
        const hoy = (hoyMapa || {})[key];
        const nombre = foto.nombre || key;
        if (!hoy) { difs.push({ tipo, nombre, campo: '—', enVersion: 'existía', hoy: 'ya no está' }); return; }
        ['nombre', 'unidad'].forEach(c => {
          if ((foto[c] ?? null) !== (hoy[c] ?? null)) {
            difs.push({ tipo, nombre, campo: c, enVersion: foto[c] ?? '—', hoy: hoy[c] ?? '—' });
          }
        });
      });
    });

    return difs;
  };

  /* Escribe la foto sobre la obra. El llamador ya guardó una versión del estado
     actual antes de llamar acá, así que restaurar nunca pierde nada.

     Las raíces del agrupado van en null a propósito: /items y /materiales son
     compartidos, y sacarles una foto entera para poder reponerla borraría lo
     que otro haya agregado ahí mientras tanto (ver CLAUDE.md). Cada escritura
     se anota por separado. */
  window.restaurarVersion = async function (obraKey, datos) {
    const obraFoto = datos.obra || {};

    await window.undoAgrupar('Restaurar versión', null, async () => {
      for (const nodo of NODOS_OBRA) {
        const valor = obraFoto[nodo];
        if (valor === undefined || valor === null) await _fbDel(`/obras/${obraKey}/${nodo}.json`);
        else await _fbPut(`/obras/${obraKey}/${nodo}.json`, valor);
      }

      const campos = {};
      CAMPOS_OBRA.forEach(c => { campos[c] = obraFoto[c] === undefined ? null : obraFoto[c]; });
      await _fbPatch(`/obras/${obraKey}.json`, campos);

      // Los A.P. de esta obra. `versionesObra/{obraKey}` no toca la receta que
      // esa misma ficha tenga en otra obra — que es todo el punto de que las
      // recetas vivan ahí y no en la raíz del ítem.
      // Un ítem que la obra empezó a usar después de esta versión conserva su
      // receta: no está en la foto y no hay con qué reponerlo. No molesta,
      // porque el Cómputo restaurado tampoco lo referencia.
      for (const [itemKey, item] of Object.entries(datos.items || {})) {
        const version = item.versionesObra && item.versionesObra[obraKey];
        if (version) await _fbPut(`/items/${itemKey}/versionesObra/${obraKey}.json`, version);
        else await _fbDel(`/items/${itemKey}/versionesObra/${obraKey}.json`);
      }

      // Precio de cada material para esta obra. Ojo: si en la versión el precio
      // venía del respaldo (el más reciente de otra obra, ver precioDefaultDe),
      // restaurarlo le deja a esta obra un precio propio que antes no tenía.
      // Es lo que hace falta para reproducir el número.
      for (const [matKey, mat] of Object.entries(datos.materiales || {})) {
        const precio = mat.precios && mat.precios[obraKey];
        if (precio) await _fbPut(`/materiales/${matKey}/precios/${obraKey}.json`, precio);
      }
    });
  };

  window.anularCierre = async function (obraKey, cierreKey, motivo) {
    const usuario = (window._authUsuario && window._authUsuario()) || {};
    await window.undoOmitir(() => _fbPatch(`/obras/${obraKey}/cierres/${cierreKey}/meta.json`, {
      anulado: { fecha: new Date().toISOString(), motivo: motivo || null, autorMail: usuario.mail || null },
    }));
  };

})();
