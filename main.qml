// main.qml — Revisión de fotos y direcciones (Plugin QField)
// Versión 1.6.0 — compatible QField 3.x
// 1.6.0: «SIN FOTO DE CONTADOR/ARQUETA Y SIN OBSERVACIONES (JUSTIFICAR)»; puntos sin fotos pero con fecha en rango sí se revisan
// 1.5.0: «Incluir puntos sin fecha»; puntos sin NUM_ORDEN sólo en el listado (sin ficha)
// 1.4.0: sin foto de contador no puede haber Nº serie, Diámetro, Calibre, Lectura ni Marca/Modelo
// 1.3.0: filtro por fechas (FecHoraLec) con calendario y opción «No filtrar por fechas»
// Comprueba en la capa activa que los nombres de las fotos (Situacion, FInmueble,
// FContador, FArqueta) coinciden con "Direccion", detecta direcciones vacías o
// duplicadas, fotos obligatorias que faltan y contadores sin nº de serie ni
// observaciones, y genera un PDF: resumen + una ficha con fotos por punto.

import QtQuick 2.12
import QtQuick.Controls 2.12
import QtQuick.Layouts 1.12
import org.qfield 1.0
import Theme 1.0
import "revision.js" as Rev

Item {
    id: pluginRoot

    property var mapCanvas:  iface.mapCanvas()
    property var mainWindow: iface.mainWindow()
    property bool panelVisible: false

    property var    capas: []
    property bool   usarCapaActiva: true
    property string selCapaNombre: ""
    property bool   incluirFotos: true
    property string resultado: ""
    property string avisos: ""
    property string ultimoPdf: ""
    property bool   ocupado: false
    property int    pendienteConfirmar: -1     // nº de fichas pendiente de confirmar (PDF grande)
    property bool   restaurado: false
    property bool   noFiltrarFechas: false     // "No filtrar por fechas"
    property bool   incluirSinFecha: true      // "Incluir puntos sin fecha"

    // Meses: en español con su abreviatura inglesa (la que usa FecHoraLec)
    readonly property var mesesES:  ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"]
    readonly property var mesesCortosES: ["ene.","feb.","mar.","abr.","may.","jun.","jul.","ago.","sep.","oct.","nov.","dic."]
    readonly property var mesesEN:  ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

    // Estado del calendario
    property bool calAbierto: false
    property string calVista: "dias"    // "dias" | "meses"
    property int calAnio: 2026
    property int calMes: 0
    property var selIni: null
    property var selFin: null

    readonly property color cPrimary:   "#005F8E"
    readonly property color cSecondary: "#00B4D8"
    readonly property color cBg:        "#F0F4F8"
    readonly property color cCard:      "#FFFFFF"
    readonly property color cText:      "#1A1A2E"
    readonly property color cMuted:     "#6B7280"
    readonly property color cDanger:    "#EF4444"
    readonly property color cOk:        "#2E7D32"

    readonly property int fichasGrande: 120     // a partir de aquí se pide confirmación (fotos incluidas)

    // Campos que se leen de cada punto (los que no existan en la capa quedan vacíos)
    readonly property var camposFicha: ["Direccion", "Situacion", "FInmueble", "FContador", "FArqueta", "NUM_ORDEN",
        "NSerieCont", "Observacio", "Nfijo", "TipEdifica", "Exterior", "Interior", "ModRadio", "ValAcometi",
        "TipUsoComu", "Latitud", "Longitud", "Individual", "Alojamient", "LlaveCorte", "Calibre", "Diametros",
        "Lectura", "FecLectura", "MarcaModel", "Se borra?", "NContador", "CambioTapa", "UbicarExte", "FecHoraLec"]

    function toast(msg) { mainWindow.displayToast(msg) }

    // ── Persistencia ──
    readonly property string pref: "revision_fotos/"
    function leerAjuste(k, def) {
        try { var v = settings.value(pref + k, def); return (v === undefined || v === null) ? def : v } catch (e) { return def }
    }
    function guardarAjuste(k, v) { try { settings.setValue(pref + k, v) } catch (e) {} }
    function restaurarAjustes() {
        if (restaurado) return
        restaurado = true
        fResponsable.text = String(leerAjuste("responsable", ""))
        fTablet.text      = String(leerAjuste("tablet", ""))
        var ua = leerAjuste("usarCapaActiva", true); usarCapaActiva = !(ua === false || ua === "false")
        var inf = leerAjuste("incluirFotos", true);  incluirFotos = !(inf === false || inf === "false")
        selCapaNombre = String(leerAjuste("capa", ""))
        fDesde.text = String(leerAjuste("desde", hoyTxt(0)))
        fHasta.text = String(leerAjuste("hasta", hoyTxt(0)))
        var nf = leerAjuste("noFiltrarFechas", false); noFiltrarFechas = (nf === true || nf === "true")
        var isf = leerAjuste("incluirSinFecha", true); incluirSinFecha = !(isf === false || isf === "false")
    }
    function guardarAjustes() {
        guardarAjuste("responsable", fResponsable.text)
        guardarAjuste("tablet", fTablet.text)
        guardarAjuste("usarCapaActiva", usarCapaActiva)
        guardarAjuste("incluirFotos", incluirFotos)
        guardarAjuste("capa", selCapaNombre)
        guardarAjuste("desde", fDesde.text)
        guardarAjuste("hasta", fHasta.text)
        guardarAjuste("noFiltrarFechas", noFiltrarFechas)
        guardarAjuste("incluirSinFecha", incluirSinFecha)
    }

    // ── Capas ──
    function capaActivaQField() {
        try { if (typeof dashBoard !== "undefined" && dashBoard && dashBoard.activeLayer) return dashBoard.activeLayer } catch (e) {}
        try { var d = iface.findItemByObjectName("dashBoard"); if (d && d.activeLayer) return d.activeLayer } catch (e2) {}
        return null
    }
    function cargarCapas() {
        var lista = []
        try {
            var mapa = ProjectUtils.mapLayers(qgisProject)
            for (var id in mapa) {
                var l = mapa[id]
                if (l && (l.type === 0 || l.type === undefined)) lista.push({ nombre: l.name, capa: l })
            }
        } catch (e) {}
        var activa = capaActivaQField()
        if (activa) {
            var esta = false
            for (var j = 0; j < lista.length; j++) if (lista[j].capa === activa) { esta = true; break }
            if (!esta) lista.push({ nombre: activa.name, capa: activa })
        }
        lista.sort(function (a, b) { return a.nombre.localeCompare(b.nombre) })
        capas = lista
        var idx = -1, i
        if (usarCapaActiva && activa) {
            for (i = 0; i < lista.length; i++) if (lista[i].capa === activa) { idx = i; break }
        } else {
            for (i = 0; i < lista.length; i++) if (lista[i].nombre === selCapaNombre) { idx = i; break }
            if (idx < 0 && activa) for (i = 0; i < lista.length; i++) if (lista[i].capa === activa) { idx = i; break }
        }
        if (usarCapaActiva && !activa) toast("⚠ No se detecta la capa activa: elige la capa en la lista")
        cbCapa.currentIndex = idx
        if (idx >= 0) selCapaNombre = lista[idx].nombre
        resultado = ""; avisos = ""; pendienteConfirmar = -1
    }
    function capaActual() {
        return (cbCapa.currentIndex >= 0 && cbCapa.currentIndex < capas.length) ? capas[cbCapa.currentIndex].capa : null
    }

    // ── Lectura de datos ──
    function error(msg) { toast("⚠ " + msg); avisos = "⛔ " + msg; resultado = ""; return null }

    function valorTexto(v) {
        if (v === null || v === undefined) return ""
        if (typeof v === "boolean") return v
        if (typeof v === "object" && typeof v.getTime === "function")
            return isNaN(v.getTime()) ? "" : Rev.fmtFecha(v)
        var s = String(v)
        return s === "NULL" ? "" : s
    }

    // Recorre la capa → {puntos, total} o null
    function leerPuntos() {
        var capa = capaActual()
        if (!capa) return error("Selecciona una capa (o activa una capa en QField).")
        var it
        try { it = LayerUtils.createFeatureIteratorFromExpression(capa, "TRUE") }
        catch (e) { return error("La capa seleccionada no es vectorial.") }
        var puntos = [], nombres = null, presentes = []
        while (it.hasNext()) {
            var f = it.next()
            if (!nombres) {
                nombres = []
                var n = f.fields.names
                for (var i = 0; i < n.length; i++) nombres.push(n[i])
                var faltan = Rev.CAMPOS_OBLIGATORIOS.filter(function (c) { return nombres.indexOf(c) < 0 })
                if (faltan.length) { it.close(); return error("La capa '" + capa.name + "' no tiene los campos: " + faltan.join(", ") + ". ¿Es la capa de contadores?") }
                presentes = camposFicha.filter(function (c) { return nombres.indexOf(c) >= 0 })
            }
            var attrs = {}
            for (var k = 0; k < presentes.length; k++) attrs[presentes[k]] = valorTexto(f.attribute(presentes[k]))
            puntos.push({ fid: String(f.id), attrs: attrs })
        }
        it.close()
        if (!puntos.length) return error("La capa '" + capa.name + "' no tiene puntos.")
        return { puntos: puntos, total: puntos.length }
    }

    // Lee una foto (ruta relativa al proyecto) como Uint8Array
    function leerFoto(rel) {
        var r = String(rel).replace(/\\/g, "/")
        var ruta = (r.charAt(0) === "/" || /^[A-Za-z]:/.test(r)) ? r : qgisProject.homePath + "/" + r
        try {
            var c = FileUtils.readFileContent(ruta)
            if (c && c.byteLength > 0) return new Uint8Array(c)
        } catch (e) {}
        try {
            var x = new XMLHttpRequest()
            x.open("GET", "file://" + ruta, false)
            x.responseType = "arraybuffer"
            x.send()
            if (x.response && x.response.byteLength > 0) return new Uint8Array(x.response)
        } catch (e2) {}
        return null
    }

    // ── Filtro de fechas (FecHoraLec): desde el día "Desde" 00:00 hasta el día "Hasta" 23:59:59 ──
    // Devuelve {filtro: null | {dIni, dFin}, texto} o null si hay un error en las fechas
    function leerFiltroFechas() {
        if (noFiltrarFechas) return { filtro: null, texto: "Sin filtro de fechas" }
        var tD = fDesde.text.trim(), tH = fHasta.text.trim()
        var dIni = Rev.parseDia(tD), dFin = Rev.parseDia(tH)
        if (!dIni) return error("Fecha 'Desde' no válida: '" + tD + "'. Formato dd/mm/aaaa y que el día exista (p.ej. no 31/02).")
        if (!dFin) return error("Fecha 'Hasta' no válida: '" + tH + "'. Formato dd/mm/aaaa y que el día exista (p.ej. no 31/02).")
        var anioHoy = new Date().getFullYear()
        if (dIni.getFullYear() < 2000 || dIni.getFullYear() > anioHoy + 1) return error("El año de 'Desde' (" + dIni.getFullYear() + ") no parece correcto.")
        if (dFin.getFullYear() < 2000 || dFin.getFullYear() > anioHoy + 1) return error("El año de 'Hasta' (" + dFin.getFullYear() + ") no parece correcto.")
        if (dFin.getTime() < dIni.getTime()) return error("La fecha 'Hasta' (" + tH + ") es anterior a 'Desde' (" + tD + ").")
        var txt = (dIni.getTime() === dFin.getTime() ? "Día " + Rev.fmtFecha(dIni) : "Del " + Rev.fmtFecha(dIni) + " al " + Rev.fmtFecha(dFin)) +
                  " (00:00 a 23:59)" + (incluirSinFecha ? " + puntos sin fecha" : ", sin los puntos sin fecha")
        return { filtro: { dIni: dIni, dFin: dFin, incluirSinFecha: incluirSinFecha }, texto: txt }
    }

    function textoResultado(r, total, ff) {
        var s = r.fallos.length + " de " + r.revisados + " puntos a revisar"
        s += "\n" + ff.texto
        if (r.fueraRango) s += "\n(" + r.fueraRango + " puntos fuera del rango de fechas)"
        if (r.excluidos) s += "\n(" + r.excluidos + " no revisados: " + (r.exclBorra ? r.exclBorra + " con «Se borra?» = TRUE" : "") +
                              (r.exclBorra && r.exclSinFotos ? ", " : "") + (r.exclSinFotos ? r.exclSinFotos + " sin ninguna foto" : "") + ")"
        var t = [["sindir", "Sin dirección"], ["dup", "Dirección duplicada"], ["fotos", "Fotos no coinciden"],
                 ["falta", "Falta foto Situación/Inmueble"], ["serie", "Sin nº serie ni observaciones"],
                 ["contador", "Sin foto de contador pero con datos"], ["sinorden", "Sin Nº de orden (sin ficha)"],
                 ["justificar", "Sin foto contador/arqueta ni observaciones"]]
        for (var i = 0; i < t.length; i++) if (r.resumen[t[i][0]] > 0) s += "\n• " + t[i][1] + ": " + r.resumen[t[i][0]]
        return s
    }

    function revisarCapa() {
        avisos = ""; pendienteConfirmar = -1
        var ff = leerFiltroFechas(); if (!ff) return
        var d = leerPuntos(); if (!d) return
        guardarAjustes()
        var r = Rev.revisar(d.puntos, ff.filtro)
        resultado = textoResultado(r, d.total, ff)
        if (r.fallos.length === 0) toast("✔ Todo correcto: no hay puntos que revisar")
    }

    // ── PDF ──
    function nombreSeguro(s) { return String(s).replace(/[^A-Za-z0-9_\-]+/g, "_").substring(0, 60) }

    function pedirPdf() {
        if (ocupado) return
        ocupado = true
        timerPdf.start()          // deja que se pinte el aviso "Generando..." antes del cálculo
    }
    Timer { id: timerPdf; interval: 120; repeat: false; onTriggered: { pluginRoot.generar(); pluginRoot.ocupado = false } }

    function generar() {
        avisos = ""
        var ff = leerFiltroFechas(); if (!ff) return
        var d = leerPuntos(); if (!d) return
        if (fResponsable.text.trim() === "" || fTablet.text.trim() === "") avisos = "ℹ Responsable o Tablet vacíos: salen como '-' en el PDF."
        guardarAjustes()
        var capa = capaActual()
        var r = Rev.revisar(d.puntos, ff.filtro)
        resultado = textoResultado(r, d.total, ff)

        // PDF grande: pedir confirmación (pulsando otra vez)
        if (incluirFotos && r.fallos.length > fichasGrande && pendienteConfirmar !== r.fallos.length) {
            pendienteConfirmar = r.fallos.length
            avisos = "⚠ Hay " + r.fallos.length + " fichas: el PDF puede llevar hasta " + (r.fallos.length * 4) +
                     " fotos (varios cientos de MB) y tardar varios minutos.\nPulsa otra vez «Generar PDF» para continuar, o desmarca «Incluir fotos»."
            toast("⚠ PDF muy grande: revisa el aviso")
            return
        }
        pendienteConfirmar = -1

        var ahora = new Date()
        var res
        try {
            res = Rev.generarPDF({
                capa: capa.name,
                responsable: fResponsable.text.trim(),
                tablet: fTablet.text.trim(),
                generado: Rev.fmtFechaHora(ahora),
                totalCapa: d.total,
                revisados: r.revisados, excluidos: r.excluidos, exclBorra: r.exclBorra, exclSinFotos: r.exclSinFotos,
                fueraRango: r.fueraRango, filtroTxt: ff.texto,
                fallos: r.fallos,
                resumen: r.resumen,
                incluirFotos: incluirFotos,
                leerFoto: leerFoto
            })
        } catch (e) { error("Error al generar el PDF: " + e); return }

        var sello = ahora.getFullYear() + Rev.pad2(ahora.getMonth() + 1) + Rev.pad2(ahora.getDate()) + "_" +
                    Rev.pad2(ahora.getHours()) + Rev.pad2(ahora.getMinutes()) + Rev.pad2(ahora.getSeconds())
        var ruta = qgisProject.homePath + "/Revision_Fotos_" + nombreSeguro(capa.name) + "_" + sello + ".pdf"
        var ok = false
        try { ok = FileUtils.writeFileContent(ruta, res.pdf) } catch (e3) { ok = false }
        if (!ok) { error("No se pudo escribir el PDF en " + ruta); return }

        ultimoPdf = ruta
        var mb = (res.bytesFotos / 1048576).toFixed(1).replace(".", ",")
        resultado += "\n\nPDF: " + ruta.split("/").pop() + "\n" + res.paginas + " páginas · " + res.fotos + " fotos (" + mb + " MB)"
        if (incluirFotos && res.fotosNoLeidas > 0)
            avisos = (avisos ? avisos + "\n" : "") + "⚠ " + res.fotosNoLeidas + " foto(s) no se encontraron en la carpeta del proyecto: salen como «Foto no encontrada»."
        toast("✔ PDF generado (" + r.fallos.length + " fichas)")
        abrirPdf()
    }

    function abrirPdf() {
        if (!ultimoPdf) return
        try { platformUtilities.open(ultimoPdf); return } catch (e) {}
        try { Qt.openUrlExternally("file://" + ultimoPdf) } catch (e2) { toast("PDF guardado en: " + ultimoPdf) }
    }

    // ── Calendario ──
    function hoyTxt(offsetDias) { var d = new Date(); d.setDate(d.getDate() + (offsetDias || 0)); return Rev.fmtFecha(d) }
    function abrirCalendario() {
        if (noFiltrarFechas) return
        selIni = Rev.parseDia(fDesde.text) || new Date(new Date().setHours(0, 0, 0, 0))
        selFin = Rev.parseDia(fHasta.text) || selIni
        calAnio = selIni.getFullYear(); calMes = selIni.getMonth()
        calVista = "dias"
        Qt.inputMethod.hide()
        calAbierto = true
    }
    function diaCelda(i) {
        var primero = new Date(calAnio, calMes, 1)
        var off = (primero.getDay() + 6) % 7          // lunes = 0
        return new Date(calAnio, calMes, 1 - off + i)
    }
    function mismoDia(a, b) { return a && b && a.getTime() === b.getTime() }
    function tocarDia(d) {
        if (!selIni || selFin) { selIni = d; selFin = null }
        else if (d.getTime() < selIni.getTime()) { selFin = selIni; selIni = d }
        else selFin = d
        if (d.getMonth() !== calMes) { calAnio = d.getFullYear(); calMes = d.getMonth() }
    }
    function moverCal(delta) {
        if (calVista === "meses") { calAnio += delta; return }
        var m = calMes + delta
        calAnio += Math.floor(m / 12); calMes = ((m % 12) + 12) % 12
    }
    function aceptarCalendario() {
        if (!selIni) { calAbierto = false; return }
        fDesde.text = Rev.fmtFecha(selIni)
        fHasta.text = Rev.fmtFecha(selFin || selIni)
        calAbierto = false
    }

    // ─────────────────────────────────────────────
    // INTERFAZ
    // ─────────────────────────────────────────────
    component Etiqueta: Text { font.pixelSize: 11; font.bold: true; color: pluginRoot.cMuted }

    component Campo: TextField {
        height: 38; font.pixelSize: 14; leftPadding: 8
        horizontalAlignment: Text.AlignHCenter
        inputMethodHints: Qt.ImhPreferNumbers
        color: pluginRoot.cText
        placeholderTextColor: "#9CA3AF"
        selectionColor: pluginRoot.cSecondary
        selectedTextColor: "white"
        background: Rectangle { color: parent.enabled ? "#F9FAFB" : "#E5E7EB"; radius: 7; border.color: parent.activeFocus ? pluginRoot.cSecondary : "#D1D5DB"; border.width: 1 }
    }

    component Chip: Rectangle {
        id: chip
        property string texto: ""
        property bool destacado: false
        signal pulsado()
        height: 28; width: chipTxt.implicitWidth + 20; radius: 14
        color: destacado ? pluginRoot.cPrimary : "#E0F2FE"; border.color: destacado ? pluginRoot.cPrimary : pluginRoot.cSecondary; border.width: 1
        Text { id: chipTxt; anchors.centerIn: parent; text: chip.texto; font.pixelSize: 11; color: chip.destacado ? "white" : pluginRoot.cPrimary; font.bold: true }
        MouseArea { anchors.fill: parent; enabled: chip.enabled; onClicked: chip.pulsado() }
    }

    component CampoTexto: TextField {
        id: ct
        property string pista: ""
        height: 38; font.pixelSize: 14; leftPadding: 10
        inputMethodHints: Qt.ImhNone
        color: pluginRoot.cText
        placeholderText: ""
        Text {
            anchors { left: parent.left; leftMargin: ct.leftPadding; right: parent.right; verticalCenter: parent.verticalCenter }
            text: ct.pista
            visible: ct.text.length === 0 && ct.preeditText.length === 0
            font.pixelSize: 14; color: "#9CA3AF"; elide: Text.ElideRight
        }
        selectionColor: pluginRoot.cSecondary
        selectedTextColor: "white"
        background: Rectangle { color: "white"; radius: 7; border.color: parent.activeFocus ? pluginRoot.cSecondary : "#D1D5DB"; border.width: 1 }
    }

    component Selector: ComboBox {
        id: sel
        height: 40; font.pixelSize: 13
        background: Rectangle { color: "#F9FAFB"; radius: 7; border.color: "#D1D5DB"; border.width: 1 }
        contentItem: Text {
            leftPadding: 10; rightPadding: sel.indicator ? sel.indicator.width + 6 : 10
            text: sel.displayText; font: sel.font; color: pluginRoot.cText
            verticalAlignment: Text.AlignVCenter; elide: Text.ElideRight
        }
        delegate: ItemDelegate {
            width: sel.popup.width
            highlighted: sel.highlightedIndex === index
            contentItem: Text { text: modelData; font.pixelSize: 13; color: pluginRoot.cText; verticalAlignment: Text.AlignVCenter; elide: Text.ElideRight }
            background: Rectangle { color: highlighted ? "#E0F2FE" : "white" }
        }
        popup.background: Rectangle { color: "white"; radius: 7; border.color: "#D1D5DB"; border.width: 1 }
    }

    component Casilla: Rectangle {
        id: cas
        property bool marcada: false
        property string texto: ""
        property string detalle: ""
        signal pulsada()
        width: parent ? parent.width : 0; height: Math.max(44, colCas.implicitHeight + 16); radius: 8
        color: marcada ? "#E0F2FE" : "#F9FAFB"
        border.color: marcada ? pluginRoot.cSecondary : "#E5E7EB"; border.width: 1
        RowLayout {
            anchors { fill: parent; leftMargin: 10; rightMargin: 10 }
            spacing: 10
            Rectangle {
                width: 22; height: 22; radius: 5
                color: cas.marcada ? pluginRoot.cPrimary : "white"
                border.color: cas.marcada ? pluginRoot.cPrimary : "#9CA3AF"; border.width: 2
                Text { anchors.centerIn: parent; text: "✓"; color: "white"; font.bold: true; visible: cas.marcada }
            }
            Column {
                id: colCas
                Layout.fillWidth: true; spacing: 2
                Text { width: parent.width; text: cas.texto; font.pixelSize: 13; color: pluginRoot.cText; wrapMode: Text.WordWrap }
                Text { width: parent.width; visible: cas.detalle !== ""; text: cas.detalle; font.pixelSize: 10; color: pluginRoot.cMuted; wrapMode: Text.WordWrap }
            }
        }
        MouseArea { anchors.fill: parent; onClicked: cas.pulsada() }
    }

    component Tarjeta: Rectangle {
        id: tarjeta
        default property alias contenido: cuerpo.data
        property string titulo: ""
        property color colorTitulo: pluginRoot.cPrimary
        width: parent ? parent.width : 0; height: col.height + 16
        radius: 10; color: pluginRoot.cCard
        border.color: "#E5E7EB"; border.width: 1
        Column {
            id: col
            anchors { left: parent.left; right: parent.right; top: parent.top; margins: 10 }
            spacing: 6
            Rectangle {
                width: parent.width; height: 28; radius: 8; color: tarjeta.colorTitulo
                Text { anchors { left: parent.left; leftMargin: 10; verticalCenter: parent.verticalCenter }
                    text: tarjeta.titulo; font.pixelSize: 12; font.bold: true; color: "white" }
            }
            Column { id: cuerpo; width: parent.width; spacing: 6 }
        }
    }

    // ── BOTÓN EN LA BARRA DE PLUGINS ──
    QfToolButton {
        id: botonRevision
        iconSource: Qt.resolvedUrl("icon_toolbar.svg")
        iconColor: Theme.mainColor
        bgcolor: Theme.darkGray
        round: true
        onClicked: { pluginRoot.restaurarAjustes(); pluginRoot.cargarCapas(); pluginRoot.panelVisible = true }
    }

    // ── PANEL ──
    Rectangle {
        parent: mainWindow.contentItem
        anchors.fill: parent
        color: "#CC000000"
        visible: pluginRoot.panelVisible
        z: 10000
        MouseArea { anchors.fill: parent; onClicked: {} }

        Rectangle {
            id: panel
            width:  Math.min(parent.width  * 0.92, 460)
            height: Math.min(parent.height * 0.92, 640)
            anchors.centerIn: parent
            radius: 18; color: pluginRoot.cBg; clip: true

            Rectangle {
                id: hdr
                width: parent.width; height: 60; color: pluginRoot.cOk; radius: 18
                Rectangle { width: parent.width; height: 18; anchors.bottom: parent.bottom; color: parent.color }
                RowLayout {
                    anchors { fill: parent; leftMargin: 14; rightMargin: 14 }
                    spacing: 8
                    Text { text: "🔎"; font.pixelSize: 20; color: "white" }
                    Column {
                        Layout.fillWidth: true
                        Text { text: "Revisión de fotos y direcciones"; font.pixelSize: 15; font.bold: true; color: "white" }
                        Text { text: "PDF con los puntos a revisar y sus fotos"; font.pixelSize: 10; color: "#C8E6C9" }
                    }
                    Rectangle {
                        width: 30; height: 30; radius: 15; color: "#22FFFFFF"
                        Text { anchors.centerIn: parent; text: "✕"; color: "white"; font.pixelSize: 15 }
                        MouseArea { anchors.fill: parent; onClicked: { pluginRoot.guardarAjustes(); pluginRoot.panelVisible = false } }
                    }
                }
            }

            ScrollView {
                anchors { top: hdr.bottom; left: parent.left; right: parent.right; bottom: barAcciones.top }
                clip: true
                ScrollBar.horizontal.policy: ScrollBar.AlwaysOff

                Column {
                    width: panel.width - 24
                    x: 12; y: 10
                    spacing: 10

                    Tarjeta {
                        titulo: "👤 Responsable"
                        colorTitulo: "#37474F"
                        RowLayout {
                            width: parent.width; spacing: 8
                            Text { text: "Responsable :"; font.pixelSize: 13; font.bold: true; color: pluginRoot.cText; Layout.preferredWidth: 100 }
                            CampoTexto { id: fResponsable; Layout.fillWidth: true; pista: "Nombre y apellidos" }
                        }
                        RowLayout {
                            width: parent.width; spacing: 8
                            Text { text: "Tablet :"; font.pixelSize: 13; font.bold: true; color: pluginRoot.cText; Layout.preferredWidth: 100 }
                            CampoTexto { id: fTablet; Layout.fillWidth: true; pista: "Ej. TABLET 4" }
                        }
                    }

                    Tarjeta {
                        titulo: "🗂️ Capa"
                        Casilla {
                            texto: "Trabajar sobre la capa activa"
                            marcada: pluginRoot.usarCapaActiva
                            onPulsada: {
                                pluginRoot.usarCapaActiva = !pluginRoot.usarCapaActiva
                                if (pluginRoot.usarCapaActiva) pluginRoot.cargarCapas()
                                pluginRoot.guardarAjuste("usarCapaActiva", pluginRoot.usarCapaActiva)
                            }
                        }
                        Etiqueta { text: pluginRoot.usarCapaActiva ? "Capa (la activa en QField)" : "Capa (elegida manualmente)" }
                        Selector {
                            id: cbCapa; width: parent.width
                            enabled: !pluginRoot.usarCapaActiva
                            opacity: enabled ? 1 : 0.75
                            model: pluginRoot.capas.map(function (c) { return c.nombre })
                            onActivated: {
                                pluginRoot.selCapaNombre = currentText
                                pluginRoot.resultado = ""; pluginRoot.avisos = ""; pluginRoot.pendienteConfirmar = -1
                                pluginRoot.guardarAjuste("capa", pluginRoot.selCapaNombre)
                            }
                        }
                        Casilla {
                            texto: "Incluir fotos en las fichas del PDF"
                            marcada: pluginRoot.incluirFotos
                            onPulsada: { pluginRoot.incluirFotos = !pluginRoot.incluirFotos; pluginRoot.pendienteConfirmar = -1 }
                        }
                        Text {
                            width: parent.width; wrapMode: Text.WordWrap; font.pixelSize: 10; color: pluginRoot.cMuted
                            text: "Se comprueba: dirección vacía o duplicada; que las fotos de Situación, Inmueble, Contador y Arqueta se llamen como la dirección; que existan las fotos de Situación e Inmueble; que no falten a la vez Nº de serie y Observaciones cuando hay foto de contador; y que sin foto de contador no haya Nº de serie, Diámetro, Calibre, Lectura ni Marca/Modelo; y que, si falta la foto de contador o de arqueta, haya observaciones que lo justifiquen. No se revisan los que tienen «Se borra?» = TRUE ni los que no tienen ninguna de las 4 fotos (salvo, filtrando por fechas, si su FecHoraLec está dentro del rango)."
                        }
                    }

                    // ── FECHAS (filtro por FecHoraLec) ──
                    Tarjeta {
                        titulo: "📅 Fechas"
                        colorTitulo: "#0077B6"
                        RowLayout {
                            width: parent.width; spacing: 8
                            enabled: !pluginRoot.noFiltrarFechas
                            opacity: enabled ? 1 : 0.45
                            Column {
                                Layout.fillWidth: true; spacing: 4
                                Etiqueta { text: "Desde (dd/mm/aaaa)" }
                                Campo { id: fDesde; width: parent.width; text: pluginRoot.hoyTxt(0) }
                            }
                            Column {
                                Layout.fillWidth: true; spacing: 4
                                Etiqueta { text: "Hasta (dd/mm/aaaa)" }
                                Campo { id: fHasta; width: parent.width; text: pluginRoot.hoyTxt(0) }
                            }
                        }
                        Flow {
                            width: parent.width; spacing: 6
                            enabled: !pluginRoot.noFiltrarFechas
                            opacity: enabled ? 1 : 0.45
                            Chip { texto: "Hoy";  onPulsado: { fDesde.text = pluginRoot.hoyTxt(0);  fHasta.text = pluginRoot.hoyTxt(0) } }
                            Chip { texto: "Ayer"; onPulsado: { fDesde.text = pluginRoot.hoyTxt(-1); fHasta.text = pluginRoot.hoyTxt(-1) } }
                            Chip { texto: "Últimos 7 días"; onPulsado: { fDesde.text = pluginRoot.hoyTxt(-6); fHasta.text = pluginRoot.hoyTxt(0) } }
                            Chip { texto: "📅 Calendario"; destacado: true; onPulsado: pluginRoot.abrirCalendario() }
                        }
                        Casilla {
                            texto: "Incluir puntos sin fecha"
                            detalle: "Puntos con FecHoraLec vacío que tengan al menos una foto (Situacion, FInmueble, FContador o FArqueta)."
                            marcada: pluginRoot.incluirSinFecha
                            enabled: !pluginRoot.noFiltrarFechas
                            opacity: enabled ? 1 : 0.45
                            onPulsada: {
                                pluginRoot.incluirSinFecha = !pluginRoot.incluirSinFecha
                                pluginRoot.resultado = ""; pluginRoot.avisos = ""; pluginRoot.pendienteConfirmar = -1
                                pluginRoot.guardarAjuste("incluirSinFecha", pluginRoot.incluirSinFecha)
                            }
                        }
                        Casilla {
                            texto: "No filtrar por fechas"
                            marcada: pluginRoot.noFiltrarFechas
                            onPulsada: {
                                pluginRoot.noFiltrarFechas = !pluginRoot.noFiltrarFechas
                                pluginRoot.resultado = ""; pluginRoot.avisos = ""; pluginRoot.pendienteConfirmar = -1
                                pluginRoot.guardarAjuste("noFiltrarFechas", pluginRoot.noFiltrarFechas)
                            }
                        }
                        Text {
                            width: parent.width; wrapMode: Text.WordWrap; font.pixelSize: 10; color: pluginRoot.cMuted
                            text: pluginRoot.noFiltrarFechas
                                  ? "Se revisan todos los puntos de la capa, sin tener en cuenta FecHoraLec."
                                  : "Sólo salen en el PDF los puntos con FecHoraLec entre el día 'Desde' (00:00) y el día 'Hasta' (23:59)" + (pluginRoot.incluirSinFecha ? ", más los que tienen FecHoraLec en blanco." : ".")
                        }
                    }

                    Rectangle {
                        width: parent.width; height: txtAvisos.height + 24
                        visible: pluginRoot.avisos !== ""
                        radius: 10
                        color: pluginRoot.avisos.indexOf("⛔") === 0 ? "#FEE2E2" : "#FFF7E6"
                        border.color: pluginRoot.avisos.indexOf("⛔") === 0 ? pluginRoot.cDanger : "#F59E0B"; border.width: 1
                        Text {
                            id: txtAvisos
                            anchors { left: parent.left; right: parent.right; top: parent.top; margins: 12 }
                            text: pluginRoot.avisos; wrapMode: Text.WordWrap; font.pixelSize: 12; color: pluginRoot.cText
                        }
                    }

                    Rectangle {
                        width: parent.width; height: txtRes.height + 24
                        visible: pluginRoot.resultado !== ""
                        radius: 10; color: "#E8F5E9"
                        border.color: pluginRoot.cOk; border.width: 1
                        Text {
                            id: txtRes
                            anchors { left: parent.left; right: parent.right; top: parent.top; margins: 12 }
                            text: pluginRoot.resultado; wrapMode: Text.WordWrap; font.pixelSize: 13; color: pluginRoot.cText
                        }
                    }

                    Rectangle {
                        width: parent.width; height: 40; radius: 10
                        visible: pluginRoot.ultimoPdf !== ""
                        color: "#E0F2FE"; border.color: pluginRoot.cSecondary; border.width: 1
                        Text { anchors.centerIn: parent; text: "📂 Abrir último PDF"; color: pluginRoot.cPrimary; font.pixelSize: 13; font.bold: true }
                        MouseArea { anchors.fill: parent; onClicked: pluginRoot.abrirPdf() }
                    }
                    Item { width: 1; height: 8 }
                }
            }

            Rectangle {
                id: barAcciones
                width: parent.width; height: 58
                anchors.bottom: parent.bottom
                color: "white"; radius: 18
                Rectangle { width: parent.width; height: 18; anchors.top: parent.top; color: parent.color }
                RowLayout {
                    anchors { fill: parent; leftMargin: 12; rightMargin: 12; topMargin: 6; bottomMargin: 6 }
                    spacing: 8
                    Button {
                        Layout.preferredWidth: 120; height: 42
                        enabled: !pluginRoot.ocupado
                        background: Rectangle { color: "#E0F2FE"; radius: 10 }
                        contentItem: Text { text: "🔍 Revisar"; color: pluginRoot.cPrimary; font.pixelSize: 13; font.bold: true; horizontalAlignment: Text.AlignHCenter; verticalAlignment: Text.AlignVCenter }
                        onClicked: pluginRoot.revisarCapa()
                    }
                    Button {
                        Layout.fillWidth: true; height: 42
                        enabled: !pluginRoot.ocupado
                        background: Rectangle { color: pluginRoot.ocupado ? "#9CA3AF" : pluginRoot.cOk; radius: 10 }
                        contentItem: Text { text: pluginRoot.ocupado ? "⏳ Generando..." : "📄  Generar PDF"; color: "white"; font.pixelSize: 14; font.bold: true; horizontalAlignment: Text.AlignHCenter; verticalAlignment: Text.AlignVCenter }
                        onClicked: pluginRoot.pedirPdf()
                    }
                }
            }

            // Capa "Generando..." mientras se crea el PDF
            Rectangle {
                anchors.fill: parent; radius: 18
                color: "#99FFFFFF"
                visible: pluginRoot.ocupado
                MouseArea { anchors.fill: parent; onClicked: {} }
                Column {
                    anchors.centerIn: parent; spacing: 10
                    BusyIndicator { anchors.horizontalCenter: parent.horizontalCenter; running: pluginRoot.ocupado }
                    Text { text: "Generando PDF con las fotos..."; font.pixelSize: 14; font.bold: true; color: pluginRoot.cText }
                }
            }
        }
    }

    // ═════════════════════════════════════════════
    // CALENDARIO (rango de fechas)
    // ═════════════════════════════════════════════
    Rectangle {
        parent: mainWindow.contentItem
        anchors.fill: parent
        color: "#99000000"
        visible: pluginRoot.calAbierto
        z: 10001
        MouseArea { anchors.fill: parent; onClicked: pluginRoot.calAbierto = false }

        Rectangle {
            id: calCard
            width: Math.min(parent.width * 0.92, 400)
            height: calCol.height + 24
            anchors.centerIn: parent
            radius: 16; color: "white"
            MouseArea { anchors.fill: parent; onClicked: {} }     // no cerrar al tocar dentro

            Column {
                id: calCol
                x: 12; y: 12; width: parent.width - 24
                spacing: 8

                Text { text: "Selecciona el rango de fechas"; font.pixelSize: 15; font.bold: true; color: pluginRoot.cText }
                Text {
                    width: parent.width; wrapMode: Text.WordWrap; font.pixelSize: 11; color: pluginRoot.cMuted
                    text: "Toca el día inicial y después el final. Para un solo día, tócalo una vez y pulsa Aceptar."
                }

                // Desde / Hasta
                Row {
                    spacing: 8
                    Repeater {
                        model: [
                            { l: "Desde", v: pluginRoot.selIni ? Rev.fmtFecha(pluginRoot.selIni) : "—" },
                            { l: "Hasta", v: pluginRoot.selFin ? Rev.fmtFecha(pluginRoot.selFin) : (pluginRoot.selIni ? Rev.fmtFecha(pluginRoot.selIni) : "—") }
                        ]
                        Rectangle {
                            width: (calCol.width - 8) / 2; height: 44; radius: 8
                            color: "#F0F4F8"; border.color: "#D1D5DB"; border.width: 1
                            Column {
                                anchors.centerIn: parent
                                Text { anchors.horizontalCenter: parent.horizontalCenter; text: modelData.l; font.pixelSize: 10; color: pluginRoot.cMuted }
                                Text { anchors.horizontalCenter: parent.horizontalCenter; text: modelData.v; font.pixelSize: 15; font.bold: true; color: pluginRoot.cPrimary }
                            }
                        }
                    }
                }

                // Navegación: mes/año  ▲ ▼
                RowLayout {
                    width: parent.width; spacing: 6
                    Rectangle {
                        Layout.fillWidth: true; height: 40; radius: 8; color: "#F0F4F8"
                        Text {
                            anchors { left: parent.left; leftMargin: 12; verticalCenter: parent.verticalCenter }
                            font.pixelSize: 14; font.bold: true; color: pluginRoot.cText
                            text: pluginRoot.calVista === "dias"
                                  ? pluginRoot.mesesES[pluginRoot.calMes] + " de " + pluginRoot.calAnio + "   (" + pluginRoot.mesesEN[pluginRoot.calMes] + ")"
                                  : String(pluginRoot.calAnio)
                        }
                        Text {
                            anchors { right: parent.right; rightMargin: 10; verticalCenter: parent.verticalCenter }
                            text: "▾"
                            font.pixelSize: 10; color: pluginRoot.cMuted
                        }
                        MouseArea { anchors.fill: parent; onClicked: pluginRoot.calVista = (pluginRoot.calVista === "dias" ? "meses" : "dias") }
                    }
                    Repeater {
                        model: [{ t: "▲", d: -1 }, { t: "▼", d: 1 }]
                        Rectangle {
                            width: 40; height: 40; radius: 20; color: "#F0F4F8"
                            Text { anchors.centerIn: parent; text: modelData.t; font.pixelSize: 14; color: pluginRoot.cText }
                            MouseArea { anchors.fill: parent; onClicked: pluginRoot.moverCal(modelData.d) }
                        }
                    }
                }

                // ── Vista de días ──
                Column {
                    visible: pluginRoot.calVista === "dias"
                    width: parent.width; spacing: 2
                    Row {
                        Repeater {
                            model: ["L", "M", "X", "J", "V", "S", "D"]
                            Text {
                                width: calCol.width / 7; height: 24
                                horizontalAlignment: Text.AlignHCenter; verticalAlignment: Text.AlignVCenter
                                text: modelData; font.pixelSize: 12; font.bold: true; color: pluginRoot.cMuted
                            }
                        }
                    }
                    Grid {
                        columns: 7
                        Repeater {
                            model: 42
                            Item {
                                id: celda
                                width: calCol.width / 7; height: 40
                                property var fecha: { pluginRoot.calAnio; pluginRoot.calMes; return pluginRoot.diaCelda(index) }
                                property bool delMes: fecha.getMonth() === pluginRoot.calMes
                                property bool esIni: pluginRoot.mismoDia(fecha, pluginRoot.selIni)
                                property bool esFin: pluginRoot.mismoDia(fecha, pluginRoot.selFin)
                                property bool enRango: pluginRoot.selIni && pluginRoot.selFin &&
                                                       fecha.getTime() > pluginRoot.selIni.getTime() && fecha.getTime() < pluginRoot.selFin.getTime()
                                property bool esHoy: pluginRoot.mismoDia(fecha, new Date(new Date().setHours(0, 0, 0, 0)))

                                Rectangle {   // franja del rango
                                    anchors.verticalCenter: parent.verticalCenter
                                    width: parent.width; height: 34
                                    color: "#E0F2FE"
                                    visible: celda.enRango
                                }
                                Rectangle {
                                    anchors.centerIn: parent
                                    width: 34; height: 34; radius: 17
                                    color: (celda.esIni || celda.esFin) ? pluginRoot.cPrimary : "transparent"
                                    border.color: celda.esHoy && !(celda.esIni || celda.esFin) ? pluginRoot.cSecondary : "transparent"
                                    border.width: 2
                                }
                                Text {
                                    anchors.centerIn: parent
                                    text: celda.fecha.getDate()
                                    font.pixelSize: 14; font.bold: celda.esIni || celda.esFin
                                    color: (celda.esIni || celda.esFin) ? "white" : (celda.delMes ? pluginRoot.cText : "#B0B7C3")
                                }
                                MouseArea { anchors.fill: parent; onClicked: pluginRoot.tocarDia(celda.fecha) }
                            }
                        }
                    }
                }

                // ── Vista de meses ──
                Grid {
                    visible: pluginRoot.calVista === "meses"
                    columns: 4
                    Repeater {
                        model: 12
                        Item {
                            width: calCol.width / 4; height: 64
                            Rectangle {
                                anchors.centerIn: parent; width: 58; height: 58; radius: 29
                                color: index === pluginRoot.calMes ? pluginRoot.cPrimary : "transparent"
                            }
                            Column {
                                anchors.centerIn: parent
                                Text { anchors.horizontalCenter: parent.horizontalCenter; text: pluginRoot.mesesCortosES[index]; font.pixelSize: 14; font.bold: true
                                       color: index === pluginRoot.calMes ? "white" : pluginRoot.cText }
                                Text { anchors.horizontalCenter: parent.horizontalCenter; text: pluginRoot.mesesEN[index]; font.pixelSize: 9
                                       color: index === pluginRoot.calMes ? "#B3E5FC" : pluginRoot.cMuted }
                            }
                            MouseArea { anchors.fill: parent; onClicked: { pluginRoot.calMes = index; pluginRoot.calVista = "dias" } }
                        }
                    }
                }

                // Botones
                RowLayout {
                    width: parent.width; spacing: 8
                    Button {
                        Layout.preferredWidth: 110; height: 42
                        background: Rectangle { color: "#F3F4F6"; radius: 10 }
                        contentItem: Text { text: "Cancelar"; color: pluginRoot.cMuted; font.pixelSize: 13; horizontalAlignment: Text.AlignHCenter; verticalAlignment: Text.AlignVCenter }
                        onClicked: pluginRoot.calAbierto = false
                    }
                    Button {
                        Layout.fillWidth: true; height: 42
                        background: Rectangle { color: pluginRoot.cPrimary; radius: 10 }
                        contentItem: Text { text: "Aceptar"; color: "white"; font.pixelSize: 14; font.bold: true; horizontalAlignment: Text.AlignHCenter; verticalAlignment: Text.AlignVCenter }
                        onClicked: pluginRoot.aceptarCalendario()
                    }
                }
            }
        }
    }

    Component.onCompleted: {
        iface.addItemToPluginsToolbar(botonRevision)
    }
}
