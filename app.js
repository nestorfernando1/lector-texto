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
  const t = ' ' + texto.toLowerCase().replace(/[^\p{L}\s]/gu, ' ') + ' ';
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

function buscarVoz(lang) {
  const base = lang.split('-')[0].toLowerCase();
  return voces.find((v) => v.lang && v.lang.toLowerCase().startsWith(base)) || null;
}

function leer() {
  const texto = elTexto.value.trim();
  if (!texto) { setStatus('No hay texto para leer.'); return; }
  if (!window.speechSynthesis) { setStatus('Tu navegador no soporta lectura por voz.'); return; }
  speechSynthesis.cancel();
  const lang = idiomaParaVoz();
  const voz = buscarVoz(lang);
  const u = new SpeechSynthesisUtterance(texto);
  u.lang = voz ? voz.lang : lang;
  if (voz) u.voice = voz;
  u.onstart = () => { setStatus('Leyendo en ' + (u.lang) + '...'); $('btnParar').classList.remove('hidden'); };
  u.onend = () => { setStatus('Lectura terminada.'); $('btnParar').classList.add('hidden'); };
  u.onerror = () => { setStatus('No se encontro voz para ese idioma.'); $('btnParar').classList.add('hidden'); };
  speechSynthesis.speak(u);
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
$('tabOrig').onclick = () => mostrarVista('original');
$('tabTrad').onclick = () => mostrarVista('traduccion');
$('btnPdf').onclick = guardarPDF;
$('btnVoz').onclick = leer;
$('btnParar').onclick = () => { speechSynthesis.cancel(); $('btnParar').classList.add('hidden'); setStatus('Detenido.'); };
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
