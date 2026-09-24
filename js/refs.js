/* VIMECO S.A. — Referencias vivas entre celdas.

   Una fórmula "=" de un campo puede apuntar a otra celda de la pantalla en vez
   de a un número congelado: se clickea la celda mientras se escribe la fórmula
   y queda la referencia. Si después cambia la celda de origen, el campo se
   recalcula solo — igual que Excel.

   Tres formas del mismo texto:
     guardada  =@{computo:linea:-Nabc:total}+1200     ← va a Firebase
     visible   =[1.2 Desmonte · Total]+1200           ← lo que se ve al editar
     evaluable =(26059.96)+1200                       ← lo que come evalFormula

   Las direcciones (data-calc-id) salen de las claves de los datos, no de la
   posición en pantalla: reordenar o filtrar no rompe una fórmula. El registro
   se arma leyendo el DOM ya renderizado, así que una pantalla sólo tiene que
   emitir los atributos en sus celdas (ver calcAttrs) y no llevar ningún
   índice aparte.

   Sólo se puede referenciar lo que está en la misma pantalla, que es también
   lo único que se puede clickear. */

(function () {
  const RE_REF_CANONICA = /@\{([^}]+)\}/g;
  const RE_REF_VISIBLE  = /\[([^\]]+)\]/g;

  /* ===== Emisión de celdas referenciables ===== */

  // Atributos para una celda que se puede referenciar. Se usa en los
  // templates de cada pantalla, al lado del valor que ya se mostraba.
  // valor: número real (no el texto formateado); id: dirección estable;
  // label: cómo se va a leer la referencia dentro de la fórmula.
  window.calcAttrs = function (valor, id, label) {
    if (valor == null || isNaN(valor)) return '';
    return ` data-calc-valor="${valor}" data-calc-id="${escHtml(id)}" data-calc-label="${escHtml(label)}"`;
  };

  /* ===== Registro (se arma del DOM, después de cada render) ===== */

  // { id: { valor, label } } + índice inverso por label. Los labels repetidos
  // se desambiguan con " #2", " #3" en orden de aparición.
  function registro() {
    const porId = {};
    const porLabel = {};
    const vistos = {};
    document.querySelectorAll('[data-calc-id]').forEach(el => {
      const id = el.dataset.calcId;
      if (porId[id]) return;
      let label = el.dataset.calcLabel || id;
      vistos[label] = (vistos[label] || 0) + 1;
      if (vistos[label] > 1) label += ' #' + vistos[label];
      const valor = parseFloat(el.dataset.calcValor);
      porId[id] = { valor: isNaN(valor) ? null : valor, label };
      porLabel[label.toLowerCase()] = id;
    });
    return { porId, porLabel };
  }

  window.refsRegistro = registro;

  // "Tiene referencias" = hay que recalcularla sola cuando cambia algo, sin
  // esperar a que alguien la retoque a mano: además de "@{id}" (celda de esta
  // pantalla), cuenta una "k" o "us" sueltas (Coeficiente K / dólar de la
  // obra — ver setRefK y cotizacionVista en calc.js), que no dependen de
  // ninguna celda de ESTA pantalla en particular.
  const RE_K_US = /(^|[^a-zA-Z])(k|us)([^a-zA-Z]|$)/i;
  window.formulaTieneRefs = f => !!f && (/@\{/.test(f) || RE_K_US.test(f));

  /* ===== Las tres formas del texto ===== */

  window.refsAVisible = function (formula) {
    if (!formula) return formula;
    const { porId } = registro();
    return formula.replace(RE_REF_CANONICA, (_, id) =>
      '[' + (porId[id] ? porId[id].label : '#REF!') + ']');
  };

  window.refsACanonica = function (texto) {
    if (!texto || !texto.includes('[')) return texto;
    const { porLabel } = registro();
    return texto.replace(RE_REF_VISIBLE, (todo, label) => {
      const id = porLabel[label.trim().toLowerCase()];
      return id ? '@{' + id + '}' : todo;   // label desconocido: se deja, la fórmula no valida
    });
  };

  // Reemplaza cada referencia por su valor de hoy. Va entre paréntesis para
  // que un valor negativo no se coma el operador de al lado.
  window.refsResolver = function (expr) {
    if (!expr || !expr.includes('@{')) return expr;
    const { porId } = registro();
    return expr.replace(RE_REF_CANONICA, (_, id) => {
      const celda = porId[id];
      if (!celda || celda.valor == null) throw new Error('#REF!');
      return '(' + celda.valor + ')';
    });
  };

  /* ===== Recálculo ===== */

  // campos: [{ formula, valor, aplicar(nuevoValor) }] — una pantalla le pasa
  // todos sus campos con fórmula después de renderizar. Devuelve true si algún
  // valor cambió (el llamador re-renderiza y vuelve a llamar, con tope de
  // pasadas para cortar las referencias circulares).
  window.recalcularCeldasVivas = function (campos) {
    let cambios = 0;
    (campos || []).forEach(c => {
      if (!window.formulaTieneRefs(c.formula)) return;
      let nuevo;
      try {
        nuevo = window.roundLimpio(window.evalFormula(window.refsResolver(c.formula.slice(1))));
      } catch (_) {
        return;   // #REF! (celda borrada): se conserva el último valor calculado
      }
      if (nuevo === c.valor) return;
      cambios++;
      c.aplicar(nuevo);
    });
    return cambios > 0;
  };

  /* ===== Selección por click ===== */

  // Campo con fórmula que se está editando ahora mismo.
  function campoEnEdicion() {
    const el = document.activeElement;
    return el && el.dataset && el.dataset.calc === '1' ? el : null;
  }

  // …y sólo si además está en modo fórmula: ahí es cuando clickear una celda
  // inserta una referencia en vez de mover el foco.
  function campoActivo() {
    const el = campoEnEdicion();
    return el && el.value.trim().startsWith('=') ? el : null;
  }

  // esValor: lo que se inserta es un operando (una celda, pi, raiz) y no un
  // operador. Sólo en ese caso se antepone un "+" cuando justo antes del
  // cursor ya terminaba otro operando — si no, clickear "÷" escribía "+/".
  function insertarEnCursor(input, texto, esValor) {
    const start = input.selectionStart != null ? input.selectionStart : input.value.length;
    const end   = input.selectionEnd   != null ? input.selectionEnd   : input.value.length;
    const antes = input.value.slice(0, start);
    const despues = input.value.slice(end);
    const necesitaOperador = esValor && antes.length > 1 && !/[+\-*/^(=]$/.test(antes);
    const insercion = (necesitaOperador ? '+' : '') + texto;
    input.value = antes + insercion + despues;
    const pos = start + insercion.length;
    input.setSelectionRange(pos, pos);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Reemplaza el tramo [ini, fin) del campo por texto. Va por execCommand y
  // no asignando value, así el Ctrl+Z propio del campo lo sigue deshaciendo;
  // el fallback queda para el navegador que no lo soporte.
  function reemplazarTramo(input, ini, fin, texto) {
    input.setSelectionRange(ini, fin);
    const ok = texto ? document.execCommand('insertText', false, texto) : document.execCommand('delete');
    if (ok) return;
    input.value = input.value.slice(0, ini) + texto + input.value.slice(fin);
    input.setSelectionRange(ini + texto.length, ini + texto.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Tramos [ini, fin) de cada referencia "[…]" del texto visible.
  function tramosRefs(texto) {
    const out = [];
    let m;
    RE_REF_VISIBLE.lastIndex = 0;
    while ((m = RE_REF_VISIBLE.exec(texto))) out.push([m.index, m.index + m[0].length]);
    return out;
  }

  // Una referencia se borra entera o no se borra: dejar "[Oficial · Canti"
  // no apunta a nada y la fórmula queda rota. Devuelve el tramo a borrar si
  // el borrado toca alguna referencia, o null para dejar el borrado nativo.
  function tramoABorrar(input, tecla) {
    let ini = input.selectionStart, fin = input.selectionEnd;
    if (ini == null) return null;
    const refs = tramosRefs(input.value);
    if (ini === fin) {
      // Borrar atrás justo después del "]", o adelante justo antes del "[",
      // también cuenta: es el caracter de la referencia el que se borraría.
      const r = refs.find(([a, b]) => tecla === 'Backspace' ? a < ini && ini <= b : a <= ini && ini < b);
      return r || null;
    }
    let toca = false;
    refs.forEach(([a, b]) => {
      if (a < fin && ini < b && (a < ini || b > fin)) {
        ini = Math.min(ini, a); fin = Math.max(fin, b); toca = true;
      }
    });
    return toca ? [ini, fin] : null;
  }

  document.addEventListener('keydown', e => {
    if (e.key !== 'Backspace' && e.key !== 'Delete') return;
    const input = campoActivo();
    if (!input || e.target !== input) return;
    const tramo = tramoABorrar(input, e.key);
    if (!tramo) return;
    e.preventDefault();
    reemplazarTramo(input, tramo[0], tramo[1], '');
  }, true);

  function marcarSeleccionadas(input) {
    document.querySelectorAll('.celda-ref-usada').forEach(el => el.classList.remove('celda-ref-usada'));
    if (!input) return;
    const texto = input.value;
    document.querySelectorAll('[data-calc-label]').forEach(el => {
      const label = el.dataset.calcLabel;
      if (label && texto.includes('[' + label)) el.classList.add('celda-ref-usada');
    });
  }

  document.addEventListener('mousedown', e => {
    const input = campoActivo();
    if (!input) return;
    if (e.target.closest('.barra-formula')) { e.preventDefault(); return; }
    // Otra celda: no le saca el foco al campo. La propia se deja pasar, que
    // también es referenciable y sin esto no había forma de poner el cursor
    // en el medio de la fórmula ni de seleccionar con doble click.
    const celda = e.target.closest('[data-calc-id]');
    if (celda && celda !== input) e.preventDefault();
  }, true);

  document.addEventListener('click', e => {
    const input = campoActivo();
    if (!input) return;
    const celda = e.target.closest('[data-calc-id]');
    if (!celda || celda === input) return;
    const entrada = registro().porId[celda.dataset.calcId];
    if (!entrada || entrada.valor == null) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    insertarEnCursor(input, '[' + entrada.label + ']', true);
    celda.classList.add('celda-ref-flash');
    setTimeout(() => celda.classList.remove('celda-ref-flash'), 350);
    actualizarBarra(input);
  }, true);

  /* ===== Mini-barra de fórmula ===== */

  // Barra fija en una esquina (abajo a la derecha; abajo a lo ancho en el
  // celular) mientras se edita una fórmula: muestra el resultado en vivo y
  // los mismos átomos que la calculadora (π, √, ^…), que en el celular no hay
  // forma cómoda de tipear. NO se pega al campo a propósito: pegada tapaba
  // justo las celdas de al lado, que son las que hay que poder clickear.
  // Además, salvo el renglón de la fórmula y los botones, no recibe clicks
  // (ver pointer-events en el CSS): lo que quede abajo se puede seguir
  // clickeando.
  // [texto a insertar, texto del botón, es operando]
  const BOTONES = [
    ['+', '+', false], ['-', '−', false], ['*', '×', false], ['/', '÷', false], ['^', '^', false],
    ['(', '(', false], [')', ')', false], ['pi', 'π', true], ['raiz(', '√', true],
  ];

  let barraEl = null;

  function crearBarra() {
    barraEl = document.createElement('div');
    barraEl.className = 'barra-formula';
    barraEl.innerHTML = `
      <div class="barra-formula-texto"></div>
      <div class="barra-formula-resultado"></div>
      <div class="barra-formula-ops">${BOTONES.map(([valor, texto, esValor]) =>
        `<button type="button" data-ins="${escHtml(valor)}"${esValor ? ' data-operando="1"' : ''}>${escHtml(texto)}</button>`).join('')}</div>
      <div class="barra-formula-hint">Clickeá una celda para usar su valor. Enter confirma, Esc cancela.</div>`;
    document.body.appendChild(barraEl);
    barraEl.querySelectorAll('[data-ins]').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = campoActivo();
        if (input) { insertarEnCursor(input, btn.dataset.ins, btn.dataset.operando === '1'); actualizarBarra(input); }
      });
    });
    engancharTextoEditable(barraEl.querySelector('.barra-formula-texto'));
    return barraEl;
  }

  /* --- El renglón de la fórmula se edita como la celda --- */

  // El renglón NO es un campo aparte: el foco nunca sale de la celda. Si
  // saliera, la celda haría su blur, guardaría la fórmula a medio escribir y
  // la pantalla se volvería a pintar. Lo que se ve acá es un espejo de la
  // celda con su cursor y su selección dibujados; un click en el renglón
  // mueve el cursor de la celda, y lo que se tipea después entra en la celda
  // (y se refleja acá) como en cualquier otro momento.

  function pintarTexto(input) {
    const caja = barraEl.querySelector('.barra-formula-texto');
    const v = input.value;
    const ini = input.selectionStart != null ? input.selectionStart : v.length;
    const fin = input.selectionEnd != null ? input.selectionEnd : ini;
    caja.textContent = '';
    caja.appendChild(document.createTextNode(v.slice(0, ini)));
    const marca = document.createElement('span');
    if (fin > ini) {
      marca.className = 'barra-formula-sel';
      marca.textContent = v.slice(ini, fin);
    } else {
      marca.className = 'barra-formula-cursor';
    }
    caja.appendChild(marca);
    caja.appendChild(document.createTextNode(v.slice(fin)));
    // Fórmula larga: que el cursor no quede fuera de la parte visible.
    const arriba = marca.offsetTop - caja.offsetTop;
    if (arriba < caja.scrollTop) caja.scrollTop = arriba;
    else if (arriba + marca.offsetHeight > caja.scrollTop + caja.clientHeight) caja.scrollTop = arriba + marca.offsetHeight - caja.clientHeight;
  }

  // Posición dentro del texto de la fórmula del punto clickeado.
  function posicionEnTexto(caja, x, y) {
    let nodo = null, off = 0;
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (p) { nodo = p.offsetNode; off = p.offset; }
    } else if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      if (r) { nodo = r.startContainer; off = r.startOffset; }
    }
    const total = caja.textContent.length;
    if (!nodo || !caja.contains(nodo)) {
      // Arrastrando fuera del renglón: se estira hasta la punta más cercana.
      const r = caja.getBoundingClientRect();
      if (y > r.bottom || (y >= r.top && x > r.right)) return total;
      if (y < r.top || x < r.left) return 0;
      return null;
    }
    // Un nodo que no es texto (la caja, el span del cursor): el offset cuenta
    // hijos, no caracteres.
    if (nodo.nodeType !== Node.TEXT_NODE) {
      const hijo = nodo.childNodes[off];
      if (!hijo) return nodo === caja ? total : posDeNodo(caja, nodo) + nodo.textContent.length;
      return posDeNodo(caja, hijo);
    }
    return posDeNodo(caja, nodo) + off;
  }

  // Cuántos caracteres de la caja hay antes de un nodo.
  function posDeNodo(caja, nodo) {
    let pos = 0;
    const w = document.createTreeWalker(caja, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (n === nodo || nodo.contains(n)) break;
      pos += n.textContent.length;
    }
    return pos;
  }

  // Doble click: la referencia entera, o el número / la palabra de ese lugar.
  function tramoDePalabra(texto, pos) {
    const ref = tramosRefs(texto).find(([a, b]) => a <= pos && pos < b);
    if (ref) return ref;
    const esPalabra = c => /[0-9.,a-zA-Z]/.test(c || '');
    let a = pos, b = pos;
    while (a > 0 && esPalabra(texto[a - 1])) a--;
    while (b < texto.length && esPalabra(texto[b])) b++;
    return [a, b];
  }

  function engancharTextoEditable(caja) {
    let ancla = null;

    const aplicar = (input, a, b) => {
      input.setSelectionRange(Math.min(a, b), Math.max(a, b), b < a ? 'backward' : 'forward');
      pintarTexto(input);
    };

    // El preventDefault del mousedown (listener de captura de más arriba) es
    // lo que deja el foco en la celda; acá sólo se mueve su cursor.
    caja.addEventListener('mousedown', e => {
      const input = campoActivo();
      if (!input || e.button !== 0) return;
      const pos = posicionEnTexto(caja, e.clientX, e.clientY);
      if (pos == null) return;
      if (e.detail >= 2) {
        const [a, b] = tramoDePalabra(input.value, pos);
        ancla = null;
        aplicar(input, a, b);
        return;
      }
      ancla = e.shiftKey ? (input.selectionDirection === 'backward' ? input.selectionEnd : input.selectionStart) : pos;
      aplicar(input, ancla, pos);
    });
    document.addEventListener('mousemove', e => {
      if (ancla == null) return;
      if (!(e.buttons & 1)) { ancla = null; return; }
      const input = campoActivo();
      const pos = input && posicionEnTexto(caja, e.clientX, e.clientY);
      if (pos != null) aplicar(input, ancla, pos);
    });
    document.addEventListener('mouseup', () => { ancla = null; });
  }

  function ocultarBarra() {
    if (barraEl) barraEl.classList.add('hidden');
    document.body.classList.remove('formula-modo');
    marcarSeleccionadas(null);
  }

  function actualizarBarra(input) {
    if (!input) { ocultarBarra(); return; }
    const barra = barraEl || crearBarra();
    barra.classList.remove('hidden');
    document.body.classList.add('formula-modo');

    // La celda es angosta y una fórmula con nombres de celdas no entra: acá se
    // lee entera, como en la barra de fórmulas de Excel.
    pintarTexto(input);

    const res = barra.querySelector('.barra-formula-resultado');
    try {
      const canonica = window.refsACanonica(input.value.trim());
      const valor = window.evalFormula(window.refsResolver(canonica.slice(1)));
      res.textContent = '= ' + window.fmtNum(window.roundLimpio(valor));
      res.classList.remove('barra-formula-error');
    } catch (_) {
      res.textContent = '= …';
      res.classList.add('barra-formula-error');
    }

    marcarSeleccionadas(input);
  }

  document.addEventListener('focusin', () => actualizarBarra(campoActivo()));
  document.addEventListener('input', e => {
    if (e.target && e.target.dataset && e.target.dataset.calc === '1') actualizarBarra(campoActivo());
  });
  // Cursor movido con las flechas, Inicio/Fin o el mouse dentro de la celda:
  // sólo se redibuja el renglón.
  const repintarCursor = () => {
    const input = campoActivo();
    if (input && barraEl && !barraEl.classList.contains('hidden')) pintarTexto(input);
  };
  document.addEventListener('selectionchange', repintarCursor);
  document.addEventListener('keyup', repintarCursor);
  document.addEventListener('mouseup', repintarCursor);
  // Al salir de la celda se cierra. Va por blur en captura y no por
  // focusout: guardar al salir vuelve a pintar la tabla y saca la celda del
  // DOM dentro de su propio blur, y a un nodo que ya no está el navegador no
  // le manda el focusout — la barra quedaba abierta hasta entrar y salir de
  // otra celda.
  document.addEventListener('blur', e => {
    if (e.target && e.target.dataset && e.target.dataset.calc === '1') setTimeout(() => actualizarBarra(campoActivo()), 0);
  }, true);
  // Esc cancela la edición en curso, sea una fórmula o un número tipeado a
  // mano — como en Excel. (No alcanza con mirar si el texto arranca con "=":
  // borrar la fórmula y tipear otra cosa también es una edición en curso.)
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const input = campoEnEdicion();
    if (!input) return;
    e.preventDefault();
    window.cancelarEdicionCampo(input);
    ocultarBarra();
  });
})();
