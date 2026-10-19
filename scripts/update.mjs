// Actualiza index.html con datos frescos:
//  - Torneos: calendario de la Federación de Ajedrez de Chile (federacionchilenadeajedrez.cl)
//  - Noticias: portada de ajefech.cl
//  - Ranking: lista FIDE estándar (ratings.fide.com), jugadores con federación CHI
// Si una fuente falla, esa parte queda como estaba y el error se anota en update-errors.txt.
import fs from "node:fs";
import zlib from "node:zlib";

const FILE = "index.html";
let html = fs.readFileSync(FILE, "utf8");
const errors = [];
const changes = [];
const UA = { "user-agent": "Mozilla/5.0 (compatible; ajedrezchileno.cl updater)" };

const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const MES3 = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
const noAcc = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const evalJS = txt => new Function("return (" + txt + ")")();
async function fetchRetry(url, opt = {}, tries = 4) {
  for (let k = 1; ; k++) {
    try {
      const r = await fetch(url, { ...opt, signal: AbortSignal.timeout(90000) });
      if (r.ok || k >= tries || r.status < 500) return r;
    } catch (e) { if (k >= tries) throw e; }
    await new Promise(res => setTimeout(res, 10000 * k));
  }
}

// Fecha de hoy en Chile
const now = new Date();
const cl = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now); // YYYY-MM-DD
const [CY, CM, CD] = cl.split("-").map(Number);
const todayKey = CY * 10000 + CM * 100 + CD;
const dkey = s => { const [d, m, y] = String(s).split("/").map(Number); return y * 10000 + m * 100 + d; };

// ---------- utilidades para leer y reemplazar bloques del HTML ----------
function getBlock(start, end) {
  const i = html.indexOf(start);
  if (i < 0) throw new Error("No se encontró " + start);
  const j = html.indexOf(end, i + start.length);
  if (j < 0) throw new Error("No se encontró el final de " + start);
  return { i, j: j + end.length, body: html.slice(i + start.length, j) };
}
function setBlock(start, end, body) {
  const b = getBlock(start, end);
  const next = html.slice(0, b.i) + start + body + end + html.slice(b.j);
  if (next !== html) { html = next; return true; }
  return false;
}

// ---------- normalización de textos de torneos nuevos ----------
const SMALL = new Set(["de","del","la","las","los","el","y","e","en","por","a","al","con","para","o","u","sin"]);
const KEEP = new Set(["IRT","FIDE","ELO","CRAM","GM","MI","MF","IM","FM","CM","WGM","WIM","WFM","AJEFECH","UC","UDEC","USACH","DUOC","INACAP","IND","FDN","CESFAM","SDC","II","III","IV","VI","VII","VIII","IX","XI","XII","XIII","XIV","XV","XVI","XVII","XVIII","XIX","XX","XXI","XXII"]);
const ACC = { clasico: "clásico", rapido: "rápido", concepcion: "concepción", edicion: "edición", chillan: "chillán", valparaiso: "valparaíso", copiapo: "copiapó", maipu: "maipú", penalolen: "peñalolén", nunoa: "ñuñoa", aleman: "alemán", tecnico: "técnico", olimpico: "olímpico", simultanea: "simultánea", region: "región", nacion: "nación", union: "unión", asociacion: "asociación", fundacion: "fundación", campeon: "campeón", campeones: "campeones", ajedrez: "ajedrez", jose: "josé", maria: "maría", angeles: "ángeles", rios: "ríos", nino: "niño", ninos: "niños", senor: "señor", ano: "año", anos: "años", araucania: "araucanía", biobio: "biobío", nuble: "ñuble", curico: "curicó", vina: "viña", tome: "tomé", pucon: "pucón", conchali: "conchalí" };
function fixWord(w, first) {
  const up = w.toUpperCase();
  if (KEEP.has(up.replace(/[^A-Z]/g, "")) && /^[A-Za-z]+$/.test(w)) return up;
  let lo = w.toLowerCase();
  const key = noAcc(lo).replace(/[^a-zñ]/g, "");
  if (ACC[key] && noAcc(lo) === key) lo = ACC[key];
  if (/^sub-?\d+$/i.test(w)) return "Sub " + w.replace(/\D/g, "");
  if (!first && SMALL.has(lo)) return lo;
  return lo.charAt(0).toUpperCase() + lo.slice(1);
}
function niceTitle(t) {
  let s = String(t || "").replace(/[☀-➿️\u{1F300}-\u{1FAFF}]/gu, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/^[-–·\s]+|[-–·\s]+$/g, "");
  const letters = s.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, "");
  const upper = letters.replace(/[^A-ZÁÉÍÓÚÑ]/g, "").length;
  if (letters.length && upper / letters.length > 0.6) {
    s = s.split(" ").map((w, i) => w.split("-").map((p, k) => fixWord(p, i === 0 && k === 0)).join("-")).join(" ");
  }
  s = s.replace(/\bsub ?- ?(\d{3,4})\b/gi, "Sub $1").replace(/\s+-\s+/g, " · ");
  return s;
}
function niceTime(t) {
  const raw = String(t || "").replace(/\s+/g, " ").trim();
  const parts = raw.split(/\s*[;\/]\s*|\s+y\s+(?=\d)/i).map(p => {
    const q = p.toLowerCase().replace(/[’']/g, "'").replace(/''|"/g, "s");
    let m = q.match(/(\d+)\s*(?:min(?:utos)?|')?\s*(?:\+|mas|más)\s*(\d+)/);
    if (m) return m[1] + "+" + m[2];
    m = q.match(/^(\d+)\s*(?:min(?:utos)?|')?\s*(?:sin incremento|por jugador)?$/);
    if (m) return m[1] + " min";
    return null;
  });
  if (parts.length && parts.every(Boolean)) return parts.join(" · ");
  return raw;
}
function niceCat(c) {
  let s = String(c || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  const letters = s.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, "");
  if (letters === letters.toUpperCase() || letters === letters.toLowerCase()) s = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return s.replace(/\bsub ?-?(\d+)/gi, "Sub $1");
}
function niceType(t) {
  const k = noAcc(t);
  if (k.startsWith("clas")) return "Clasico";
  if (k.startsWith("rap")) return "Rapido";
  if (k.startsWith("blitz") || k.startsWith("relamp")) return "Blitz";
  return "Clasico";
}

// Comunas frecuentes → región (para ubicar en el mapa ciudades nuevas)
const COMUNAS = {
  "Arica y Parinacota": ["Arica","Putre"],
  "Tarapacá": ["Iquique","Alto Hospicio","Pozo Almonte"],
  "Antofagasta": ["Antofagasta","Calama","Tocopilla","Mejillones","Taltal","San Pedro de Atacama"],
  "Atacama": ["Copiapó","Tierra Amarilla","Vallenar","Caldera","Chañaral","Diego de Almagro","Huasco"],
  "Coquimbo": ["La Serena","Coquimbo","Ovalle","Illapel","Vicuña","Los Vilos","Salamanca","Combarbalá","Monte Patria"],
  "Valparaíso": ["Valparaíso","Viña del Mar","Villa Alemana","Quilpué","San Antonio","Santo Domingo","Quillota","Los Andes","San Felipe","Limache","Concón","Casablanca","La Calera","Cartagena","Algarrobo","El Quisco","Quintero","Puchuncaví","La Ligua","Olmué"],
  "Metropolitana": ["Santiago","Huechuraba","San Bernardo","La Florida","Colina","Providencia","Las Condes","Recoleta","La Granja","Lo Espejo","La Cisterna","Buin","Ñuñoa","Maipú","Puente Alto","Peñalolén","La Reina","Vitacura","Lo Barnechea","Macul","San Miguel","Independencia","Quinta Normal","Estación Central","Cerrillos","Pudahuel","Quilicura","Renca","Conchalí","Cerro Navia","Lo Prado","El Bosque","La Pintana","San Joaquín","San Ramón","Pedro Aguirre Cerda","Lampa","Talagante","Peñaflor","Melipilla","Paine","Pirque","San José de Maipo","Calera de Tango","Padre Hurtado","Til Til","Isla de Maipo","El Monte","Curacaví"],
  "O'Higgins": ["Rancagua","San Fernando","Rengo","Machalí","Santa Cruz","Pichilemu","San Vicente","Graneros","Chimbarongo","Requínoa"],
  "Maule": ["Talca","Curicó","Linares","San Javier","Constitución","Molina","Cauquenes","Parral","Maule","San Clemente","Longaví","Teno","Villa Alegre"],
  "Ñuble": ["Chillán","Chillán Viejo","San Nicolás","El Carmen","San Carlos","Bulnes","Quirihue","Coihueco","Yungay","Quillón"],
  "Biobío": ["Concepción","Penco","Lota","Arauco","Los Ángeles","Hualpén","Nacimiento","Talcahuano","San Pedro de la Paz","Chiguayante","Coronel","Tomé","Lebu","Cañete","Curanilahue","Mulchén","Cabrero","Hualqui","Laja","Santa Juana"],
  "Araucanía": ["Temuco","Collipulli","Padre Las Casas","Villarrica","Pucón","Angol","Victoria","Lautaro","Nueva Imperial","Pitrufquén","Loncoche","Traiguén"],
  "Los Ríos": ["Valdivia","Paillaco","La Unión","Panguipulli","Río Bueno","Los Lagos","Lanco","Mariquina"],
  "Los Lagos": ["Puerto Montt","Osorno","Puerto Varas","Castro","Ancud","Frutillar","Llanquihue","Calbuco","Quellón","Purranque","Río Negro"],
  "Aysén": ["Coyhaique","Puerto Aysén","Chile Chico","Cochrane"],
  "Magallanes": ["Punta Arenas","Puerto Natales","Porvenir","Puerto Williams"]
};
const COMUNA_REG = {}; const COMUNA_NAME = {};
for (const [r, cs] of Object.entries(COMUNAS)) for (const c of cs) { COMUNA_REG[noAcc(c)] = r; COMUNA_NAME[noAcc(c)] = c; }
function niceCity(raw, REG) {
  const known = {}; REG.forEach(([r, cs]) => cs.forEach(c => { known[noAcc(c)] = c; }));
  const parts = String(raw || "").split(/[,\-–\/()]/).map(p => p.trim()).filter(Boolean);
  // prioriza una comuna distinta de "Santiago" si viene "Santiago, La Granja"
  const cands = [...parts].sort((a, b) => (noAcc(a) === "santiago") - (noAcc(b) === "santiago"));
  for (const p of cands) { const k = noAcc(p); if (known[k]) return known[k]; if (COMUNA_NAME[k]) return COMUNA_NAME[k]; }
  const p0 = parts[0] || String(raw || "").trim();
  return p0.toLowerCase().split(" ").map((w, i) => (!i || !SMALL.has(w)) ? w.charAt(0).toUpperCase() + w.slice(1) : w).join(" ");
}

// ---------- 1. Torneos ----------
async function updateTournaments() {
  const q = "{tournaments{id title city startDateFormated endDateFormated type rounds timeControl category eloInt inscriptionsCount address visible archived club{name}}}";
  const r = await fetchRetry("https://www.federacionchilenadeajedrez.cl/graphql", { method: "POST", headers: { ...UA, "content-type": "application/json" }, body: JSON.stringify({ query: q }) });
  if (!r.ok) throw new Error("Federación respondió " + r.status);
  const j = await r.json();
  const list = (j.data && j.data.tournaments) || [];
  if (list.length < 10) throw new Error("La Federación devolvió solo " + list.length + " torneos; no se actualiza el calendario.");

  const tb = getBlock("const T=[\n", "\n];");
  const oldT = evalJS("[" + tb.body + "]");
  const oldById = Object.fromEntries(oldT.map(t => [t[0], t]));
  const addrLine = getBlock("const ADDR=", ";\n");
  const ADDR = evalJS(addrLine.body);
  const regLine = getBlock("const REG=", ";\n");
  const REG = evalJS(regLine.body);

  const T = []; const NADDR = {}; let added = 0;
  for (const x of list) {
    if (x.visible === false || x.archived) continue;
    const start = x.startDateFormated, end = x.endDateFormated || start;
    if (!start || dkey(end) < todayKey) continue;
    const old = oldById[x.id];
    const club = (x.club && x.club.name || "").trim();
    let row;
    if (old) {
      row = [x.id, old[1], old[2], start, end, niceType(x.type), x.rounds || old[6], old[7], old[8], x.eloInt ? 1 : 0, club || old[10]];
    } else {
      added++;
      row = [x.id, niceTitle(x.title), niceCity(x.city, REG), start, end, niceType(x.type), x.rounds || 0, niceTime(x.timeControl), niceCat(x.category), x.eloInt ? 1 : 0, club];
    }
    T.push(row);
    const addr = String(x.address || "").replace(/\s+/g, " ").trim();
    NADDR[x.id] = [old && ADDR[x.id] ? ADDR[x.id][0] : (addr || "Por confirmar"), x.inscriptionsCount || 0];
  }
  T.sort((a, b) => dkey(a[3]) - dkey(b[3]));
  if (!T.length) throw new Error("No quedaron torneos vigentes; no se actualiza.");

  // agrega ciudades nuevas a su región
  const inReg = new Set(REG.flatMap(([, cs]) => cs.map(noAcc)));
  for (const t of T) {
    const k = noAcc(t[2]);
    if (!inReg.has(k) && COMUNA_REG[k]) { const reg = REG.find(([r]) => r === COMUNA_REG[k]); if (reg) { reg[1].push(t[2]); inReg.add(k); } }
  }

  const body = T.map(t => JSON.stringify(t)).join(",\n");
  let ch = setBlock("const T=[\n", "\n];", body);
  ch = setBlock("const ADDR=", ";\n", JSON.stringify(NADDR)) || ch;
  ch = setBlock("const REG=", ";\n", JSON.stringify(REG)) || ch;
  if (ch) changes.push(`Torneos: ${T.length} vigentes (${added} nuevos)`);
}

// ---------- 2. Noticias ----------
const ENT = { nbsp: " ", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", iexcl: "¡", iquest: "¿", ordm: "º", ordf: "ª", deg: "°", laquo: "«", raquo: "»", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", euro: "€" };
const decode = s => String(s)
  .replace(/&([a-zA-Z])(acute|tilde|uml|grave|circ);/g, (m, l, k) => (l + ({ acute: "\u0301", tilde: "\u0303", uml: "\u0308", grave: "\u0300", circ: "\u0302" })[k]).normalize("NFC"))
  .replace(/&([a-z]+);/g, (m, k) => ENT[k] ?? m)
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const strip = s => decode(String(s).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
function sentenceCase(t) {
  const letters = t.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, "");
  if (!letters || letters !== letters.toUpperCase()) return t;
  return niceTitle(t).replace(/^(\S+)(.*)$/, (m, a, b) => a + b.replace(/\b([A-ZÁÉÍÓÚÑ])([a-záéíóúñ]+)/g, (w, f, r) => (KEEP.has(w.toUpperCase()) ? w : w.toLowerCase())))
    .replace(/\b(chile|santiago|ajefech|fide|ind)\b/gi, w => ({ chile: "Chile", santiago: "Santiago", ajefech: "AJEFECH", fide: "FIDE", ind: "IND" })[w.toLowerCase()]);
}
async function updateNews() {
  const r = await fetchRetry("https://www.ajefech.cl/", { headers: UA });
  if (!r.ok) throw new Error("ajefech.cl respondió " + r.status);
  const page = await r.text();
  const chunks = page.split(/itemprop="blogPost"/).slice(1);
  const items = [];
  for (const c of chunks) {
    const a = c.match(/class="item-title"[^>]*>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    const d = c.match(/datetime="(\d{4})-(\d{2})-(\d{2})/);
    if (!a || !d) continue;
    const url = new URL(a[1], "https://www.ajefech.cl").href;
    const title = strip(a[2]);
    let text = strip(c.slice(c.indexOf("</h2>") + 5)).replace(/Publicado:.*?\d{4}/, "").replace(/Detalles|Escrito por.*?(?=\s[A-ZÁÉÍÓÚ])/g, "").trim();
    if (text.toUpperCase().startsWith(title.toUpperCase())) text = text.slice(title.length).trim();
    let sum = text.length > 200 ? text.slice(0, 200).replace(/\s+\S*$/, "") + "…" : text;
    items.push({ date: `${d[3]} ${MES3[+d[2] - 1]} ${d[1]}`, key: +(d[1] + d[2] + d[3]), title: sentenceCase(title), sum, url });
  }
  if (!items.length) throw new Error("No se pudieron leer noticias de ajefech.cl");
  const nb = getBlock("const NEWS=[\n", "\n];");
  const old = evalJS("[" + nb.body + "]");
  const k = s => { const [dd, mm, yy] = s.split(" "); return +(yy + String(MES3.indexOf(mm) + 1).padStart(2, "0") + dd.padStart(2, "0")); };
  const pathOf = u => { try { return new URL(u).pathname.replace(/\/+$/, "").toLowerCase(); } catch { return String(u); } };
  const urls = new Set(old.map(n => pathOf(n[3])));
  const fresh = items.filter(n => !urls.has(pathOf(n.url))).map(n => [n.date, n.title, n.sum, "https://www.ajefech.cl" + new URL(n.url).pathname]);
  if (!fresh.length) return;
  const all = [...fresh, ...old].sort((a, b) => k(b[0]) - k(a[0])).slice(0, 5);
  if (setBlock("const NEWS=[\n", "\n];", all.map(n => JSON.stringify(n)).join(",\n"))) changes.push(`Noticias: ${fresh.length} nuevas`);
}

// ---------- 3. Ranking FIDE ----------
async function updateFide() {
  // La lista sale el día 1 de cada mes: si la página ya tiene la del mes actual, no hace falta bajarla.
  const cur = getBlock("Lista FIDE vigente: <b>", "</b>").body.trim();
  if (cur === `${MESES[CM - 1]} ${CY}`) return;
  const URL_FIDE = "https://ratings.fide.com/download/standard_rating_list.zip";
  let buf;
  try {
    const r = await fetchRetry(URL_FIDE, { headers: UA });
    if (!r.ok) throw new Error("FIDE respondió " + r.status);
    buf = Buffer.from(await r.arrayBuffer());
  } catch (e) {
    // segundo intento con curl (IPv4 y más tiempo de conexión)
    const { execFileSync } = await import("node:child_process");
    try {
      execFileSync("curl", ["-sSfL", "-4", "--retry", "4", "--retry-delay", "15", "--connect-timeout", "40", "-o", "fide.zip", URL_FIDE], { stdio: "inherit" });
      buf = fs.readFileSync("fide.zip"); fs.unlinkSync("fide.zip");
    } catch (e2) {
      if (CD < 8) { console.log("FIDE no respondió; se intentará de nuevo mañana."); return; }
      throw new Error("No se pudo descargar la lista FIDE (" + e.message + ")");
    }
  }
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error("El archivo de FIDE no es un zip válido");
  const method = buf.readUInt16LE(8), csize = buf.readUInt32LE(18), nl = buf.readUInt16LE(26), el = buf.readUInt16LE(28);
  const start = 30 + nl + el;
  const data = buf.subarray(start, csize ? start + csize : undefined);
  const txt = (method === 8 ? zlib.inflateRawSync(data) : data).toString("latin1");
  const L = txt.split("\n"); const H = L[0]; const col = k => H.indexOf(k);
  const cName = col("Name"), cFed = col("Fed"), cSex = col("Sex"), cTit = col("Tit"), cW = col("WTit"), cO = col("OTit"), cR = col("FOA") + 4, cG = col("Gms"), cB = col("B-day"), cF = col("Flag");
  if ([cName, cFed, cSex, cTit, cW, cO, cG, cB, cF].some(x => x < 0)) throw new Error("Cambió el formato de la lista FIDE");
  const month = H.slice(cR, cG).trim(); // ej. OCT26
  const rows = [];
  for (const l of L.slice(1)) {
    if (l.slice(cFed, cFed + 3) !== "CHI") continue;
    const elo = parseInt(l.slice(cR, cG)); if (!elo) continue;
    const flag = l.slice(cF).trim(), sex = l.slice(cSex, cSex + 1);
    rows.push({ id: l.slice(0, cName).trim(), n: l.slice(cName, cFed).trim().replace(/\s+/g, " "), e: elo, y: l.slice(cB, cF).trim(), t: (l.slice(cTit, cW).trim() || l.slice(cW, cO).trim()), f: (flag.includes("i") ? "i" : "") + ((sex === "F" || flag.includes("w")) ? "w" : "") });
  }
  if (rows.length < 2000) throw new Error("La lista FIDE trajo solo " + rows.length + " chilenos; no se actualiza.");
  rows.sort((a, b) => b.e - a.e || (a.n < b.n ? -1 : a.n > b.n ? 1 : 0));
  const raw = rows.map(x => `${x.n}|${x.e}|${x.y}|${x.t}|${x.f}`).join("\n");
  const MON = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
  const mi = MON[month.slice(0, 3).toUpperCase()];
  const label = mi === undefined ? null : `${MESES[mi]} 20${month.slice(3, 5)}`;
  let ch = setBlock('const FIDE_RAW=', ';\n', JSON.stringify(raw));
  ch = setBlock('const FID=', '.split(",");\n', JSON.stringify(rows.map(x => x.id).join(","))) || ch;
  if (label) {
    ch = setBlock('Lista FIDE vigente: <b>', '</b>', label) || ch;
    ch = setBlock('target="_blank" rel="noopener">FIDE Ratings, ', '</a>', label) || ch;
  }
  if (ch) changes.push(`Ranking FIDE: lista ${label || month}, ${rows.length} jugadores`);
}

for (const [name, fn] of [["Torneos", updateTournaments], ["Noticias", updateNews], ["Ranking FIDE", updateFide]]) {
  try { await fn(); } catch (e) { errors.push(`${name}: ${e.message}`); console.error(`[${name}]`, e); }
}
if (changes.length) setBlock("Datos actualizados al <b>", "</b>", `${CD} de ${MESES[CM - 1]} de ${CY}`);

fs.writeFileSync(FILE, html);
console.log(changes.length ? "Cambios:\n- " + changes.join("\n- ") : "Sin cambios.");
if (errors.length) { fs.writeFileSync("update-errors.txt", errors.join("\n") + "\n"); console.error("Errores:\n- " + errors.join("\n- ")); }
fs.writeFileSync("update-summary.txt", (changes.length ? changes.join("; ") : "Sin cambios") + "\n");
