# Revisión de fotos y direcciones — Plugin QField

Revisa la capa de contadores y genera un PDF con los puntos que hay que corregir:
primero un **resumen** y después **una ficha por página** de cada punto, con sus 4 fotos y su **Nº ORDEN**.

## Instalación
1. Copia la carpeta `revision_fotos_qfield` en la carpeta de plugins de QField:
   `/storage/emulated/0/Android/data/ch.opengis.qfield/files/QField/plugins/`
   (o súbela a GitHub como el plugin de informe e instálala por URL).
2. QField → Configuración → Plugins → activar **"Revisión de fotos y direcciones"**.
3. Aparece un botón nuevo (foto con lupa, verde sobre fondo oscuro) en la columna derecha.

## Uso
1. Activa la capa de contadores en QField (o desmarca "Trabajar sobre la capa activa" y elígela).
2. Rellena **Responsable** y **Tablet** (salen en el resumen y en el pie de cada página).
3. **📅 Fechas**: indica *Desde* y *Hasta* (dd/mm/aaaa), escribiéndolas o con Hoy / Ayer / Últimos 7 días / 📅 Calendario.
   Sólo salen en el PDF los puntos con `FecHoraLec` entre el día *Desde* a las 00:00 y el día *Hasta* a las 23:59:59.
   **«Incluir puntos sin fecha»** (marcado por defecto): añade los puntos con `FecHoraLec` en blanco o NULL; desmarcado, se quedan fuera.
   Con **«No filtrar por fechas»** marcado se revisa toda la capa, como antes, y las fechas quedan desactivadas.
   Las direcciones duplicadas se buscan siempre en toda la capa, aunque el otro punto quede fuera del rango.
4. **🔍 Revisar**: muestra cuántos puntos fallan y por qué (sin generar PDF).
5. **📄 Generar PDF**: lo guarda en la carpeta del proyecto como
   `Revision_Fotos_<capa>_<aaaammdd_hhmmss>.pdf` y lo abre.

Con "Incluir fotos" desmarcado el PDF sale sin fotos (mucho más ligero y rápido).
Si hay más de 120 fichas con fotos, pide pulsar otra vez para confirmar.

## Puntos que NO se revisan
- Los que tienen el campo `Se borra?` = TRUE.
- Los que tienen vacíos a la vez `Situacion`, `FInmueble`, `FContador` y `FArqueta`,
  salvo si se filtra por fechas y su `FecHoraLec` está dentro del rango (punto tomado en esas fechas): ésos sí se revisan.

Tampoco cuentan para detectar direcciones duplicadas. El resumen del PDF indica cuántos se han excluido.

## Comprobaciones (columna REVISIÓN)
| Mensaje | Cuándo |
|---|---|
| SIN NÚMERO DE ORDEN (NUM_ORDEN VACÍO) | `NUM_ORDEN` vacío: sale en el listado «Puntos a revisar» pero no se genera su ficha |
| SIN FOTO DE CONTADOR [Y ARQUETA] Y SIN OBSERVACIONES (JUSTIFICAR) | `FContador` y/o `FArqueta` vacíos y `Observacio` vacío |
| REVISAR DIRECCIÓN: SIN DIRECCIÓN | `Direccion` vacía |
| REVISAR DIRECCIÓN: DIRECCIÓN DUPLICADA (n puntos) | la misma `Direccion` en varios puntos |
| FOTO(S) DE SITUACIÓN, INMUEBLE… NO COINCIDE(N) CON LA DIRECCIÓN | la ruta no termina exactamente en `S_<Direccion>.jpg`, `I_…`, `C_…`, `A_…` (comparación literal; se ignoran los espacios junto a «/», p. ej. `C/ EL ROBLE` = `C/EL ROBLE`) |
| FALTA FOTO DE SITUACIÓN / INMUEBLE | `Situacion` o `FInmueble` vacíos (Contador y Arqueta vacíos no cuentan) |
| NO TIENE NÚMERO DE SERIE DE CONTADOR PERO SÍ HAY FOTO DE CONTADOR, NO TIENE OBSERVACIONES TAMPOCO | `NSerieCont` y `Observacio` vacíos y `FContador` con foto |
| NO TIENE FOTO DE CONTADOR PERO TIENE RELLENO: Nº SERIE, DIÁMETRO… | `FContador` vacío y alguno de `NSerieCont`, `Diametros`, `Calibre`, `Lectura`, `MarcaModel` relleno (en la ficha salen en rojo) |

Campos obligatorios en la capa: `Direccion, Situacion, FInmueble, FContador, FArqueta, NUM_ORDEN`.

## Ficha
Misma distribución que la ficha de contador, sin encabezado del ayuntamiento:
Nº de orden · Dirección · Tipo de edificación · caja roja **REVISIÓN** ·
foto Situación + Nº ORDEN + Ubicación, Nº contador, Cambio de tapa, Tipo de uso, Alojamiento, Tipo de edificación, Diámetro, Calibre ·
foto Inmueble + Lectura, Llave, Fecha, Marca/Modelo, Latitud, Longitud, Nº serie, Observaciones · fotos Arqueta y Contador.
Las fotos que no coinciden van con el marco y el nombre del archivo en rojo.
Las fotos se buscan en la carpeta del proyecto (`DCIM/CON/...`) y se respetan los giros EXIF de la tablet.
