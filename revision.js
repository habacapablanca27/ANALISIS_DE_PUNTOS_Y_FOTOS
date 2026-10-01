.pragma library
// revision.js — Lógica pura (sin dependencias de Qt) del plugin
// "Revisión de fotos y direcciones": comprobaciones + generador de PDF con fotos JPEG.

// ─────────────────────────────────────────────────────────────
// 1. UTILIDADES
// ─────────────────────────────────────────────────────────────
function pad2(n) { return (n < 10 ? "0" : "") + n }
function fmtFecha(d)     { return pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + "/" + d.getFullYear() }
function fmtFechaHora(d) { return fmtFecha(d) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) }

// ── Fechas (mismo criterio que "Informe de puntos por horario") ──
var MESES_EN = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 }

// Devuelve un Date o null. Acepta Date, "Mon Aug 31 09:50:28 2026", "2026-08-31 09:50:28", "31/08/2026 09:50:28"
function parseFecha(v) {
    if (v === null || v === undefined) return null
    if (typeof v === "object" && typeof v.getTime === "function") return isNaN(v.getTime()) ? null : new Date(v.getTime())
    var s = String(v).trim()
    if (s === "" || s.toUpperCase() === "NULL") return null
    var m = s.match(/^(?:[A-Za-z]{3,}\.?,?\s+)?([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(\d{4})/)
    if (m && MESES_EN.hasOwnProperty(m[1].toLowerCase())) return new Date(+m[6], MESES_EN[m[1].toLowerCase()], +m[2], +m[3], +m[4], +(m[5] || 0))
    m = s.match(/^(?:[A-Za-z]{3,}\.?,?\s+)?([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/)
    if (m && MESES_EN.hasOwnProperty(m[1].toLowerCase())) return new Date(+m[3], MESES_EN[m[1].toLowerCase()], +m[2], +m[4], +m[5], +(m[6] || 0))
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0))
    m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
    if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0))
    return null
}

// "31/08/2026" -> Date a las 00:00 (o null si no es un día válido)
function parseDia(s) {
    var m = String(s || "").trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/)
    if (!m) return null
    var d = new Date(+m[3], +m[2] - 1, +m[1])
    if (d.getDate() !== +m[1] || d.getMonth() !== +m[2] - 1) return null
    return d
}

// filtro = null (sin filtro) o {dIni, dFin}: desde dIni 00:00:00 hasta dFin 23:59:59.
// Los puntos SIN fecha (FecHoraLec en blanco/NULL o ilegible) se incluyen sólo si filtro.incluirSinFecha.
function enRangoFechas(p, filtro) {
    if (!filtro) return true
    var d = parseFecha(p.attrs.FecHoraLec)
    if (!d) return filtro.incluirSinFecha !== false
    var t0 = filtro.dIni.getTime()
    var t1 = new Date(filtro.dFin.getFullYear(), filtro.dFin.getMonth(), filtro.dFin.getDate(), 23, 59, 59, 999).getTime()
    return d.getTime() >= t0 && d.getTime() <= t1
}

function vacio(s) { return s === null || s === undefined || String(s).trim() === "" || String(s).trim().toUpperCase() === "NULL" }

// Campos de foto: campo, prefijo del nombre de archivo, nombre para los mensajes, obligatoria
var FOTOS = [
    { campo: "Situacion", prefijo: "S_", nombre: "SITUACIÓN", oblig: true  },
    { campo: "FInmueble", prefijo: "I_", nombre: "INMUEBLE",  oblig: true  },
    { campo: "FContador", prefijo: "C_", nombre: "CONTADOR",  oblig: false },
    { campo: "FArqueta",  prefijo: "A_", nombre: "ARQUETA",   oblig: false }
]
// Datos que sólo pueden estar rellenos si hay foto de contador (FContador)
var DATOS_CONTADOR = [
    { campo: "NSerieCont", nombre: "Nº SERIE" },
    { campo: "Diametros",  nombre: "DIÁMETRO" },
    { campo: "Calibre",    nombre: "CALIBRE" },
    { campo: "Lectura",    nombre: "LECTURA" },
    { campo: "MarcaModel", nombre: "MARCA/MODELO" }
]
var CAMPOS_OBLIGATORIOS = ["Direccion", "Situacion", "FInmueble", "FContador", "FArqueta", "NUM_ORDEN"]

// ¿La ruta de la foto corresponde EXACTAMENTE a la dirección?
// Valor esperado (expresión del formulario): 'DCIM/CON/SITUACION/S_' || "Direccion" || '.jpg'
// → la ruta debe terminar en "S_<Direccion>.jpg" (comparación literal; extensión .jpg/.jpeg sin distinguir mayúsculas)
// Los espacios junto a "/" o "\\" no cuentan: la "/" de la dirección crea una subcarpeta
// en DCIM y la tablet quita el espacio ("C/ EL ROBLE 1" → ".../S_POL. IND. C/EL ROBLE 1.jpg").
function normalizarBarras(s) { return String(s).replace(/\s*[\/\\]\s*/g, "/") }

function fotoCoincide(ruta, prefijo, direccion) {
    var r = normalizarBarras(ruta)
    direccion = normalizarBarras(direccion)
    var m = r.match(/\.(jpg|jpeg)$/i)
    if (!m) return false
    var sinExt = r.substring(0, r.length - m[0].length)
    var esperado = prefijo + String(direccion)
    if (sinExt.length < esperado.length) return false
    if (sinExt.substring(sinExt.length - esperado.length) !== esperado) return false
    var antes = sinExt.length - esperado.length
    return antes === 0 || sinExt.charAt(antes - 1) === "/"
}

function unir(lista) {          // ["A","B","C"] -> "A, B, C"
    return lista.join(", ")
}

// puntos: [{fid, attrs:{...}}]  →  [{fid, attrs, incidencias:[{tipo, texto}]}] (sólo los que fallan)
function esVerdadero(v) { return v === true || v === 1 || /^(true|1|t|s[ií]|yes)$/i.test(String(v === null || v === undefined ? "" : v).trim()) }

// Puntos que NO se revisan: "Se borra?" = TRUE, o las 4 fotos vacías
// Excepción: con filtro de fechas, un punto SIN fotos pero con FecHoraLec dentro del rango
// (es decir, tomado en esas fechas) SÍ se revisa.
function excluir(p, filtro) {
    var a = p.attrs
    if (esVerdadero(a["Se borra?"])) return "borra"
    if (vacio(a.Situacion) && vacio(a.FInmueble) && vacio(a.FContador) && vacio(a.FArqueta)) {
        if (filtro && parseFecha(a.FecHoraLec) && enRangoFechas(p, filtro)) return ""
        return "sinfotos"
    }
    return ""
}

// Los duplicados se buscan en TODA la capa (sin contar los excluidos); el filtro de
// fechas decide después qué puntos salen en el informe.
function revisar(todos, filtro) {
    var cuentaDir = {}, i, puntos = [], exclBorra = 0, exclSinFotos = 0
    for (i = 0; i < todos.length; i++) {
        var ex = excluir(todos[i], filtro)
        if (ex === "borra") exclBorra++
        else if (ex === "sinfotos") exclSinFotos++
        else puntos.push(todos[i])
    }
    for (i = 0; i < puntos.length; i++) {
        var d0 = puntos[i].attrs.Direccion
        if (!vacio(d0)) { var k = String(d0).trim(); cuentaDir[k] = (cuentaDir[k] || 0) + 1 }
    }
    var out = []
    var resumen = { sindir: 0, dup: 0, fotos: 0, falta: 0, serie: 0, contador: 0, sinorden: 0, justificar: 0 }
    var enRango = 0, fueraRango = 0, sinFechaEnRango = 0
    for (i = 0; i < puntos.length; i++) {
        var p = puntos[i], a = p.attrs, inc = []
        if (!enRangoFechas(p, filtro)) { fueraRango++; continue }
        enRango++
        if (filtro && !parseFecha(a.FecHoraLec)) sinFechaEnRango++
        var dir = a.Direccion
        var sinDir = vacio(dir)
        if (vacio(a.NUM_ORDEN)) inc.push({ tipo: "sinorden", texto: "SIN NÚMERO DE ORDEN (NUM_ORDEN VACÍO)" })
        if (sinDir) inc.push({ tipo: "sindir", texto: "REVISAR DIRECCIÓN: SIN DIRECCIÓN" })
        else if (cuentaDir[String(dir).trim()] > 1)
            inc.push({ tipo: "dup", texto: "REVISAR DIRECCIÓN: DIRECCIÓN DUPLICADA (" + cuentaDir[String(dir).trim()] + " puntos)" })

        var faltan = [], noCoinc = []
        p.estadoFotos = {}
        for (var f = 0; f < FOTOS.length; f++) {
            var F = FOTOS[f], v = a[F.campo]
            if (vacio(v)) { p.estadoFotos[F.campo] = "vacia"; if (F.oblig) faltan.push(F.nombre); continue }
            if (sinDir) { p.estadoFotos[F.campo] = "ok"; continue }
            if (fotoCoincide(v, F.prefijo, dir)) p.estadoFotos[F.campo] = "ok"
            else { p.estadoFotos[F.campo] = "mal"; noCoinc.push(F.nombre) }
        }
        if (noCoinc.length)
            inc.push({ tipo: "fotos", texto: (noCoinc.length > 1 ? "FOTOS DE " + unir(noCoinc) + " NO COINCIDEN CON LA DIRECCIÓN"
                                                                  : "FOTO DE " + noCoinc[0] + " NO COINCIDE CON LA DIRECCIÓN") })
        if (faltan.length)
            inc.push({ tipo: "falta", texto: (faltan.length > 1 ? "FALTAN FOTOS DE " + unir(faltan) : "FALTA FOTO DE " + faltan[0]) })
        if (vacio(a.NSerieCont) && vacio(a.Observacio) && !vacio(a.FContador))
            inc.push({ tipo: "serie", texto: "NO TIENE NÚMERO DE SERIE DE CONTADOR PERO SÍ HAY FOTO DE CONTADOR, NO TIENE OBSERVACIONES TAMPOCO" })
        // Sin foto de contador no puede haber datos del contador
        if (vacio(a.FContador)) {
            var datosCont = []
            for (var dc = 0; dc < DATOS_CONTADOR.length; dc++)
                if (!vacio(a[DATOS_CONTADOR[dc].campo])) datosCont.push(DATOS_CONTADOR[dc].nombre)
            if (datosCont.length) {
                p.sinFotoContConDatos = true
                p.estadoFotos.FContador = "falta"
                inc.push({ tipo: "contador", texto: "NO TIENE FOTO DE CONTADOR PERO TIENE RELLENO: " + unir(datosCont) })
            }
        }

        // Sin foto de contador y/o arqueta y sin observaciones → hay que justificarlo
        if (vacio(a.Observacio)) {
            var sinFotoCA = []
            if (vacio(a.FContador)) sinFotoCA.push("CONTADOR")
            if (vacio(a.FArqueta))  sinFotoCA.push("ARQUETA")
            if (sinFotoCA.length)
                inc.push({ tipo: "justificar", texto: "SIN FOTO DE " + sinFotoCA.join(" Y ") + " Y SIN OBSERVACIONES (JUSTIFICAR)" })
        }

        if (inc.length) {
            p.incidencias = inc
            var vistos = {}
            for (var j = 0; j < inc.length; j++) if (!vistos[inc[j].tipo]) { vistos[inc[j].tipo] = true; resumen[inc[j].tipo]++ }
            out.push(p)
        }
    }
    out.sort(function (x, y) {
        var nx = parseFloat(x.attrs.NUM_ORDEN), ny = parseFloat(y.attrs.NUM_ORDEN)
        var vx = !isNaN(nx), vy = !isNaN(ny)
        if (vx && vy && nx !== ny) return nx - ny
        if (vx !== vy) return vx ? -1 : 1
        var c = String(x.attrs.NUM_ORDEN || "").localeCompare(String(y.attrs.NUM_ORDEN || ""))
        return c !== 0 ? c : String(x.attrs.Direccion || "").localeCompare(String(y.attrs.Direccion || ""))
    })
    return { fallos: out, resumen: resumen, revisados: enRango,
             excluidos: exclBorra + exclSinFotos, exclBorra: exclBorra, exclSinFotos: exclSinFotos,
             fueraRango: fueraRango, sinFechaEnRango: sinFechaEnRango }
}

// ─────────────────────────────────────────────────────────────
// 2. JPEG: tamaño, componentes y orientación EXIF
// ─────────────────────────────────────────────────────────────
function infoJpeg(b) {
    if (!b || b.length < 4 || b[0] !== 0xFF || b[1] !== 0xD8) return null
    var i = 2, orient = 1, w = 0, h = 0, comps = 3, adobe = false
    while (i + 4 <= b.length) {
        if (b[i] !== 0xFF) { i++; continue }
        var mk = b[i + 1]
        if (mk === 0xFF) { i++; continue }
        if (mk === 0xD8 || mk === 0x01 || (mk >= 0xD0 && mk <= 0xD7)) { i += 2; continue }
        if (mk === 0xD9 || mk === 0xDA) break
        var len = (b[i + 2] << 8) | b[i + 3]
        if (mk === 0xE1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) orient = exifOrient(b, i + 10) || orient
        if (mk === 0xEE) adobe = true
        if (mk >= 0xC0 && mk <= 0xCF && mk !== 0xC4 && mk !== 0xC8 && mk !== 0xCC) {
            h = (b[i + 5] << 8) | b[i + 6]
            w = (b[i + 7] << 8) | b[i + 8]
            comps = b[i + 9]
            break
        }
        i += 2 + len
    }
    if (!w || !h) return null
    return { w: w, h: h, comps: comps, orient: orient, adobe: adobe }
}

function exifOrient(b, t) {       // t = inicio cabecera TIFF
    if (t + 8 > b.length) return 0
    var le = b[t] === 0x49
    function u16(o) { return le ? (b[o] | (b[o + 1] << 8)) : ((b[o] << 8) | b[o + 1]) }
    function u32(o) { return le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
                                : (((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0) }
    var ifd = t + u32(t + 4)
    if (ifd + 2 > b.length) return 0
    var n = u16(ifd)
    for (var k = 0; k < n; k++) {
        var e = ifd + 2 + k * 12
        if (e + 12 > b.length) return 0
        if (u16(e) === 0x0112) { var v = u16(e + 8); return (v >= 1 && v <= 8) ? v : 0 }
    }
    return 0
}

// ─────────────────────────────────────────────────────────────
// 3. PDF (A4, Helvetica, imágenes JPEG con DCTDecode)
// ─────────────────────────────────────────────────────────────
var W = 595.28, H = 841.89, MX = 28

var HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584]
var HELVB = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584]

function anchoTexto(s, size, bold) {
    var t = bold ? HELVB : HELV, w = 0
    s = String(s)
    for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i)
        w += (c >= 32 && c <= 126) ? t[c - 32] : (c === 186 || c === 170 ? 370 : 600)
    }
    return w * size / 1000
}
function recortar(s, size, bold, maxW) {
    s = String(s === null || s === undefined ? "" : s)
    if (anchoTexto(s, size, bold) <= maxW) return s
    while (s.length > 1 && anchoTexto(s + "...", size, bold) > maxW) s = s.substring(0, s.length - 1)
    return s + "..."
}
function partirTexto(s, size, bold, maxW, maxLineas) {
    s = String(s === null || s === undefined ? "" : s).replace(/\s+/g, " ").trim()
    if (s === "") return [""]
    var palabras = s.split(" "), lineas = [], actual = ""
    for (var i = 0; i < palabras.length; i++) {
        var w = palabras[i]
        while (anchoTexto(w, size, bold) > maxW && w.length > 1) {
            var corte = w.length
            while (corte > 1 && anchoTexto(w.substring(0, corte), size, bold) > maxW) corte--
            if (actual) { lineas.push(actual); actual = "" }
            lineas.push(w.substring(0, corte)); w = w.substring(corte)
        }
        var prueba = actual ? actual + " " + w : w
        if (anchoTexto(prueba, size, bold) <= maxW) actual = prueba
        else { lineas.push(actual); actual = w }
    }
    if (actual) lineas.push(actual)
    if (lineas.length > maxLineas) {
        var resto = lineas.slice(maxLineas - 1).join(" ")
        lineas = lineas.slice(0, maxLineas - 1)
        lineas.push(recortar(resto, size, bold, maxW))
    }
    return lineas
}
function esc(s) {
    s = String(s === null || s === undefined ? "" : s)
    var out = ""
    for (var i = 0; i < s.length; i++) {
        var ch = s.charAt(i), c = s.charCodeAt(i)
        if (ch === "\\" || ch === "(" || ch === ")") out += "\\" + ch
        else if (c >= 32 && c <= 126) out += ch
        else if (c === 8364) out += "\\200"
        else if (c >= 160 && c <= 255) out += "\\" + c.toString(8)
        else if (c === 8211 || c === 8212) out += "-"
        else if (c === 9 || c === 10 || c === 13) out += " "
        else out += "?"
    }
    return out
}
function num(v) { return (Math.round(v * 100) / 100).toString() }

function Pagina() { this.ops = []; this.imgs = {} }
Pagina.prototype.texto = function (x, y, s, size, bold, rgb) {
    var c = rgb || [0.1, 0.1, 0.18]
    this.ops.push(num(c[0]) + " " + num(c[1]) + " " + num(c[2]) + " rg BT /" + (bold ? "F2" : "F1") + " " + num(size) +
                  " Tf " + num(x) + " " + num(H - y) + " Td (" + esc(s) + ") Tj ET")
}
Pagina.prototype.textoCursiva = function (x, y, s, size, rgb) {
    var c = rgb || [0.1, 0.1, 0.18]
    this.ops.push(num(c[0]) + " " + num(c[1]) + " " + num(c[2]) + " rg BT /F3 " + num(size) +
                  " Tf " + num(x) + " " + num(H - y) + " Td (" + esc(s) + ") Tj ET")
}
Pagina.prototype.textoDer = function (xDer, y, s, size, bold, rgb) { this.texto(xDer - anchoTexto(s, size, bold), y, s, size, bold, rgb) }
Pagina.prototype.textoCentro = function (xc, y, s, size, bold, rgb) { this.texto(xc - anchoTexto(s, size, bold) / 2, y, s, size, bold, rgb) }
Pagina.prototype.rect = function (x, y, w, h, rgb) {
    this.ops.push(num(rgb[0]) + " " + num(rgb[1]) + " " + num(rgb[2]) + " rg " + num(x) + " " + num(H - y - h) + " " + num(w) + " " + num(h) + " re f")
}
Pagina.prototype.marco = function (x, y, w, h, rgb, grosor) {
    var c = rgb || [0.55, 0.58, 0.62]
    this.ops.push(num(c[0]) + " " + num(c[1]) + " " + num(c[2]) + " RG " + num(grosor || 0.6) + " w " + num(x) + " " + num(H - y - h) + " " + num(w) + " " + num(h) + " re S")
}
Pagina.prototype.linea = function (x1, y1, x2, y2, rgb, grosor) {
    var c = rgb || [0.8, 0.82, 0.86]
    this.ops.push(num(c[0]) + " " + num(c[1]) + " " + num(c[2]) + " RG " + num(grosor || 0.5) + " w " +
                  num(x1) + " " + num(H - y1) + " m " + num(x2) + " " + num(H - y2) + " l S")
}
// Dibuja la imagen ajustada (sin deformar) y centrada en la caja; aplica la orientación EXIF
Pagina.prototype.imagen = function (img, x, y, bw, bh) {
    var rot = img.orient >= 5                          // 5-8: girada 90º
    var iw = rot ? img.h : img.w, ih = rot ? img.w : img.h
    var s = Math.min(bw / iw, bh / ih)
    var dw = iw * s, dh = ih * s
    var X = x + (bw - dw) / 2, Y = H - (y + (bh - dh) / 2) - dh   // esquina inferior izquierda (coords PDF)
    var m
    switch (img.orient) {
        case 2: m = [-dw, 0, 0, dh, X + dw, Y]; break
        case 3: m = [-dw, 0, 0, -dh, X + dw, Y + dh]; break
        case 4: m = [dw, 0, 0, -dh, X, Y + dh]; break
        case 5: m = [0, -dh, -dw, 0, X + dw, Y + dh]; break
        case 6: m = [0, -dh, dw, 0, X, Y + dh]; break
        case 7: m = [0, dh, dw, 0, X, Y]; break
        case 8: m = [0, dh, -dw, 0, X + dw, Y]; break
        default: m = [dw, 0, 0, dh, X, Y]
    }
    this.ops.push("q " + m.map(num).join(" ") + " cm /" + img.nombre + " Do Q")
    this.imgs[img.nombre] = true
}

var AZUL   = [0.267, 0.447, 0.769]   // #4472C4 (cabeceras como en la ficha)
var AZULO  = [0, 0.373, 0.557]       // #005F8E
var VERDE  = [0.18, 0.49, 0.196]     // #2E7D32
var ROJO   = [0.78, 0.1, 0.1]
var ROJOF  = [1, 0.93, 0.93]
var GRIS   = [0.42, 0.45, 0.5]
var GRISF  = [0.94, 0.96, 0.97]
var BLANCO = [1, 1, 1]
var NEGRO  = [0.1, 0.1, 0.18]

var NOMBRE_INC = {
    sindir: "Sin dirección",
    dup:    "Dirección duplicada",
    fotos:  "Fotos que no coinciden con la dirección",
    falta:  "Falta foto de Situación / Inmueble",
    serie:  "Sin nº de serie ni observaciones (con foto de contador)",
    contador: "Sin foto de contador pero con datos del contador",
    justificar: "Sin foto de contador / arqueta y sin observaciones (justificar)",
    sinorden: "Sin número de orden (sólo en este listado, sin ficha)"
}

// datos = { capa, responsable, generado, totalCapa, fallos:[...], resumen:{...},
//           incluirFotos, leerFoto: function(rutaRelativa) -> Uint8Array|null }
function generarPDF(datos) {
    var paginas = [], pg, y
    var imagenes = [], porRuta = {}, bytesFotos = 0, fotosNoLeidas = 0

    function cargarImagen(ruta) {
        if (!datos.incluirFotos || vacio(ruta)) return null
        if (porRuta.hasOwnProperty(ruta)) return porRuta[ruta]
        var b = null
        try { b = datos.leerFoto(String(ruta)) } catch (e) { b = null }
        var inf = b ? infoJpeg(b) : null
        var img = null
        if (inf) {
            img = { nombre: "Im" + (imagenes.length + 1), w: inf.w, h: inf.h, comps: inf.comps, adobe: inf.adobe, orient: inf.orient, bytes: b }
            imagenes.push(img); bytesFotos += b.length
        } else fotosNoLeidas++
        porRuta[ruta] = img
        return img
    }

    function pie(p) { }
    function nuevaPagina() { pg = new Pagina(); paginas.push(pg); return pg }

    // ═════════ PÁGINA(S) DE RESUMEN ═════════
    function cabResumen(primera) {
        pg.rect(0, 0, W, primera ? 74 : 38, VERDE)
        if (primera) {
            pg.texto(MX, 32, "Revisión de fotos y direcciones", 19, true, BLANCO)
            pg.texto(MX, 54, "Capa: " + datos.capa, 10, false, [0.8, 0.93, 0.8])
        } else pg.texto(MX, 24, "Revisión de fotos y direcciones - " + datos.capa + " (resumen)", 11, true, BLANCO)
        y = primera ? 92 : 56
    }
    nuevaPagina(); cabResumen(true)

    var nF = datos.fallos.length
    var altoRes = 128
    pg.rect(MX, y, W - 2 * MX, altoRes, GRISF)
    pg.rect(MX, y, 6, altoRes, nF ? ROJO : VERDE)
    pg.texto(MX + 18, y + 20, "Responsable:", 9, true, GRIS)
    pg.texto(MX + 88, y + 20, recortar(datos.responsable || "-", 10, false, 250), 10, false)
    pg.texto(MX + 18, y + 38, "Capa:", 9, true, GRIS)
    pg.texto(MX + 88, y + 38, recortar(datos.capa, 10, false, 250), 10, false)
    pg.texto(MX + 18, y + 56, "Tablet:", 9, true, GRIS)
    pg.texto(MX + 88, y + 56, recortar(datos.tablet || "-", 10, false, 250), 10, false)
    pg.texto(MX + 18, y + 74, "Generado:", 9, true, GRIS)
    pg.texto(MX + 88, y + 74, datos.generado, 10, false)
    pg.texto(MX + 18, y + 92, "Fechas:", 9, true, GRIS)
    pg.texto(MX + 88, y + 92, recortar(datos.filtroTxt || "Sin filtro de fechas", 9.5, false, 300), 9.5, false)
    pg.texto(MX + 18, y + 112, recortar("Puntos en la capa: " + datos.totalCapa + "   |   Revisados: " + datos.revisados +
             (datos.fueraRango ? "   |   Fuera del rango de fechas: " + datos.fueraRango : "") +
             (datos.excluidos ? "   |   No revisados: " + datos.excluidos + " (Se borra? = TRUE: " + datos.exclBorra + ", sin fotos: " + datos.exclSinFotos + ")" : ""),
             8, false, W - 2 * MX - 30), 8, false, GRIS)
    pg.textoDer(W - MX - 18, y + 26, "PUNTOS A REVISAR", 9, true, GRIS)
    pg.textoDer(W - MX - 18, y + 76, String(nF), 40, true, nF ? ROJO : VERDE)
    y += altoRes + 18

    if (nF === 0) {
        pg.texto(MX, y + 10, "Todas las direcciones y fotos son correctas: no hay puntos que revisar.", 12, false, VERDE)
    } else {
        // Recuento por tipo de incidencia
        pg.texto(MX, y, "Incidencias por tipo", 12, true, AZULO); y += 8
        var tipos = ["sinorden", "sindir", "dup", "fotos", "falta", "serie", "contador", "justificar"]
        for (var t = 0; t < tipos.length; t++) {
            var n = datos.resumen[tipos[t]] || 0
            if (t % 2 === 0) pg.rect(MX, y, W - 2 * MX, 16, GRISF)
            pg.texto(MX + 8, y + 11.5, NOMBRE_INC[tipos[t]], 9, false, n ? NEGRO : GRIS)
            pg.textoDer(W - MX - 8, y + 11.5, String(n), 9, true, n ? ROJO : GRIS)
            y += 16
        }
        pg.texto(MX, y + 12, "Un punto puede tener varias incidencias. Cada punto tiene su ficha en las páginas siguientes, salvo los que no tienen Nº de orden.", 7.5, false, GRIS)
        y += 30

        // Tabla
        var cols = [{ t: "#", w: 22 }, { t: "Nº ORDEN", w: 58 }, { t: "Dirección", w: 160 }, { t: "REVISIÓN", w: W - 2 * MX - 240 }]
        function cabTabla() {
            pg.rect(MX, y, W - 2 * MX, 18, AZUL)
            var cx = MX
            for (var c = 0; c < cols.length; c++) { pg.texto(cx + 4, y + 12.5, cols[c].t, 8.5, true, BLANCO); cx += cols[c].w }
            y += 18
        }
        pg.texto(MX, y, "Puntos a revisar", 12, true, AZULO); y += 8
        cabTabla()
        var fs = 7.5, lh = 9.5
        for (var r = 0; r < nF; r++) {
            var p = datos.fallos[r], a = p.attrs
            var lDir = partirTexto(vacio(a.Direccion) ? "(sin dirección)" : a.Direccion, fs, false, cols[2].w - 8, 3)
            var lRev = []
            for (var q = 0; q < p.incidencias.length; q++)
                lRev = lRev.concat(partirTexto("- " + p.incidencias[q].texto, fs, true, cols[3].w - 8, 3))
            var nl = Math.max(lDir.length, lRev.length, 1)
            var alto = nl * lh + 6
            if (y + alto > H - 50) { nuevaPagina(); cabResumen(false); cabTabla() }
            if (r % 2 === 1) pg.rect(MX, y, W - 2 * MX, alto, GRISF)
            var cx = MX
            pg.texto(cx + 4, y + 4 + fs, String(r + 1), fs, false, GRIS); cx += cols[0].w
            pg.texto(cx + 4, y + 4 + fs, recortar(vacio(a.NUM_ORDEN) ? "(sin Nº)" : a.NUM_ORDEN, fs + 0.5, true, cols[1].w - 8), fs + 0.5, true, vacio(a.NUM_ORDEN) ? ROJO : NEGRO); cx += cols[1].w
            for (var l = 0; l < lDir.length; l++) pg.texto(cx + 4, y + 4 + fs + l * lh, lDir[l], fs, false, vacio(a.Direccion) ? ROJO : NEGRO)
            cx += cols[2].w
            for (l = 0; l < lRev.length; l++) pg.texto(cx + 4, y + 4 + fs + l * lh, lRev[l], fs, true, ROJO)
            pg.linea(MX, y + alto, W - MX, y + alto, [0.88, 0.89, 0.91], 0.4)
            y += alto
        }
    }

    // ═════════ FICHAS (una página por punto) ═════════
    var cw = W - 2 * MX

    function celdaCab(x, yy, w, txt) {
        pg.rect(x, yy, w, 13, AZUL)
        pg.textoCentro(x + w / 2, yy + 9.5, recortar(txt, 7.5, true, w - 4), 7.5, true, BLANCO)
    }
    function celdaVal(x, yy, w, h, txt, opts) {
        opts = opts || {}
        pg.marco(x, yy, w, h, [0.75, 0.77, 0.8], 0.5)
        var size = opts.size || 8
        var lineas = partirTexto(vacio(txt) ? "" : txt, size, !!opts.bold, w - 6, Math.max(1, Math.floor((h - 2) / (size + 2))))
        var tot = lineas.length * (size + 2)
        var y0 = yy + (h - tot) / 2 + size - 0.5
        for (var i = 0; i < lineas.length; i++)
            pg.textoCentro(x + w / 2, y0 + i * (size + 2), lineas[i], size, !!opts.bold, opts.rgb || NEGRO)
    }
    function par(x, yy, w, h, cab, val, opts) { celdaCab(x, yy, w, cab); celdaVal(x, yy + 13, w, h - 13, val, opts) }

    function cajaFoto(x, yy, w, h, F, p) {
        var ruta = p.attrs[F.campo], estado = p.estadoFotos[F.campo]
        var mal = estado === "mal" || estado === "falta" || (estado === "vacia" && F.oblig)
        pg.rect(x, yy, w, 13, mal ? ROJO : AZUL)
        pg.textoCentro(x + w / 2, yy + 9.5, F.nombre.charAt(0) + F.nombre.substring(1).toLowerCase() +
                       (estado === "mal" ? "  -  NO COINCIDE" : ((estado === "vacia" && F.oblig) || estado === "falta" ? "  -  FALTA FOTO" : "")), 7.5, true, BLANCO)
        var areaY = yy + 13, areaH = h - 13 - 12
        pg.marco(x, areaY, w, h - 13, mal ? ROJO : [0.75, 0.77, 0.8], mal ? 1.2 : 0.5)
        var img = cargarImagen(ruta)
        if (img) pg.imagen(img, x + 3, areaY + 3, w - 6, areaH - 4)
        else {
            pg.rect(x + 3, areaY + 3, w - 6, areaH - 4, GRISF)
            var msg = vacio(ruta) ? "Sin foto" : (datos.incluirFotos ? "Foto no encontrada" : "Fotos no incluidas")
            pg.textoCentro(x + w / 2, areaY + areaH / 2 + 3, msg, 9, true, vacio(ruta) && F.oblig ? ROJO : GRIS)
        }
        // nombre del archivo
        var nombre = vacio(ruta) ? "(campo vacío)" : String(ruta).replace(/^.*[\/\\](?=[A-Za-z]_)/, "")
        pg.textoCentro(x + w / 2, yy + h - 3.5, recortar(nombre, 6.5, estado === "mal", w - 8), 6.5, estado === "mal", estado === "mal" ? ROJO : GRIS)
    }

    function siNo(v) {
        if (v === true || v === "true" || v === 1 || v === "1") return "Sí"
        if (v === false || v === "false" || v === 0 || v === "0") return "No"
        return vacio(v) ? "" : String(v)
    }
    // Dato del contador relleno sin foto de contador → en rojo
    function rojoSF(a, campo) { return (P.sinFotoContConDatos && !vacio(a[campo])) ? { rgb: ROJO, bold: true } : undefined }
    function ubicacion(a) {
        var e = siNo(a.Exterior) === "Sí", i = siNo(a.Interior) === "Sí", u = siNo(a.UbicarExte) === "Sí"
        var txtI = i ? (u ? "Interior / Ubicar Exterior" : "Interior") : ""
        return e && i ? "Exterior / " + txtI : e ? "Exterior" : txtI
    }

    var conFicha = datos.fallos.filter(function (q) { return !vacio(q.attrs.NUM_ORDEN) })
    var nFichas = conFicha.length
    for (var fI = 0; fI < nFichas; fI++) {
        var P = conFicha[fI], A = P.attrs
        nuevaPagina()
        // Banda superior
        pg.rect(0, 0, W, 34, VERDE)
        pg.texto(MX, 22, "FICHA DE REVISIÓN  " + (fI + 1) + " / " + nFichas, 12, true, BLANCO)
        pg.textoDer(W - MX, 22, recortar(datos.capa, 8.5, false, 260), 8.5, false, [0.8, 0.93, 0.8])
        y = 44

        // Fila 1: Nº DE ORDEN | DIRECCIÓN | TIPO DE EDIFICACIÓN
        var w1 = 95, w3 = 110, w2 = cw - w1 - w3
        par(MX, y, w1, 34, "Nº DE ORDEN", A.NUM_ORDEN, { bold: true, size: 9.5 })
        par(MX + w1, y, w2, 34, "DIRECCIÓN - Nº POLICÍA", vacio(A.Direccion) ? "(SIN DIRECCIÓN)" : A.Direccion,
            { bold: true, size: 9.5, rgb: vacio(A.Direccion) ? ROJO : NEGRO })
        par(MX + w1 + w2, y, w3, 34, "TIPO DE EDIFICACIÓN", A.TipEdifica)
        y += 40

        // Caja REVISIÓN
        var lin = []
        for (var k = 0; k < P.incidencias.length; k++) lin = lin.concat(partirTexto("- " + P.incidencias[k].texto, 8.5, true, cw - 20, 2))
        var hRev = 16 + lin.length * 11 + 4
        pg.rect(MX, y, cw, hRev, ROJOF)
        pg.rect(MX, y, cw, 13, ROJO)
        pg.texto(MX + 8, y + 9.5, "REVISIÓN", 8, true, BLANCO)
        pg.marco(MX, y, cw, hRev, ROJO, 0.8)
        for (k = 0; k < lin.length; k++) pg.texto(MX + 10, y + 13 + 11 * (k + 1) - 1, lin[k], 8.5, true, ROJO)
        y += hRev + 6

        // Alturas de los tres bloques de fotos
        var disp = (H - 30) - y - 12
        var hB1 = Math.round(disp * 0.33), hB2 = Math.round(disp * 0.33), hB3 = disp - hB1 - hB2
        var wFoto = 300, xd = MX + wFoto + 6, wd = cw - wFoto - 6, wh = wd / 2

        // Bloque 1: SITUACIÓN + datos de ubicación + Nº ORDEN
        cajaFoto(MX, y, wFoto, hB1, FOTOS[0], P)
        var yy = y
        // Nº ORDEN (en lugar del Código QR)
        pg.rect(xd, yy, wd, 13, VERDE)
        pg.textoCentro(xd + wd / 2, yy + 9.5, "Nº ORDEN", 8, true, BLANCO)
        pg.rect(xd, yy + 13, wd, 34, [0.91, 0.96, 0.91])
        pg.marco(xd, yy + 13, wd, 34, VERDE, 1)
        pg.textoCentro(xd + wd / 2, yy + 13 + 25, recortar(vacio(A.NUM_ORDEN) ? "-" : A.NUM_ORDEN, 22, true, wd - 10), 22, true, VERDE)
        yy += 47 + 4
        var hp = Math.max(26, (y + hB1 - yy) / 4)
        par(xd, yy, wh, hp, "Ubicación del contador", ubicacion(A));  par(xd + wh, yy, wh, hp, "Nº de contador", A.NContador); yy += hp
        par(xd, yy, wh, hp, "Cambio de tapa", siNo(A.CambioTapa));     par(xd + wh, yy, wh, hp, "Tipo de uso consumo", A.TipUsoComu); yy += hp
        par(xd, yy, wh, hp, "Alojamiento", A.Alojamient);              par(xd + wh, yy, wh, hp, "Tipo de edificación", A.TipEdifica); yy += hp
        par(xd, yy, wh, hp, "Diámetro", A.Diametros, rojoSF(A, "Diametros"));                  par(xd + wh, yy, wh, hp, "Calibre", A.Calibre, rojoSF(A, "Calibre"))
        y += hB1 + 6

        // Bloque 2: INMUEBLE + resto de datos
        cajaFoto(MX, y, wFoto, hB2, FOTOS[1], P)
        yy = y
        var sinSerie = vacio(A.NSerieCont), sinObs = vacio(A.Observacio)
        var marcar = sinSerie && sinObs && !vacio(A.FContador)
        var hq = Math.max(26, (hB2 - 4) / 5)
        par(xd, yy, wh, hq, "Lectura", A.Lectura, rojoSF(A, "Lectura"));                     par(xd + wh, yy, wh, hq, "Llave de contador", siNo(A.LlaveCorte)); yy += hq
        par(xd, yy, wh, hq, "Fecha", A.FecLectura);                    par(xd + wh, yy, wh, hq, "Marca/Modelo", A.MarcaModel, rojoSF(A, "MarcaModel")); yy += hq
        par(xd, yy, wh, hq, "Latitud", A.Latitud);                     par(xd + wh, yy, wh, hq, "Longitud", A.Longitud); yy += hq
        par(xd, yy, wd, hq, "Nº serie contador", sinSerie ? (marcar ? "(VACÍO)" : "") : A.NSerieCont, { bold: !sinSerie, rgb: (marcar || (P.sinFotoContConDatos && !sinSerie)) ? ROJO : NEGRO }); yy += hq
        par(xd, yy, wd, y + hB2 - yy, "Observaciones", sinObs ? (marcar ? "(VACÍO)" : "") : A.Observacio, { size: 7.5, rgb: marcar ? ROJO : NEGRO })
        y += hB2 + 6

        // Bloque 3: ARQUETA | CONTADOR
        var wm = (cw - 6) / 2
        cajaFoto(MX, y, wm, hB3, FOTOS[3], P)
        cajaFoto(MX + wm + 6, y, wm, hB3, FOTOS[2], P)
    }

    // Pies de página
    for (var pI = 0; pI < paginas.length; pI++) {
        var pp = paginas[pI]
        pp.linea(MX, H - 26, W - MX, H - 26, [0.85, 0.87, 0.9], 0.5)
        pp.textoCursiva(MX, H - 14, "Informe Generado: " + datos.generado + "   |   Responsable: " + (datos.responsable || "-") + "   |   Tablet: " + (datos.tablet || "-"), 7, GRIS)
        pp.textoDer(W - MX, H - 14, "Página " + (pI + 1) + " de " + paginas.length, 7, false, GRIS)
    }

    return { pdf: ensamblar(paginas, imagenes), paginas: paginas.length, fotos: imagenes.length,
             fotosNoLeidas: fotosNoLeidas, bytesFotos: bytesFotos }
}

// Construye el PDF binario (texto ASCII + flujos JPEG) → ArrayBuffer
function ensamblar(paginas, imagenes) {
    var partes = [], pos = 0, offs = []
    function add(x) { partes.push(x); pos += x.length }
    function obj(cuerpo) { offs.push(pos); add((offs.length) + " 0 obj\n" + cuerpo + "\nendobj\n") }

    var nImg0 = 6, nPag0 = 6 + imagenes.length
    var kids = []
    for (var i = 0; i < paginas.length; i++) kids.push((nPag0 + i * 2) + " 0 R")

    add("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")
    obj("<< /Type /Catalog /Pages 2 0 R >>")
    obj("<< /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + paginas.length + " >>")
    obj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    obj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
    obj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>")
    var numImg = {}
    for (i = 0; i < imagenes.length; i++) {
        var im = imagenes[i]
        numImg[im.nombre] = nImg0 + i
        var cs = im.comps === 1 ? "/DeviceGray" : (im.comps === 4 ? "/DeviceCMYK" : "/DeviceRGB")
        var dec = (im.comps === 4 && im.adobe) ? " /Decode [1 0 1 0 1 0 1 0]" : ""
        offs.push(pos)
        add((offs.length) + " 0 obj\n<< /Type /XObject /Subtype /Image /Width " + im.w + " /Height " + im.h +
            " /ColorSpace " + cs + " /BitsPerComponent 8 /Filter /DCTDecode" + dec + " /Length " + im.bytes.length + " >>\nstream\n")
        add(im.bytes)
        add("\nendstream\nendobj\n")
    }
    for (i = 0; i < paginas.length; i++) {
        var nCont = nPag0 + i * 2 + 1
        var xo = []
        for (var nm in paginas[i].imgs) xo.push("/" + nm + " " + numImg[nm] + " 0 R")
        obj("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + num(W) + " " + num(H) + "] " +
            "/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >>" + (xo.length ? " /XObject << " + xo.join(" ") + " >>" : "") +
            " >> /Contents " + nCont + " 0 R >>")
        var stream = paginas[i].ops.join("\n")
        obj("<< /Length " + stream.length + " >>\nstream\n" + stream + "\nendstream")
    }
    var xref = pos
    var t = "xref\n0 " + (offs.length + 1) + "\n0000000000 65535 f \n"
    for (i = 0; i < offs.length; i++) t += ("0000000000" + offs[i]).slice(-10) + " 00000 n \n"
    t += "trailer\n<< /Size " + (offs.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n"
    add(t)

    var out = new Uint8Array(pos), o = 0
    for (i = 0; i < partes.length; i++) {
        var x = partes[i]
        if (typeof x === "string") { for (var j = 0; j < x.length; j++) out[o + j] = x.charCodeAt(j) & 0xFF }
        else out.set(x, o)
        o += x.length
    }
    return out.buffer
}
