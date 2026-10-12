/* Lector Texto - logica de la app
   - Pegar texto
   - Guardar como PDF (dialogo de impresion -> Guardar como PDF)
   - Traducir (MyMemory, gratis) con deteccion de idioma
   - Leer en voz alta (Web Speech API del telefono)
*/

const IDIOMAS = [
  { code: 'auto', nombre: 'Detectar automaticamente' },
  { code: 'es', nombre: 'Espanol' },
  { code: 'en', nombre: 'Ingles' },
  { code: 'pt', nombre: 'Portugues' },
  { code: 'fr', nombre: 'Frances' },
  { code: 'it', nombre: 'Italiano' },
  { code: 'de', nombre: 'Aleman' },
  { code: 'ru', nombre: 'Ruso' },
];

const $ = (id) => document.getElementById(id);
const elTexto = $('texto');
const elStatus = $('status');
const elSrc = $('srcLang');
const elDst = $('dstLang');

const estado = { vista: 'original', original: '', traduccion: '', idiomaOrig: 'auto' };

function setStatus(msg) { elStatus.textContent = msg || ''; }

function cargarSelects() {
  IDIOMAS.forEach((i) => {
    const o = new Option(i.nombre, i.code);
    elSrc.add(o.cloneNode(true));
  });
  IDIOMAS.filter((i) => i.code !== 'auto').forEach((i) => {
    const o = new Option(i.nombre, i.code);
    elDst.add(o);
  });
  elSrc.value = 'auto';
  elDst.value = 'es';
}

/* ---------- Deteccion de idioma (simple, por palabras comunes) ---------- */
function detectarIdioma(texto) {
  const t = ' ' + texto.toLowerCase().replace(/[.,;:!?¡¿"“”()\[\]{}<>/\\|-]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const listas = {
    es: [' el ', ' la ', ' los ', ' las ', ' de ', ' que ', ' y ', ' en ', ' un ', ' una ', ' para ', ' con ', ' por ', ' no ', ' se '],
    en: [' the ', ' and ', ' of ', ' to ', ' in ', ' is ', ' a ', ' that ', ' for ', ' with ', ' it ', ' you ', ' are '],
    pt: [' o ', ' a ', ' os ', ' as ', ' de ', ' que ', ' e ', ' em ', ' um ', ' uma ', ' para ', ' com ', ' nao '],
    fr: [' le ', ' la ', ' les ', ' de ', ' et ', ' en ', ' un ', ' une ', ' pour ', ' avec ', ' est ', ' que '],
    it: [' il ', ' la ', ' le ', ' di ', ' che ', ' e ', ' in ', ' un ', ' una ', ' per ', ' con ', ' non '],
    de: [' der ', ' die ', ' das ', ' und ', ' von ', ' zu ', ' in ', ' ein ', ' eine ', ' fur ', ' mit ', ' ist '],
  };
  let mejor = 'en', mejorPunt = -1;
  for (const [lang, palabras] of Object.entries(listas)) {
    let p = 0;
    palabras.forEach((w) => { if (t.includes(w)) p++; });
    if (p > mejorPunt) { mejorPunt = p; mejor = lang; }
  }
  return mejorPunt <= 0 ? 'en' : mejor;
}

function idiomaOrigen() {
  if (elSrc.value !== 'auto') return elSrc.value;
  return estado.idiomaOrig || detectarIdioma(elTexto.value);
}

/* ---------- Traduccion con MyMemory (gratis, con limite ~500 chars) ---------- */
function partirTexto(texto, max) {
  const partes = [];
  let actual = '';
  texto.split(/(\s+)/).forEach((tok) => {
    if ((actual + tok).length > max) { partes.push(actual.trim()); actual = ''; }
    actual += tok;
  });
  if (actual.trim()) partes.push(actual.trim());
  return partes.filter(Boolean);
}

async function traducir(texto, de, a) {
  const partes = partirTexto(texto, 480);
  const salida = [];
  for (let i = 0; i < partes.length; i++) {
    setStatus(`Traduciendo... ${i + 1}/${partes.length}`);
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(partes[i])}&langpair=${de}|${a}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('Error de red (' + r.status + ')');
    const j = await r.json();
    if (j.responseStatus && Number(j.responseStatus) !== 200) {
      throw new Error(j.responseDetails || 'Limite de traduccion alcanzado');
    }
    salida.push((j.responseData && j.responseData.translatedText) || '');
  }
  return salida.join('\n\n');
}

/* ---------- Tabs ---------- */
function guardarVista() {
  if (estado.vista === 'original') estado.original = elTexto.value;
  else estado.traduccion = elTexto.value;
}
function mostrarVista(v) {
  guardarVista();
  estado.vista = v;
  elTexto.value = v === 'original' ? estado.original : estado.traduccion;
  $('tabOrig').classList.toggle('active', v === 'original');
  $('tabTrad').classList.toggle('active', v === 'traduccion');
}

/* ---------- Voz ---------- */
let voces = [];
function cargarVoces() { voces = window.speechSynthesis ? speechSynthesis.getVoices() : []; }
if (window.speechSynthesis) {
  cargarVoces();
  speechSynthesis.onvoiceschanged = cargarVoces;
}

function idiomaParaVoz() {
  if (estado.vista === 'traduccion') return elDst.value;
  return idiomaOrigen();
}

/* Chrome Android necesita locale completo (es-ES) y NO fijar .voice.
   Ademas falla con textos largos: se parte en frases y se lee en cola.
   Se resalta la palabra que se va leyendo en amarillo claro. */
const LOCALES = {
  es: 'es-ES', en: 'en-US', pt: 'pt-BR', fr: 'fr-FR',
  it: 'it-IT', de: 'de-DE', ru: 'ru-RU',
};

function localeDe(lang) { return LOCALES[lang] || lang; }

let vozActiva = false;
let spans = [];           // {el, start, end} sobre el texto normalizado
let highlightActual = null;

function normalizar(t) { return t.replace(/\s+/g, ' ').trim(); }

/* Construye la vista de lectura con cada palabra en un <span> */
function construirLector(norm) {
  const cont = $('lector');
  cont.innerHTML = '';
  spans = [];
  const re = /\S+/g;
  let m, last = 0;
  while ((m = re.exec(norm)) !== null) {
    if (m.index > last) cont.appendChild(document.createTextNode(norm.slice(last, m.index)));
    const s = document.createElement('span');
    s.className = 'w';
    s.textContent = m[0];
    cont.appendChild(s);
    spans.push({ el: s, start: m.index, end: m.index + m[0].length });
    last = m.index + m[0].length;
  }
  if (last < norm.length) cont.appendChild(document.createTextNode(norm.slice(last)));
}

function limpiarResaltado() {
  if (highlightActual) highlightActual.classList.remove('on');
  highlightActual = null;
}

function asegurarVisible(el) {
  const caja = $('lector');
  if (!caja) return;
  const r = el.getBoundingClientRect();
  const cr = caja.getBoundingClientRect();
  if (r.top < cr.top + 10 || r.bottom > cr.bottom - 10) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function resaltarGlobal(globalIdx) {
  for (let k = 0; k < spans.length; k++) {
    if (globalIdx >= spans[k].start && globalIdx < spans[k].end) {
      if (highlightActual !== spans[k].el) {
        limpiarResaltado();
        highlightActual = spans[k].el;
        highlightActual.classList.add('on');
        asegurarVisible(highlightActual);
      }
      return;
    }
  }
}

/* Parte el texto normalizado en trozos <=180 y guarda el offset de cada uno */
function partirConOffset(norm) {
  const re = /[^.!?…]*[.!?…]+|\S[^.!?…]*$/g;
  const sent = [];
  let m;
  while ((m = re.exec(norm)) !== null) {
    if (m[0].trim()) sent.push({ start: m.index, end: m.index + m[0].length });
    else re.lastIndex++;
  }
  const partes = [];
  let cs = null, ce = null;
  const flush = () => { if (cs !== null) { partes.push({ inicio: cs, texto: norm.slice(cs, ce) }); cs = null; } };
  sent.forEach((s) => {
    if (cs !== null && (s.end - cs) > 180) flush();
    if (cs === null) cs = s.start;
    ce = s.end;
  });
  flush();
  /* normaliza offsets y parte trozos sin puntuacion que sean muy largos */
  const fin = [];
  partes.forEach((p) => {
    const lead = p.texto.length - p.texto.trimStart().length;
    const ini = p.inicio + lead;
    const t = p.texto.trim();
    if (t.length <= 200) { fin.push({ inicio: ini, texto: t }); return; }
    let cur = '';
    let curIni = ini;
    t.split(' ').forEach((w) => {
      if (cur && (cur.length + 1 + w.length) > 180) {
        fin.push({ inicio: curIni, texto: cur });
        curIni = curIni + cur.length + 1;
        cur = w;
      } else {
        cur += (cur ? ' ' : '') + w;
      }
    });
    if (cur) fin.push({ inicio: curIni, texto: cur });
  });
  return fin.filter((p) => p.texto);
}

function leer() {
  const texto = elTexto.value.trim();
  if (!texto) { setStatus('No hay texto para leer.'); return; }
  if (!window.speechSynthesis) { setStatus('Tu navegador no soporta lectura por voz.'); return; }
  speechSynthesis.cancel();
  if (speechSynthesis.paused) speechSynthesis.resume();

  const norm = normalizar(texto);
  const lang = localeDe(idiomaParaVoz());
  const partes = partirConOffset(norm);

  /* Mostrar la vista de lectura con resaltado */
  norm && construirLector(norm);
  elTexto.classList.add('hidden');
  $('lectorWrap').classList.remove('hidden');
  $('lectorInfo').textContent = 'Leyendo en ' + lang;
  limpiarResaltado();

  let i = 0;
  let palabraTimer = null;
  let modoTimer = false;
  const limpiarTimer = () => { if (palabraTimer) { clearTimeout(palabraTimer); palabraTimer = null; } };

  /* Estima la duracion por palabra segun su longitud (aprox. voz a ritmo normal) */
  const MS_POR_LETRA = 66;
  function palabrasDeChunk(parte, base) {
    const ws = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(parte.texto)) !== null) {
      let d = Math.max(150, m[0].length * MS_POR_LETRA);
      if (/[.!?…]$/.test(m[0])) d += 240;
      else if (/[,;:]$/.test(m[0])) d += 120;
      ws.push({ start: base + m.index, dur: d });
    }
    return ws;
  }

  vozActiva = true;
  $('btnParar').classList.remove('hidden');
  setStatus('Leyendo en ' + lang + '...');

  const siguiente = () => {
    if (!vozActiva || i >= partes.length) {
      limpiarTimer();
      if (vozActiva) setStatus('Lectura terminada.');
      vozActiva = false;
      $('btnParar').classList.add('hidden');
      return;
    }
    const parte = partes[i];
    const base = parte.inicio;
    const palabras = palabrasDeChunk(parte, base);
    const u = new SpeechSynthesisUtterance(parte.texto);
    u.lang = lang;
    u.rate = 1;
    u.pitch = 1;
    modoTimer = true;

    /* Respaldo palabra a palabra por tiempo (Android no siempre manda boundary) */
    const arrancarTimer = () => {
      let idx = 0;
      const tick = () => {
        if (!vozActiva || !modoTimer || idx >= palabras.length) return;
        resaltarGlobal(palabras[idx].start);
        const espera = palabras[idx].dur;
        idx++;
        palabraTimer = setTimeout(tick, espera);
      };
      tick();
    };

    u.onboundary = (e) => {
      if (e.name && e.name !== 'word') return;
      modoTimer = false;          /* el boundary es mas preciso */
      limpiarTimer();
      resaltarGlobal(base + (e.charIndex || 0));
    };
    u.onstart = () => { modoTimer = true; limpiarTimer(); arrancarTimer(); };
    u.onend = () => {
      limpiarTimer();
      modoTimer = false;
      i++;
      siguiente();
    };
    u.onerror = (e) => {
      limpiarTimer();
      const err = e && e.error ? e.error : 'desconocido';
      if (err === 'interrupted' || err === 'canceled') return;
      setStatus('No se pudo leer (' + err + '). Prueba idioma Espanol en el selector.');
      vozActiva = false;
      $('btnParar').classList.add('hidden');
      volverAEditar();
    };
    speechSynthesis.speak(u);
  };
  siguiente();
}

function volverAEditar() {
  $('lectorWrap').classList.add('hidden');
  elTexto.classList.remove('hidden');
}

/* ---------- PDF (dialogo de impresion) ---------- */
function guardarPDF() {
  const texto = elTexto.value.trim();
  if (!texto) { setStatus('No hay texto para guardar.'); return; }
  $('printArea').textContent = texto;
  setStatus('Elige "Guardar como PDF" en el dialogo.');
  setTimeout(() => window.print(), 200);
}

/* ---------- Detectar idioma al pegar ---------- */
elTexto.addEventListener('input', () => {
  guardarVista();
  if (elSrc.value === 'auto' && elTexto.value.trim().length > 20) {
    estado.idiomaOrig = detectarIdioma(elTexto.value);
  }
});

/* ---------- Eventos ---------- */
function detenerVoz() {
  vozActiva = false;
  if (window.speechSynthesis) speechSynthesis.cancel();
  $('btnParar').classList.add('hidden');
}
$('tabOrig').onclick = () => { detenerVoz(); volverAEditar(); mostrarVista('original'); };
$('tabTrad').onclick = () => { detenerVoz(); volverAEditar(); mostrarVista('traduccion'); };
$('btnEditar').onclick = () => { detenerVoz(); volverAEditar(); };
$('btnPdf').onclick = guardarPDF;
$('btnVoz').onclick = leer;
$('btnParar').onclick = () => { detenerVoz(); setStatus('Detenido.'); };
$('btnTraducir').onclick = async () => {
  guardarVista();
  const texto = estado.original.trim();
  if (!texto) { setStatus('Pega un texto primero.'); return; }
  const de = idiomaOrigen();
  const a = elDst.value;
  if (de === a) { setStatus('El idioma de origen y destino son iguales.'); return; }
  try {
    $('btnTraducir').disabled = true;
    estado.traduccion = await traducir(texto, de, a);
    mostrarVista('traduccion');
    setStatus(`Traducido de ${de.toUpperCase()} a ${a.toUpperCase()}.`);
  } catch (e) {
    setStatus('Error al traducir: ' + e.message);
  } finally {
    $('btnTraducir').disabled = false;
  }
};

/* ---------- Offline ---------- */
function pintarOffline() { $('offline').classList.toggle('hidden', navigator.onLine); }
window.addEventListener('online', pintarOffline);
window.addEventListener('offline', pintarOffline);

/* ---------- Inicio ---------- */
cargarSelects();
pintarOffline();
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
