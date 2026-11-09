// 603 · Generador de la historia de demostración: obras 4, 5 y 6 con meses de uso coherente entre Obras, Finanzas y
// Materiales (docs/specs/603-historia-demostracion/ de supervision-docs). Node 24, sin dependencias, determinista.
//
// Calcula de una sola vez, por obra: partidas → lo ejecutado cada mes → planillas (con las reglas de la planilla) →
// cobros, reservas, pagos y envíos → material usado (recetas de la 011) → compras y salidas → stock, y escribe un
// archivo por servicio con el mismo formato que los de la 011:
//   services/obras/src/main/resources/semilla/obras-historia.json
//   services/finanzas/database/seeders/datos/finanzas-historia.json
//   services/materiales/src/semilla/materiales-historia.json
// y copia, para cada foto nueva, una imagen de la 011 a infra/semilla/fotos/{obraId}/{fotoId}.jpg.
//
// Las fechas van relativas a D (como en la 011). Para evitar los domingos y que un mismo hecho tenga la misma fecha en
// los tres servicios, el calendario se calcula contra D_REFERENCIA (el día en que se generó).
// Uso (desde infra): node semilla/historia/generar.mjs
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const INFRA = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAIZ = resolve(INFRA, '..');
const D_REFERENCIA = new Date(Date.UTC(2026, 10, 9)); // 2026-11-09, lunes

// --- Utilidades -----------------------------------------------------------------------------------------------------
let estadoAzar = 603;
function azar() {
  // mulberry32: el mismo resultado en cada corrida
  estadoAzar = (estadoAzar + 0x6d2b79f5) | 0;
  let t = estadoAzar;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const entre = (a, b) => a + (b - a) * azar();
const entero = (a, b) => Math.floor(entre(a, b + 1));
const normal = () => Math.sqrt(-2 * Math.log(1 - azar())) * Math.cos(2 * Math.PI * azar());
const DIA_MS = 86400000;
const fechaDe = (k, dia) => new Date(Date.UTC(D_REFERENCIA.getUTCFullYear(), D_REFERENCIA.getUTCMonth() + k, dia));
const diasAntesDeD = (fecha) => Math.round((D_REFERENCIA - fecha) / DIA_MS);
const esDomingo = (fecha) => fecha.getUTCDay() === 0;
const dos = (n) => String(n).padStart(2, '0');
const hora = (minutos) => `${dos(Math.floor(minutos / 60))}:${dos(minutos % 60)}`;
const id = (prefijo, sufijo) => `${prefijo}-0000-4000-8000-${String(sufijo).padStart(12, '0')}`;
const expresionMes = (k, dia, minutos) => `M${k === 0 ? '0' : k}/${dos(dia)} ${hora(minutos)}`;
const expresionD = (fecha, minutos) => `D-${diasAntesDeD(fecha)}${minutos === undefined ? '' : ` ${hora(minutos)}`}`;

/** Días hábiles (lunes a sábado) del mes k entre los días desde y hasta (2 a 27, por el formato M-k/dd). */
function diasHabiles(k, desde = 2, hasta = 27) {
  const dias = [];
  for (let dia = Math.max(2, desde); dia <= Math.min(27, hasta); dia++) {
    if (!esDomingo(fechaDe(k, dia))) dias.push(dia);
  }
  return dias;
}
/** El primer día hábil desde una fecha. */
function habil(fecha) {
  let f = fecha;
  while (esDomingo(f)) f = new Date(f.getTime() + DIA_MS);
  return f;
}

// --- Dinero como la planilla (TotalesPlanilla): centavos enteros, redondeo a la mitad hacia arriba ---------------------
const centavos = (bs) => Math.round(bs * 100);
const milesimas = (cantidad) => Math.round(cantidad * 1000);
function montoLinea(cantidad, precio) {
  // cantidad (3 decimales) × precio (2 decimales), redondeado a centavos
  const producto = BigInt(milesimas(cantidad)) * BigInt(centavos(precio)); // en 1e-5 Bs
  return Number((producto + 500n) / 1000n);
}
function porcentaje(subtotal, pct) {
  const producto = BigInt(subtotal) * BigInt(Math.round(pct * 100)); // pct con 2 decimales
  return Number((producto + 5000n) / 10000n);
}
const aBs = (c) => Math.round(c) / 100;

// Orden en que Materiales aplica los movimientos (preparar-semilla.ts): día, ingresos antes que salidas, hora y orden
// del archivo. El stock se calcula siempre en este orden.
let secuencia = 0;
const ordenAplicacion = (a, b) =>
  a.fecha - b.fecha || (a.tipo === b.tipo ? 0 : a.tipo === 'INGRESO' ? -1 : 1) || a.minutos - b.minutos || a.seq - b.seq;

// --- Catálogo y recetas de la 011 -----------------------------------------------------------------------------------
const rutaObras = resolve(RAIZ, 'services/obras/src/main/resources/semilla/obras.json');
const rutaMateriales = resolve(RAIZ, 'services/materiales/src/semilla/materiales.json');
const base = JSON.parse(readFileSync(rutaObras, 'utf8'));
const catalogo = JSON.parse(readFileSync(rutaMateriales, 'utf8'));
const RECETAS = base.recetas;
const UNIDAD = Object.fromEntries(catalogo.materiales.map((m) => [m.codigo, m.unidad]));
const ENTERAS = new Set(['bolsa', 'pieza', 'kg']);
const redondear = (material, cantidad) =>
  ENTERAS.has(UNIDAD[material]) ? Math.round(cantidad) : Math.round(cantidad * 10) / 10;
/** Lote de compra y tamaño típico de una salida, por material. */
const LOTE = { 'CEM-IP30': 50, 'FIE-12': 500, 'FIE-10': 500, 'ARE-GRU': 6, 'ARE-FIN': 6, 'GRA-34': 6, 'PIE-MAN': 6, 'LAD-6H': 1000, 'CER-4545': 50 };
const SALIDA_TIPICA = { 'CEM-IP30': 30, 'FIE-12': 350, 'FIE-10': 250, 'ARE-GRU': 2.5, 'ARE-FIN': 1.2, 'GRA-34': 3, 'PIE-MAN': 3, 'LAD-6H': 900, 'CER-4545': 45 };

const USUARIOS = {
  residente1: 'a0000000-0000-4000-8000-000000000003',
  residente2: 'a0000000-0000-4000-8000-000000000004',
  maestro1: 'a0000000-0000-4000-8000-000000000005',
  almacenero1: 'a0000000-0000-4000-8000-000000000006',
  cliente1: 'a0000000-0000-4000-8000-000000000007',
  demo1: 'a0000000-0000-4000-8000-000000000009',
  admin1: 'a0000000-0000-4000-8000-000000000001',
};
const CORREO = { cliente1: 'cliente1@correo.test', demo1: 'demo1@constructora-andina.test' };

// --- Escenarios (docs/specs/603, requisitos) ------------------------------------------------------------------------
// ejecutado: fracción de lo contratado por mes (clave = k, meses respecto de D). En la obra 5, «real» es lo que de
// verdad se ejecutó cuando la planilla presentada difiere (la observada), y «mes0» lo del mes en curso.
// pagos: por número de planilla, días entre la emisión y el pago (null = sin pagar).
const OBRAS = [
  {
    n: 4,
    nombre: 'Edificio de Oficinas Casco Viejo',
    ubicacion: 'Calle Junín esq. 21 de Mayo, Casco Viejo, Santa Cruz de la Sierra',
    zona: 'CENTRO',
    cliente: 'cliente1',
    residente: 'residente1',
    inicio: 185,
    plazo: 420,
    anticipo: 10,
    retencion: 7,
    partidas: [
      ['Excavación con maquinaria', 'm3', 1500, 46.5, 'M-6', null, { '-6': 1 }],
      ['Hormigón armado en zapatas', 'm3', 140, 2448, 'M-6..M-5', 'zapatas', { '-6': 0.35, '-5': 0.65 }],
      ['Hormigón armado en columnas y vigas', 'm3', 260, 3365, 'M-5..M-1', 'columnas', { '-5': 0.12, '-4': 0.18, '-3': 0.18, '-2': 0.17, '-1': 0.15, 0: 0.05 }],
      ['Losa alivianada con viguetas', 'm2', 3200, 418.5, 'M-4..M0', 'losa-alivianada', { '-4': 0.1, '-3': 0.15, '-2': 0.15, '-1': 0.15, 0: 0.05 }],
      ['Muro de ladrillo de 6 huecos', 'm2', 4200, 134.8, 'M-3..M+3', 'muro', { '-3': 0.05, '-2': 0.08, '-1': 0.09, 0: 0.04 }],
      ['Revoque grueso y fino', 'm2', 6000, 61.75, 'M-1..M+5', 'revoque', { '-1': 0.03, 0: 0.02 }],
      ['Contrapiso y piso cerámico', 'm2', 2800, 212, 'M+2..M+6', 'piso', {}],
    ],
    // última planilla (M-1) aprobada; todos los cobros pagados salvo el último
    ultima: 'APROBADA',
    pagos: { 1: 12, 2: 15, 3: 10, 4: 18, 5: 20, 6: null },
    minimos: { 'CEM-IP30': 200, 'FIE-12': 1000, 'FIE-10': 600, 'ARE-GRU': 12, 'ARE-FIN': 5, 'GRA-34': 15, 'LAD-6H': 2500, 'CER-4545': 100 },
    stockFinal: {},
    factores: {},
    raras: [],
  },
  {
    n: 5,
    nombre: 'Mercado Municipal Villa 1ro de Mayo',
    ubicacion: 'Av. Principal de Villa 1ro de Mayo y 7mo anillo, Santa Cruz de la Sierra',
    zona: 'ESTE',
    cliente: 'demo1',
    residente: 'residente2',
    inicio: 215,
    plazo: 300,
    anticipo: 15,
    retencion: 7,
    partidas: [
      ['Excavación manual para cimientos', 'm3', 900, 68, 'M-7', null, { '-7': 0.55, '-6': 0.45 }],
      ['Cimiento de hormigón ciclópeo', 'm3', 420, 985, 'M-7..M-6', 'ciclopeo', { '-6': 0.35, '-5': 0.45, '-4': 0.2 }],
      ['Hormigón armado en zapatas', 'm3', 120, 2455, 'M-6', 'zapatas', { '-5': 0.2, '-4': 0.5, '-3': 0.3 }],
      ['Hormigón armado en columnas y vigas', 'm3', 180, 3290, 'M-5..M-3', 'columnas', { '-3': 0.15, '-2': 0.12, '-1': 0.1, 0: 0.02 }],
      ['Losa alivianada con viguetas', 'm2', 2600, 410, 'M-3..M-1', 'losa-alivianada', { '-2': 0.05, '-1': 0.06, 0: 0.015 }],
      ['Muro de ladrillo de 6 huecos', 'm2', 3800, 132, 'M-2..M+1', 'muro', { '-1': 0.02, 0: 0.016 }],
      ['Revoque grueso y fino', 'm2', 5200, 60, 'M0..M+2', 'revoque', {}],
      ['Contrapiso y piso cerámico', 'm2', 2400, 205, 'M+1..M+2', 'piso', {}],
    ],
    // M-1 observada: lo presentado (arriba) es más de lo que de verdad se ejecutó
    ultima: 'OBSERVADA',
    real: { '-1': { 4: 0.072, 5: 0.046 } },
    observacion:
      'Las cantidades de columnas y vigas (18 m³) y de losa alivianada (156 m²) no coinciden con lo verificado en la visita de obra: se midieron unos 13 m³ y 120 m². Corrijan las mediciones y adjunten fotos de los vaciados.',
    pagos: { 1: 14, 2: 41, 3: 22, 4: null, 5: 27, 6: null },
    // el cliente tardó en aprobar la de M-2: su cobro vence en dos días (recordatorio «por vencer» de mañana)
    demoras: { 6: 10 },
    minimos: { 'CEM-IP30': 180, 'FIE-12': 800, 'FIE-10': 400, 'ARE-GRU': 10, 'ARE-FIN': 4, 'GRA-34': 12, 'PIE-MAN': 6, 'LAD-6H': 2000 },
    stockFinal: { 'CEM-IP30': 0.55, 'LAD-6H': 0.6 },
    factores: { 'losa-alivianada': 1.25 },
    // salidas raras (403): de noche, en domingo, que supera el stock
    raras: [
      { material: 'CEM-IP30', partida: 4, k: -2, dia: 16, minutos: 22 * 60 + 40, veces: 5 },
      { material: 'FIE-12', partida: 4, k: -3, domingo: true, minutos: 15 * 60 + 20, veces: 4 },
      { material: 'CEM-IP30', partida: 5, k: -1, dia: 20, minutos: 10 * 60 + 15, veces: 1.6, superaStock: true },
    ],
  },
  {
    n: 6,
    nombre: 'Condominio Jardines del Urubó',
    ubicacion: 'Carretera al Urubó km 4, Porongo',
    zona: 'OESTE',
    cliente: 'cliente1',
    residente: 'demo1',
    inicio: 158,
    plazo: 360,
    anticipo: 10,
    retencion: 5,
    partidas: [
      ['Excavación con maquinaria', 'm3', 1100, 46, 'M-5', null, { '-5': 1 }],
      ['Hormigón armado en zapatas', 'm3', 110, 2440, 'M-5..M-4', 'zapatas', { '-5': 0.3, '-4': 0.7 }],
      ['Hormigón armado en columnas y vigas', 'm3', 210, 3340, 'M-4..M-1', 'columnas', { '-4': 0.1, '-3': 0.12, '-2': 0.1, '-1': 0.09, 0: 0.03 }],
      ['Losa maciza de hormigón armado', 'm2', 2400, 465, 'M-3..M+1', 'losa-maciza', { '-3': 0.05, '-2': 0.07, '-1': 0.08, 0: 0.03 }],
      ['Muro de ladrillo de 6 huecos', 'm2', 3600, 133, 'M-2..M+3', 'muro', { '-2': 0.02, '-1': 0.03, 0: 0.02 }],
      ['Revoque grueso y fino', 'm2', 5000, 61, 'M0..M+5', 'revoque', {}],
      ['Contrapiso y piso cerámico', 'm2', 2600, 210, 'M+3..M+6', 'piso', {}],
    ],
    ultima: 'APROBADA',
    pagos: { 1: 9, 2: 16, 3: 12, 4: 27, 5: null },
    minimos: { 'CEM-IP30': 160, 'FIE-12': 900, 'FIE-10': 600, 'ARE-GRU': 10, 'ARE-FIN': 4, 'GRA-34': 12, 'LAD-6H': 2000 },
    stockFinal: { 'FIE-10': 1.12 },
    factores: {},
    raras: [{ material: 'ARE-GRU', partida: 3, k: -2, dia: 23, minutos: 11 * 60 + 5, veces: 5 }],
  },
];

// --- Generación -----------------------------------------------------------------------------------------------------
const salida = {
  obras: { obras: [], fotos: [], planillas: [] },
  finanzas: { contratos: [], reservas: [], cobros: [], envios: [] },
  materiales: { obraAcceso: [], stock: [], movimientos: [], cierres: [] },
};
const resumen = [];
const resumenCobros = [];
const fotosACopiar = [];
const IMAGEN = {
  null: ['030101', '030102'],
  zapatas: ['020401', '020402'],
  columnas: ['010301', '010302'],
  ciclopeo: ['030101', '030102'],
  'losa-maciza': ['010401', '010402'],
  'losa-alivianada': ['010401', '010402'],
  muro: ['010501', '010502'],
  revoque: ['010501', '010502'],
  piso: ['010501', '010502'],
};
const imagenDe = (sufijo) => {
  const obra = sufijo.slice(1, 2);
  return resolve(INFRA, `semilla/fotos/b0000000-0000-4000-8000-00000000000${obra}/f1000000-0000-4000-8000-000000${sufijo}.jpg`);
};

for (const o of OBRAS) {
  const obraId = id('b0000000', o.n);
  const contratoId = id('c0000000', o.n);
  const inicio = new Date(D_REFERENCIA.getTime() - o.inicio * DIA_MS);
  const kInicio = (inicio.getUTCFullYear() - D_REFERENCIA.getUTCFullYear()) * 12 + inicio.getUTCMonth() - D_REFERENCIA.getUTCMonth();
  const partidas = o.partidas.map(([nombre, unidad, cantidad, precio, meses, receta, ejecutado], i) => ({
    id: id('b1000000', `${o.n}${dos(i + 1)}`),
    codigo: `P-${dos(i + 1)}`,
    nombre,
    unidad,
    cantidadContratada: cantidad,
    precioUnitario: precio,
    meses,
    receta,
    ejecutado,
  }));
  const monto = aBs(partidas.reduce((s, p) => s + montoLinea(p.cantidadContratada, p.precioUnitario), 0));

  salida.obras.obras.push({
    id: obraId,
    nombre: o.nombre,
    ubicacion: o.ubicacion,
    zona: o.zona,
    estado: 'EN_EJECUCION',
    clienteUsuarioId: USUARIOS[o.cliente],
    residenteUsuarioId: USUARIOS[o.residente],
    maestroUsuarioId: USUARIOS.maestro1,
    almaceneroUsuarioId: USUARIOS.almacenero1,
    contratoId,
    contrato: { monto, plazoDias: o.plazo, anticipoPct: o.anticipo, retencionPct: o.retencion },
    fechaInicio: `D-${o.inicio}`,
    partidas: partidas.map(({ ejecutado, ...p }) => p),
  });
  salida.finanzas.contratos.push({
    id: contratoId, obraId, monto, plazoDias: o.plazo, anticipoPct: o.anticipo, retencionPct: o.retencion,
    firmadoEn: `D-${o.inicio + 10}`,
  });
  salida.materiales.obraAcceso.push({
    obraId, nombre: o.nombre, residenteId: USUARIOS[o.residente], maestroId: USUARIOS.maestro1,
    almaceneroId: USUARIOS.almacenero1, clienteId: USUARIOS[o.cliente],
  });

  // Lo ejecutado por mes (presentado) y lo real (para el material)
  const cantidadDe = (p, k) => Math.round(p.cantidadContratada * (p.ejecutado[k] ?? 0) * 1000) / 1000;
  const realDe = (p, k, i) => {
    const fraccion = o.real?.[k]?.[i + 1];
    return fraccion === undefined ? cantidadDe(p, k) : Math.round(p.cantidadContratada * fraccion * 1000) / 1000;
  };

  // Planillas: una por mes desde el inicio hasta M-1
  let fotoN = {};
  let aprobadoAcumulado = 0;
  const movimientosMaterial = []; // salidas {material, partidaId, k, fecha, minutos, cantidad, rara}
  for (let k = kInicio, numero = 1; k <= -1; k++, numero++) {
    const cantidades = {};
    let subtotal = 0;
    partidas.forEach((p) => {
      const c = cantidadDe(p, k);
      if (c > 0) {
        cantidades[p.codigo] = c;
        subtotal += montoLinea(c, p.precioUnitario);
      }
    });
    const anticipo = porcentaje(subtotal, o.anticipo);
    const retencion = porcentaje(subtotal, o.retencion);
    const neto = subtotal - anticipo - retencion;
    const esUltima = k === -1;
    const estado = esUltima ? o.ultima : 'APROBADA';
    // Presentada entre el 2 y el 4 del mes siguiente; aprobada entre 3 y 8 días después
    const presentada = habil(fechaDe(k + 1, esUltima ? 3 : entero(2, 4)));
    const demora = entero(3, 8);
    const aprobada = habil(new Date(presentada.getTime() + (esUltima ? 3 : (o.demoras?.[numero] ?? demora)) * DIA_MS));
    const planillaId = id('d0000000', `${o.n}${dos(numero)}`);

    // Fotos del periodo: las dos partidas con más monto del mes
    const principales = partidas
      .filter((p) => cantidades[p.codigo])
      .sort((a, b) => montoLinea(cantidades[b.codigo], b.precioUnitario) - montoLinea(cantidades[a.codigo], a.precioUnitario))
      .slice(0, estado === 'PRESENTADA' ? 3 : 2);
    const fotos = [];
    const diasMes = diasHabiles(k, k === kInicio ? inicio.getUTCDate() : 2);
    for (const p of principales) {
      fotoN[p.codigo] = (fotoN[p.codigo] ?? 0) + 1;
      const fotoId = id('f1000000', `${o.n}${p.codigo.slice(2)}${dos(fotoN[p.codigo])}`);
      const dia = diasMes[Math.min(diasMes.length - 1, Math.floor(diasMes.length * (0.4 + 0.5 * azar())))];
      salida.obras.fotos.push({ id: fotoId, obraId, partida: p.codigo, tomadaEn: expresionMes(k, dia, 11 * 60), publicadaCliente: false });
      const imagenes = IMAGEN[p.receta];
      fotosACopiar.push([imagenDe(imagenes[fotoN[p.codigo] % 2]), resolve(INFRA, `semilla/fotos/${obraId}/${fotoId}.jpg`)]);
      fotos.push(fotoId);
    }

    const planilla = {
      id: planillaId, obraId, numero, periodo: `M${k}`, estado, cantidades,
      observacion: estado === 'OBSERVADA' ? o.observacion : null,
      cobro: null, fotos,
      presentadaEn: estado === 'PRESENTADA' ? expresionD(presentada, 15 * 60) : null,
    };
    if (estado === 'APROBADA') {
      aprobadoAcumulado += subtotal;
      const cobroId = id('c2000000', `${o.n}${dos(numero)}`);
      planilla.cobro = { id: cobroId, emitidoEn: expresionD(aprobada, 10 * 60) };
      salida.finanzas.reservas.push({ id: id('c1000000', `${o.n}${dos(numero)}`), contratoId, planillaId, monto: aBs(neto), estado: 'CONSUMIDA' });
      const cobro = { id: cobroId, contratoId, planillaId, montoNeto: aBs(neto), emitidoEn: expresionD(aprobada) };
      const correo = CORREO[o.cliente];
      salida.finanzas.envios.push({ id: id('c3000000', `0${o.n}${dos(numero)}`), cobroId, tipo: 'NOTA_COBRO', destinatario: correo, enviadoEn: expresionD(aprobada, 10 * 60 + 5) });
      const vence = new Date(aprobada.getTime() + 30 * DIA_MS);
      const diasPago = o.pagos[numero];
      const pagado = diasPago === null || diasPago === undefined ? null : habil(new Date(aprobada.getTime() + diasPago * DIA_MS));
      if (pagado && diasAntesDeD(pagado) < 1) throw new Error(`El pago del cobro ${cobroId} cae en D o después`);
      // «Recordar cobros» (201) corre a las 08:00: por vencer 3 días antes y vencido al día siguiente del vencimiento,
      // si el cobro seguía sin pagar ese día y el día ya pasó
      const porVencer = new Date(vence.getTime() - 3 * DIA_MS);
      const vencido = new Date(vence.getTime() + DIA_MS);
      if (diasAntesDeD(porVencer) >= 1 && (!pagado || pagado > porVencer)) {
        salida.finanzas.envios.push({ id: id('c3000000', `3${o.n}${dos(numero)}`), cobroId, tipo: 'RECORDATORIO_POR_VENCER', destinatario: correo, enviadoEn: expresionD(porVencer, 8 * 60 + 2) });
      }
      if (diasAntesDeD(vencido) >= 1 && (!pagado || pagado > vencido)) {
        salida.finanzas.envios.push({ id: id('c3000000', `2${o.n}${dos(numero)}`), cobroId, tipo: 'RECORDATORIO_VENCIDO', destinatario: correo, enviadoEn: expresionD(vencido, 8 * 60 + 2) });
      }
      if (pagado) {
        cobro.pagadoEn = expresionD(pagado);
        cobro.comprobante = `Transferencia BNB ${String(entero(10000000, 99999999))}`;
        salida.finanzas.envios.push({ id: id('c3000000', `1${o.n}${dos(numero)}`), cobroId, tipo: 'CONSTANCIA_PAGO', destinatario: correo, enviadoEn: expresionD(pagado, 11 * 60 + 5) });
      }
      resumenCobros.push(`obra ${o.n} N.º ${numero}: neto ${aBs(neto)}, emitido ${aprobada.toISOString().slice(0, 10)}, vence ${vence.toISOString().slice(0, 10)}, ${pagado ? `pagado ${pagado.toISOString().slice(0, 10)}` : diasAntesDeD(vence) > 0 ? 'VENCIDO' : 'pendiente'}`);
      salida.finanzas.cobros.push(cobro);
      salida.materiales.cierres.push({ obraId, periodo: `M${k}`, planillaId, estado: 'CERRADO', cerradoEn: expresionD(aprobada, 10 * 60) });
    }
    salida.obras.planillas.push(planilla);
  }

  // Material usado: por mes y partida, lo realmente ejecutado × receta × variación, en salidas de días hábiles
  for (let k = kInicio; k <= 0; k++) {
    partidas.forEach((p, i) => {
      if (!p.receta) return;
      const ejecutado = k === 0 ? cantidadDe(p, 0) : realDe(p, k, i);
      if (ejecutado <= 0) return;
      const factorReceta = o.factores[p.receta] ?? 1;
      let dias;
      if (k === 0) {
        dias = [];
        for (let n = 7; n >= 2; n--) {
          const f = new Date(D_REFERENCIA.getTime() - n * DIA_MS);
          if (!esDomingo(f)) dias.push(f);
        }
      } else {
        dias = diasHabiles(k, k === kInicio ? inicio.getUTCDate() + 2 : 2).map((dia) => fechaDe(k, dia));
      }
      for (const [material, coeficiente] of Object.entries(RECETAS[p.receta])) {
        const total = ejecutado * coeficiente * factorReceta * entre(0.94, 1.06);
        const cuantas = Math.max(2, Math.min(dias.length, Math.round(total / SALIDA_TIPICA[material])));
        // Días al azar, ordenados; pesos log-normales (σ 0,3)
        const elegidos = [...dias].sort(() => azar() - 0.5).slice(0, cuantas).sort((a, b) => a - b);
        const pesos = elegidos.map(() => Math.exp(0.3 * normal()));
        const suma = pesos.reduce((a, b) => a + b, 0);
        let repartido = 0;
        elegidos.forEach((fecha, j) => {
          let cantidad = j === elegidos.length - 1 ? total - repartido : (total * pesos[j]) / suma;
          cantidad = redondear(material, cantidad);
          if (cantidad <= 0) cantidad = redondear(material, SALIDA_TIPICA[material] * 0.3) || 1;
          repartido += cantidad;
          const minutos = Math.max(7 * 60 + 30, Math.min(17 * 60 + 30, Math.round(600 + 110 * normal())));
          movimientosMaterial.push({ material, partidaId: p.id, k, fecha, minutos, cantidad });
        });
      }
    });
  }
  // Salidas raras (403)
  for (const r of o.raras) {
    let fecha;
    if (r.domingo) {
      const domingos = Array.from({ length: 26 }, (_, j) => fechaDe(r.k, j + 2)).filter(esDomingo);
      fecha = domingos[1];
    } else {
      fecha = fechaDe(r.k, r.dia);
    }
    const cantidad = redondear(r.material, SALIDA_TIPICA[r.material] * r.veces);
    movimientosMaterial.push({ material: r.material, partidaId: partidas[r.partida - 1].id, k: r.k, fecha, minutos: r.minutos, cantidad, rara: true, superaStock: r.superaStock });
  }

  // Compras y stock por material, en orden cronológico
  const porMaterial = {};
  for (const m of movimientosMaterial) (porMaterial[m.material] ??= []).push(m);
  let numeroMov = 0;
  const filas = [];
  for (const [material, salidas] of Object.entries(porMaterial)) {
    salidas.sort((a, b) => a.fecha - b.fecha || a.minutos - b.minutos);
    const minimo = o.minimos[material];
    if (minimo === undefined) throw new Error(`Falta el mínimo de ${material} en la obra ${o.n}`);
    const objetivo = o.stockFinal[material];
    let stock = 0;
    const lista = [];
    const total = salidas.reduce((s, x) => s + x.cantidad, 0);
    salidas.forEach((s, j) => {
      const restante = salidas.slice(j).reduce((a, x) => a + x.cantidad, 0);
      const proximos = salidas.slice(j, j + 8).reduce((a, x) => a + x.cantidad, 0);
      const necesita = s.superaStock ? false : stock - s.cantidad < 1.3 * minimo;
      if (necesita) {
        // Compra el día hábil anterior (o el mismo a las 08:30): lo de las próximas salidas más 1,5 × el mínimo
        let cantidad = Math.ceil((proximos + 1.5 * minimo - stock) / LOTE[material]) * LOTE[material];
        if (objetivo !== undefined) {
          // Escenario con stock final bajo o justo: la última compra deja lo justo para terminar en el objetivo
          const final = stock + cantidad - restante;
          const deseado = objetivo * minimo;
          if (final > deseado && restante + deseado - stock > 0) {
            const ajustada = redondear(material, restante + deseado - stock);
            if (ajustada >= s.cantidad - stock && ajustada > 0) cantidad = ajustada;
          }
        }
        let fecha = new Date(s.fecha.getTime() - DIA_MS);
        while (esDomingo(fecha)) fecha = new Date(fecha.getTime() - DIA_MS);
        const ultima = lista.at(-1);
        const kCompra = s.k === 0 ? 0 : s.k;
        const mismoMes = fecha.getUTCMonth() === s.fecha.getUTCMonth() && fecha.getUTCDate() >= 2;
        if (!mismoMes || (ultima && ultima.fecha > fecha)) fecha = s.fecha;
        lista.push({ tipo: 'INGRESO', material, cantidad, fecha, k: kCompra, minutos: fecha === s.fecha ? 7 * 60 + 15 : 8 * 60 + 30, seq: secuencia++ });
        stock += cantidad;
      }
      lista.push({ tipo: 'SALIDA', ...s, seq: secuencia++ });
      stock -= s.cantidad;
    });
    lista.sort(ordenAplicacion);
    // La salida que supera el stock: se reduce la compra anterior para que el stock quede en −35 tras ella y se agrega
    // una compra de urgencia el día hábil siguiente
    const recalcular = () => {
      let c = 0;
      for (const m of lista) {
        c = Math.round((c + (m.tipo === 'INGRESO' ? m.cantidad : -m.cantidad)) * 1000) / 1000;
        m.stock = c;
      }
      return c;
    };
    const iRara = lista.findIndex((m) => m.superaStock);
    if (iRara >= 0) {
      recalcular();
      const antes = iRara > 0 ? lista[iRara - 1].stock : 0;
      const sobra = antes - (lista[iRara].cantidad - 35);
      let iCompra = iRara - 1;
      while (iCompra >= 0 && lista[iCompra].tipo !== 'INGRESO') iCompra--;
      const minimoEntre = Math.min(...lista.slice(iCompra, iRara).map((m) => m.stock));
      if (iCompra < 0 || minimoEntre - sobra < 0 || lista[iCompra].cantidad - sobra <= 0) {
        // No alcanza con rebajar la compra anterior: la salida pide 35 más de lo que hay en ese momento
        lista[iRara].cantidad = redondear(material, antes + 35);
      } else {
        lista[iCompra].cantidad = redondear(material, lista[iCompra].cantidad - sobra);
      }
      let fecha = new Date(lista[iRara].fecha.getTime() + DIA_MS);
      while (esDomingo(fecha)) fecha = new Date(fecha.getTime() + DIA_MS);
      const urgencia = {
        urgencia: true, tipo: 'INGRESO', material, fecha, k: lista[iRara].k, minutos: 8 * 60 + 30, seq: secuencia++,
        cantidad: Math.ceil((35 + 1.5 * minimo) / LOTE[material]) * LOTE[material],
      };
      const iDespues = lista.findIndex((m, j) => j > iRara && m.fecha >= fecha);
      lista.splice(iDespues < 0 ? lista.length : iDespues, 0, urgencia);
      lista.sort(ordenAplicacion);
    }
    // Stock final del escenario (bajo o justo): se rebajan las últimas compras sin dejar el stock negativo
    if (objetivo !== undefined) {
      const deseado = objetivo * minimo;
      for (let vuelta = 0; vuelta < 20; vuelta++) {
        const final = recalcular();
        const exceso = final - deseado;
        if (exceso <= LOTE[material] * 0.01) break;
        const iUltima = lista.findLastIndex((m) => m.tipo === 'INGRESO' && !m.urgencia);
        if (iUltima < 0) break;
        const minimoDespues = Math.min(...lista.slice(iUltima).map((m) => m.stock));
        const rebaja = redondear(material, Math.min(exceso, minimoDespues, lista[iUltima].cantidad));
        if (rebaja <= 0) break;
        lista[iUltima].cantidad = redondear(material, lista[iUltima].cantidad - rebaja);
        if (lista[iUltima].cantidad <= 0) lista.splice(iUltima, 1);
      }
    }
    // Revisión del escenario: el stock no queda negativo salvo en la salida que supera el stock
    let corriente = 0;
    for (const m of lista) {
      corriente += m.tipo === 'INGRESO' ? m.cantidad : -m.cantidad;
      corriente = Math.round(corriente * 1000) / 1000;
      if (corriente < 0 && !m.superaStock && !lista.some((x) => x.superaStock && x.fecha <= m.fecha)) {
        throw new Error(`Obra ${o.n} ${material}: stock negativo sin querer (${corriente})`);
      }
      m.stock = corriente;
    }
    filas.push(...lista);
    resumen.push(`obra ${o.n} ${material}: ${salidas.length} salidas (${redondear(material, total)}), ${lista.length - salidas.length} compras, stock final ${corriente} (mínimo ${minimo})`);
    salida.materiales.stock.push({ obraId, material, minimo, cantidadEsperada: corriente, estadoEsperado: corriente < minimo ? 'BAJO' : 4 * corriente <= 5 * minimo ? 'JUSTO' : 'OK' });
  }
  // Ids y expresiones en orden cronológico de toda la obra
  filas.sort(ordenAplicacion);
  for (const m of filas) {
    numeroMov++;
    const dia = m.fecha.getUTCDate();
    const kMes = (m.fecha.getUTCFullYear() - D_REFERENCIA.getUTCFullYear()) * 12 + m.fecha.getUTCMonth() - D_REFERENCIA.getUTCMonth();
    const registradoEn = kMes === 0 ? expresionD(m.fecha, m.minutos) : expresionMes(kMes, dia, m.minutos);
    if (kMes !== 0 && (dia < 2 || dia > 27)) throw new Error(`Obra ${o.n}: fecha fuera de 2–27 (${m.fecha.toISOString()})`);
    salida.materiales.movimientos.push({
      id: id('f0000000', `${o.n}${String(numeroMov).padStart(4, '0')}`),
      obraId,
      tipo: m.tipo,
      material: m.material,
      cantidad: m.cantidad,
      partidaId: m.tipo === 'SALIDA' ? m.partidaId : null,
      registradoEn,
      notaRemision: m.tipo === 'INGRESO' ? `NR-${o.n}${String(numeroMov).padStart(4, '0')}` : null,
      stock: m.stock,
    });
  }

  const avance = (100 * aprobadoAcumulado) / centavos(monto);
  const plazo = (100 * o.inicio) / o.plazo;
  resumen.unshift(`obra ${o.n} ${o.nombre}: monto ${monto}, avance aprobado ${avance.toFixed(2)} %, plazo ${plazo.toFixed(2)} %, diferencia ${(plazo - avance).toFixed(2)}, movimientos ${numeroMov}`);
}

// --- Escritura ------------------------------------------------------------------------------------------------------
const encabezado = (servicio) =>
  `603 · Historia de demostración (${servicio}): obras 4, 5 y 6. Archivo GENERADO por infra/semilla/historia/generar.mjs; no se edita a mano. Se une a los datos de la 011 con SEMILLA_HISTORIA=si.`;
const escribir = (ruta, datos) => writeFileSync(ruta, `${JSON.stringify(datos, null, 2)}\n`);
escribir(resolve(RAIZ, 'services/obras/src/main/resources/semilla/obras-historia.json'), { _fuente: encabezado('Obras'), ...salida.obras });
escribir(resolve(RAIZ, 'services/finanzas/database/seeders/datos/finanzas-historia.json'), { fuente: encabezado('Finanzas'), ...salida.finanzas });
escribir(resolve(RAIZ, 'services/materiales/src/semilla/materiales-historia.json'), salida.materiales);
for (const [desde, hacia] of fotosACopiar) {
  if (!existsSync(desde)) throw new Error(`Falta la imagen ${desde}`);
  mkdirSync(dirname(hacia), { recursive: true });
  copyFileSync(desde, hacia);
}
console.log(resumen.join('\n'));
console.log(resumenCobros.join('\n'));
console.log(
  `\nObras: ${salida.obras.obras.length} obras, ${salida.obras.planillas.length} planillas, ${salida.obras.fotos.length} fotos · ` +
    `Finanzas: ${salida.finanzas.cobros.length} cobros (${salida.finanzas.cobros.filter((c) => c.pagadoEn).length} pagados), ${salida.finanzas.envios.length} envíos · ` +
    `Materiales: ${salida.materiales.movimientos.length} movimientos, ${salida.materiales.stock.length} mínimos, ${salida.materiales.cierres.length} cierres`,
);
