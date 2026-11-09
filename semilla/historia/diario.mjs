// 603 · Diario de obra de la historia de demostración: una entrada de lunes a sábado en las seis obras, desde su inicio
// hasta el día anterior a D, con la fecha real de la carga (por eso se arma al correr y no va en un archivo).
// - El clima es el mismo en toda la ciudad cada día y sigue la estación de Santa Cruz (lluvias de noviembre a marzo,
//   surazos con llovizna de mayo a agosto, calor seco en septiembre y octubre).
// - El texto sale de lo que se construye ese mes en cada obra (sus partidas) y de su escenario: en la obra 5 (muy
//   atrasada), faltas de material y de personal; en la 6 (atraso moderado), algunas esperas.
// Determinista: el mismo D da las mismas entradas. Ids b3000000-0000-4000-8000-0000000ONNNN (O = obra).
// Lo usa semilla/agentes.mjs con SEMILLA_HISTORIA=si.

const DIA_MS = 86400000;

/** Obras: días desde el inicio hasta D y, por mes (k respecto de D), lo que se construye. */
const OBRAS = {
  1: { inicio: 120, trabajos: { '-3': ['excavacion', 'zapatas'], '-2': ['zapatas', 'columnas', 'losa'], '-1': ['columnas', 'losa', 'muro'], 0: ['columnas', 'losa', 'muro'] } },
  2: { inicio: 150, trabajos: { '-4': ['excavacion', 'ciclopeo'], '-3': ['ciclopeo', 'zapatas'], '-2': ['zapatas', 'columnas'], '-1': ['columnas'], 0: ['columnas', 'losa'] } },
  3: { inicio: 5, trabajos: { 0: ['limpieza'] } },
  4: { inicio: 185, trabajos: { '-6': ['excavacion', 'zapatas'], '-5': ['zapatas', 'columnas'], '-4': ['columnas', 'losa'], '-3': ['columnas', 'losa', 'muro'], '-2': ['columnas', 'losa', 'muro'], '-1': ['columnas', 'losa', 'muro', 'revoque'], 0: ['losa', 'muro', 'revoque'] } },
  5: { inicio: 215, trabajos: { '-7': ['excavacion'], '-6': ['excavacion', 'ciclopeo'], '-5': ['ciclopeo', 'zapatas'], '-4': ['ciclopeo', 'zapatas'], '-3': ['zapatas', 'columnas'], '-2': ['columnas', 'losa'], '-1': ['columnas', 'losa', 'muro'], 0: ['columnas', 'losa', 'muro'] } },
  6: { inicio: 158, trabajos: { '-5': ['excavacion', 'zapatas'], '-4': ['zapatas', 'columnas'], '-3': ['columnas', 'losa'], '-2': ['columnas', 'losa', 'muro'], '-1': ['columnas', 'losa', 'muro'], 0: ['columnas', 'losa', 'muro'] } },
};

const NIVELES = ['planta baja', 'primer piso', 'segundo piso', 'tercer piso', 'cuarto piso'];
const TRABAJOS = {
  excavacion: ['Excavación con retroexcavadora en el sector {sector}; se retiraron {n} volquetas de tierra.', 'Excavación de fundaciones en el eje {eje} y nivelación del fondo.'],
  limpieza: ['Limpieza del terreno y replanteo de ejes con el topógrafo.', 'Desbroce del terreno y marcado de las fundaciones.'],
  ciclopeo: ['Vaciado de cimiento ciclópeo en el eje {eje}.', 'Preparación de piedra manzana y vaciado del cimiento del eje {eje}.'],
  zapatas: ['Armado de fierro y encofrado de zapatas del eje {eje}.', 'Vaciado de hormigón en zapatas del eje {eje}.'],
  columnas: ['Vaciado de columnas del {nivel}.', 'Armado de fierro de vigas del {nivel}.', 'Encofrado de columnas y vigas del {nivel}.'],
  losa: ['Encofrado y armado de la losa del {nivel}.', 'Vaciado de un paño de la losa del {nivel}.'],
  muro: ['Muro de ladrillo de 6 huecos en el {nivel}, bloque {bloque}.', 'Levantado de muros perimetrales del {nivel}.'],
  revoque: ['Revoque grueso en ambientes del {nivel}.', 'Preparación de paredes y revoque fino en el {nivel}.'],
};
const CLIMA_TEXTO = {
  SOLEADO: ['Día soleado y caluroso.', 'Día despejado.'],
  NUBLADO: ['Cielo nublado, sin lluvia.', 'Día nublado y fresco.'],
  LLUVIA_LEVE: ['Llovizna por la mañana; se trabajó con normalidad por la tarde.', 'Surazo con llovizna: se trabajó a medio ritmo.'],
  LLUVIA_FUERTE: ['Lluvia fuerte: se suspendieron los trabajos al aire libre y el personal armó fierro bajo techo.', 'Tormenta desde temprano; no hubo vaciado y se cubrieron los materiales.'],
};
const INCIDENTES = {
  5: [
    'No llegó el cemento pedido: el proveedor no entregó a tiempo y se reprogramó el vaciado.',
    'Faltó personal: solo vinieron {pocos} obreros.',
    'La mixer llegó con dos horas de retraso; se vació solo una parte.',
    'Se esperó la revisión del residente para liberar el vaciado.',
    'Faltó fierro de 1/2" para las vigas; se pidió con urgencia.',
  ],
  6: ['Se esperó la llegada del fierro de 3/8" para la losa.', 'Faltaron dos albañiles; el muro avanzó menos de lo previsto.'],
};
const PROBABILIDAD_INCIDENTE = { 5: 0.3, 6: 0.12 };

/** Número al azar (0 a 1) que depende solo de la semilla. */
function azar(semilla) {
  let t = (semilla + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Clima de la ciudad ese día, según la estación. */
function climaDe(fecha) {
  const mes = fecha.getUTCMonth() + 1;
  const r = azar(Math.floor(fecha.getTime() / DIA_MS) * 7 + 1);
  const lluvioso = [11, 12, 1, 2, 3].includes(mes);
  const surazos = [5, 6, 7, 8].includes(mes);
  const [fuerte, leve, nublado] = lluvioso ? [0.16, 0.22, 0.25] : surazos ? [0.03, 0.14, 0.3] : [0.04, 0.08, 0.18];
  if (r < fuerte) return 'LLUVIA_FUERTE';
  if (r < fuerte + leve) return 'LLUVIA_LEVE';
  if (r < fuerte + leve + nublado) return 'NUBLADO';
  return 'SOLEADO';
}

const elegir = (lista, r) => lista[Math.floor(r * lista.length) % lista.length];
const rellenar = (texto, r, k, obra) =>
  texto
    .replace('{sector}', elegir(['norte', 'sur', 'este', 'oeste'], r))
    .replace('{eje}', elegir(['A', 'B', 'C', 'D', 'E', '1', '2', '3', '4'], azar(r * 1e6)))
    .replace('{n}', String(6 + Math.floor(r * 10)))
    .replace('{bloque}', elegir(['A', 'B'], azar(r * 1e7)))
    .replace('{pocos}', String(4 + Math.floor(r * 4)))
    // el nivel sube con los meses de obra
    .replace('{nivel}', NIVELES[Math.min(NIVELES.length - 1, Math.max(0, Math.floor((OBRAS[obra].inicio / 30 + k) / 1.5)))]);

/**
 * Entradas del diario de las seis obras con la fecha de carga `d` (AAAA-MM-DD), sin los días de `ocupados`
 * (conjunto «obra|AAAA-MM-DD», las entradas fijas de agentes.mjs).
 */
export function diarioHistorico(d, ocupados = new Set()) {
  const hoy = new Date(`${d}T00:00:00Z`);
  const entradas = [];
  for (const [numero, obra] of Object.entries(OBRAS)) {
    const n = Number(numero);
    let correlativo = 0;
    for (let dias = obra.inicio; dias >= 1; dias--) {
      const fecha = new Date(hoy.getTime() - dias * DIA_MS);
      if (fecha.getUTCDay() === 0) continue; // domingo
      const texto10 = fecha.toISOString().slice(0, 10);
      correlativo++;
      if (ocupados.has(`${n}|${texto10}`)) continue;
      const k = (fecha.getUTCFullYear() - hoy.getUTCFullYear()) * 12 + fecha.getUTCMonth() - hoy.getUTCMonth();
      const trabajos = obra.trabajos[k] ?? obra.trabajos[Object.keys(obra.trabajos).map(Number).sort((a, b) => a - b)[0]];
      const semilla = n * 100003 + Math.floor(fecha.getTime() / DIA_MS);
      const clima = climaDe(fecha);
      const partes = [elegir(CLIMA_TEXTO[clima], azar(semilla + 3))];
      const trabajo = elegir(trabajos, azar(semilla + 5));
      partes.push(rellenar(elegir(TRABAJOS[trabajo], azar(semilla + 7)), azar(semilla + 11), k, n));
      let incidente = null;
      if (azar(semilla + 13) < (PROBABILIDAD_INCIDENTE[n] ?? 0)) {
        incidente = elegir(INCIDENTES[n], azar(semilla + 17));
        partes.push(rellenar(incidente, azar(semilla + 19), k, n));
      }
      // Si el problema del día es la falta de personal, ese texto ya dice cuántos vinieron
      if (!incidente?.includes('{pocos}')) {
        partes.push(`Cuadrilla de ${(n === 5 ? 6 : 10) + Math.floor(azar(semilla + 23) * 10)} obreros.`);
      }
      entradas.push({
        obra: n,
        id: `b3000000-0000-4000-8000-0000000${n}${String(correlativo).padStart(4, '0')}`,
        fecha: texto10,
        clima,
        texto: partes.join(' '),
      });
    }
  }
  return entradas;
}
