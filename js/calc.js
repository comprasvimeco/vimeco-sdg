/* VIMECO S.A. — Campos tipo Excel: si un input empieza con "=", lo evalúa como
   fórmula aritmética (+ - * / ^, paréntesis, "pi" y "raiz(...)") al salir del
   campo, sin usar eval(). */

// Redondea sólo lo necesario para eliminar ruido binario de punto flotante
// (ej. 0.1+0.2 = 0.30000000000000004) — no limita la precisión real del
// valor, que puede seguir teniendo tantos decimales como haga falta. Usado
// en todo punto de la app donde se guarda un valor calculado (no tipeado a
// mano), para no arrastrar redondeo prematuro a los cálculos siguientes.
//
// El recorte es a 15 CIFRAS SIGNIFICATIVAS, no a una cantidad fija de
// decimales — mismo criterio que Excel, que también guarda 15 significativas
// sobre un double. La versión anterior redondeaba a 8 decimales con
// Math.round(n * 1e8) / 1e8, que además de poner un techo arbitrario a la
// precisión, con importes grandes hacía lo contrario de lo que promete: a
// partir de ~9e7 el producto n * 1e8 se pasa del entero seguro de JS y el
// redondeo INTRODUCE ruido en vez de sacarlo.
window.roundLimpio = function (n) {
  if (typeof n !== 'number' || !isFinite(n) || n === 0) return n;
  return parseFloat(n.toPrecision(15));
};

(function () {
  function evalFormula(expr) {
    let i = 0;

    function skipWs() { while (expr[i] === ' ') i++; }

    // Acepta los dos separadores decimales: "47.5" (el que inserta la
    // calculadora flotante) y "47,5" (el que se tipea acá). Si el número
    // trae coma, los "." que tenga son agrupación de miles y se descartan
    // ("1.234,56"), mismo criterio que parseMoneyString.
    function parseNumber() {
      skipWs();
      const start = i;
      while (i < expr.length && /[0-9.,]/.test(expr[i])) i++;
      if (start === i) throw new Error('Número inválido');
      // Notación científica ("4.6e+21"): la produce JS solo al escribir un
      // número muy grande o muy chico, así que hay que saber leerla — si no,
      // una fórmula que da un número enorme deja de evaluar de golpe.
      if (/[eE]/.test(expr[i] || '')) {
        const resto = expr.slice(i + 1);
        const m = resto.match(/^[+-]?\d+/);
        if (m) i += 1 + m[0].length;
      }
      const crudo = expr.slice(start, i);
      const n = parseFloat(crudo.includes(',') ? crudo.replace(/\./g, '').replace(',', '.') : crudo);
      if (isNaN(n)) throw new Error('Número inválido');
      return n;
    }

    // Número, constante "pi", función "raiz(...)" o subexpresión entre paréntesis.
    function parseAtom() {
      skipWs();
      if (expr.slice(i, i + 2).toLowerCase() === 'pi' && !/[a-zA-Z]/.test(expr[i + 2] || '')) {
        i += 2;
        return Math.PI;
      }
      if (expr.slice(i, i + 4).toLowerCase() === 'raiz') {
        i += 4;
        skipWs();
        if (expr[i] !== '(') throw new Error('Falta "(" después de raiz');
        i++;
        const v = parseExpr();
        skipWs();
        if (expr[i] !== ')') throw new Error('Falta paréntesis de cierre');
        i++;
        if (v < 0) throw new Error('Raíz de un número negativo');
        return Math.sqrt(v);
      }
      if (expr[i] === '(') {
        i++;
        const v = parseExpr();
        skipWs();
        if (expr[i] !== ')') throw new Error('Falta paréntesis de cierre');
        i++;
        return v;
      }
      return parseNumber();
    }

    // "^" liga más fuerte que el signo unario (igual que en Excel: -2^2 = -4,
    // no 4) y es asociativo a derecha (2^3^2 = 2^(3^2)). El exponente puede
    // tener su propio signo (2^-3).
    function parsePower() {
      const base = parseAtom();
      skipWs();
      if (expr[i] === '^') {
        i++;
        return Math.pow(base, parseUnary());
      }
      return base;
    }

    function parseUnary() {
      skipWs();
      if (expr[i] === '-') { i++; return -parseUnary(); }
      if (expr[i] === '+') { i++; return parseUnary(); }
      return parsePower();
    }

    function parseTerm() {
      let v = parseUnary();
      skipWs();
      while (expr[i] === '*' || expr[i] === '/') {
        const op = expr[i]; i++;
        const rhs = parseUnary();
        v = op === '*' ? v * rhs : v / rhs;
        skipWs();
      }
      return v;
    }

    function parseExpr() {
      let v = parseTerm();
      skipWs();
      while (expr[i] === '+' || expr[i] === '-') {
        const op = expr[i]; i++;
        const rhs = parseTerm();
        v = op === '+' ? v + rhs : v - rhs;
        skipWs();
      }
      return v;
    }

    const result = parseExpr();
    skipWs();
    if (i !== expr.length) throw new Error('Expresión inválida');
    if (!isFinite(result)) throw new Error('Resultado inválido');
    return result;
  }

  // El resultado se escribe con la coma decimal de la app, no con el punto de
  // String(n): los campos de plata leen su contenido con parseMoneyString,
  // que trata al "." como separador de miles — un "47.5" se guardaba como 475
  // (el resto de los campos numéricos ya aceptan los dos separadores).
  function textoResultado(n) {
    const s = window.decimalString ? window.decimalString(n) : String(n);
    return s.replace('.', ',');
  }

  // Ganchos que instala js/refs.js si está cargado, para que una fórmula
  // pueda apuntar a otras celdas. Sin refs.js, todo esto es la identidad y el
  // comportamiento es el de siempre (aritmética pelada).
  //   refsAVisible : "=@{id}+10"  ->  "=[Desmonte · Total]+10"  (lo que se ve)
  //   refsACanonica: el camino inverso (lo que se guarda)
  //   refsResolver : reemplaza cada @{id} por su valor de hoy, antes de evaluar
  const aVisible  = f => (window.refsAVisible  ? window.refsAVisible(f)  : f);
  const aCanonica = t => (window.refsACanonica ? window.refsACanonica(t) : t);
  const resolver  = e => (window.refsResolver  ? window.refsResolver(e)  : e);

  function resolveIfFormula(input) {
    // Esc mientras se editaba: se descarta lo tipeado sin tocar ni el valor ni
    // la fórmula guardada (ver cancelarEdicionCampo).
    if (input.dataset.cancelando) { delete input.dataset.cancelando; return; }
    const raw = input.value.trim();
    if (!raw.startsWith('=')) { delete input.dataset.formula; return; }
    try {
      const canonica = aCanonica(raw);
      const result = evalFormula(resolver(canonica.slice(1)));
      input.dataset.formula = canonica;
      input.value = textoResultado(roundLimpio(result));
    } catch (_) {
      // Fórmula inválida: se deja el texto tal cual para que el usuario la corrija.
    }
  }

  // Sale del campo descartando la edición en curso: vuelve a mostrar el valor
  // que había y conserva la fórmula guardada (Esc, igual que en Excel).
  window.cancelarEdicionCampo = function (input) {
    input.dataset.cancelando = '1';
    const v = input.dataset.valorReal !== undefined ? parseFloat(input.dataset.valorReal) : null;
    input.value = textoMostrado(v);
    input.dataset.textoAlEnfocar = input.value;
    input.blur();
  };

  window.evalFormula = evalFormula;

  // Devuelve la fórmula "=..." que generó el valor actual del campo, o null
  // si el valor fue tipeado directo (sin fórmula, o se sobrescribió una
  // fórmula vieja con un número plano).
  window.getCalcFormula = input => input.dataset.formula || null;

  // Para inputs ESTÁTICOS (el mismo <input> se reutiliza en distintas
  // aperturas de un modal, ej. materiales.js/equipos.js/manoDeObra.js): usar
  // esto al abrir el modal para cargar/limpiar la fórmula guardada, en vez
  // de volver a llamar attachCalcInput (que duplicaría los listeners).
  window.setCalcFormula = function (input, formula) {
    if (formula) input.dataset.formula = formula;
    else delete input.dataset.formula;
  };

  // Enganchar en cualquier <input>: escribir "=15*3+2" y al salir del campo
  // (blur) o Enter, se resuelve a "47" -- guardando la fórmula en el propio
  // input (dataset.formula), así que si el llamador la persiste (ver
  // getCalcFormula) y la vuelve a pasar acá como initialFormula, enfocar el
  // campo de nuevo muestra "=15*3+2" en vez del resultado, igual que Excel.
  window.attachCalcInput = function (input, initialFormula) {
    if (initialFormula) input.dataset.formula = initialFormula;
    input.dataset.calc = '1';   // marca de "campo con fórmula" para js/refs.js

    input.addEventListener('focus', () => {
      if (input.dataset.formula) input.value = aVisible(input.dataset.formula);
    });
    input.addEventListener('blur', () => resolveIfFormula(input));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  };

  /* ===== Valor completo vs. valor mostrado (celda tipo Excel) ===== */

  // El valor de verdad de un campo no es el texto que se ve: vive en
  // dataset.valorReal con toda su precisión, y el texto es apenas su
  // presentación redondeada a los decimales elegidos en el header. Así,
  // pasar por un campo sin tocarlo no puede pisar el valor guardado con la
  // versión recortada que estaba en pantalla.

  function esMoney(input) { return input.dataset.money === '1'; }

  function parseTexto(input, texto) {
    const t = String(texto || '').trim();
    if (!t) return null;
    // Los campos de plata agrupan miles con "." (parseMoneyString los
    // descarta); el resto acepta los dos separadores decimales.
    const n = esMoney(input) ? window.parseMoneyString(t) : parseFloat(t.replace(',', '.'));
    return isNaN(n) ? null : n;
  }

  function textoCompleto(input, valor) {
    if (valor == null) return '';
    return esMoney(input) ? window.formatMoneyString(valor) : textoResultado(valor);
  }

  function textoMostrado(valor) {
    return valor == null ? '' : window.fmtNum(valor);
  }

  // ¿El usuario editó el texto desde que entró al campo? Si no lo tocó, el
  // valor bueno sigue siendo el guardado, no lo que se lee en pantalla.
  function fueEditado(input) {
    return input.dataset.textoAlEnfocar !== undefined && input.value !== input.dataset.textoAlEnfocar;
  }

  // Valor numérico verdadero del campo. Es lo que tienen que leer las
  // pantallas al guardar, en vez de parsear input.value a mano.
  window.valorCampo = function (input) {
    if (fueEditado(input)) return parseTexto(input, input.value);
    if (input.dataset.valorReal !== undefined && input.dataset.valorReal !== '') {
      return parseFloat(input.dataset.valorReal);
    }
    return parseTexto(input, input.value);
  };

  // Reescribe el valor del campo desde afuera (ej. después de recalcular),
  // respetando si está enfocado o no.
  window.setValorCampo = function (input, valor) {
    if (valor == null || isNaN(valor)) delete input.dataset.valorReal;
    else input.dataset.valorReal = String(valor);
    if (document.activeElement === input) {
      if (!input.dataset.formula) input.value = textoCompleto(input, valor);
    } else {
      input.value = textoMostrado(valor);
    }
    // El texto que acaba de pintarse no es una edición del usuario: si no se
    // actualiza la referencia, la próxima lectura tomaría este texto (que
    // puede estar redondeado) como si fuera lo que se tipeó, y perdería la
    // precisión del valor que se está guardando.
    input.dataset.textoAlEnfocar = input.value;
  };

  // Engancha el comportamiento de celda: sin foco, valor redondeado; con
  // foco, valor completo (o su fórmula, que la maneja attachCalcInput).
  // Llamar DESPUÉS de attachCalcInput y attachMoneyInput.
  window.attachValorInput = function (input, valor) {
    window.setValorCampo(input, valor);

    input.addEventListener('focus', () => {
      if (!input.dataset.formula) input.value = textoCompleto(input, window.valorCampo(input));
      input.dataset.textoAlEnfocar = input.value;
      // Entrar al campo selecciona todo, como una celda de Excel: lo que se
      // tipee reemplaza el contenido (y así un "=" arranca una fórmula en vez
      // de pegarse al número que ya estaba).
      input.select();
      input.dataset.recienEnfocado = '1';
    });

    // Con mouse, el mouseup posterior al focus colapsa la selección donde se
    // clickeó — se cancela sólo el primero, para que el select() valga.
    input.addEventListener('mouseup', e => {
      if (!input.dataset.recienEnfocado) return;
      delete input.dataset.recienEnfocado;
      e.preventDefault();
    });

    // Corre después de los blur de attachCalcInput (resuelve la fórmula) y
    // attachMoneyInput (reagrupa los miles), así lee el texto ya resuelto.
    input.addEventListener('blur', () => {
      const v = window.valorCampo(input);
      if (v == null || isNaN(v)) delete input.dataset.valorReal;
      else input.dataset.valorReal = String(v);
      input.value = textoMostrado(v);
      // El texto de referencia pasa a ser el que quedó en pantalla: si nadie
      // vuelve a tocar el campo, la próxima lectura devuelve el valor
      // guardado y no este texto redondeado.
      input.dataset.textoAlEnfocar = input.value;
    });
  };

  // Repinta los campos ya enganchados cuando cambian los decimales del
  // header — el valor no se toca, sólo cuántos decimales se ven. Se escucha
  // el evento directo (y no onDecimalesVista) porque calc.js se carga antes
  // que moneda.js, que es donde vive ese helper.
  window.addEventListener('vimeco:decimales', () => {
    document.querySelectorAll('input[data-valor-real]').forEach(input => {
      if (document.activeElement === input) return;
      input.value = textoMostrado(parseFloat(input.dataset.valorReal));
      input.dataset.textoAlEnfocar = input.value;
    });
  });
})();
