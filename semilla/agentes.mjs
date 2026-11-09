// 502 · Datos de prueba para los agentes del ERP: carga lo que falta y comprueba el escenario completo.
//
// Escenario (diseño de la 502, «Infra»): una obra atrasada con entradas de diario de lluvia, un material bajo, una
// salida que supera el stock, un cobro vencido, una planilla presentada hace más de 7 días, predicciones de riesgo
// (402) y un consumo atípico PENDIENTE (403). Con estos datos el modelo rr-1.0.0 da BAJO a la obra 2 (su única
// planilla aprobada juntó 16 puntos en un mes); el camino «ALTO» se prueba con datos simulados en services/ia
// (decisión de Jairo, 01/11/2026).
//
// Lo único que no traen la semilla (011), la carga inicial (401) ni semilla/eventos-ia.mjs (503) son las entradas del
// diario de obra (103; docs/datos-prueba.md, sección 13: «días de lluvia que explican el atraso» de la obra 2). Este
// script las registra por la API de Obras (POST /obras/{obraId}/diario) como maestro1, el maestro asignado, igual que
// lo haría Sincronización desde el celular: Obras sigue siendo el único que escribe su base. Ids fijos
// b2000000-0000-4000-8000-000000000ONN (O = obra, NN = correlativo) y fechas relativas a D: si el id ya existe, Obras
// devuelve el existente (200); correrlo otra vez no duplica nada. Después de recargar, se vuelve a correr.
//
// Luego comprueba, con el token de gerente1 y por REST, cada caso del escenario y dice cuál falta (no lo fuerza).
//
// Uso: node semilla/agentes.mjs [--entorno nube/.env]   (después de la semilla, la carga inicial y
//      semilla/eventos-ia.mjs; con Obras, Materiales, Finanzas e IA levantados). SEMILLA_FECHA fija la fecha D como en
//      la semilla. Sin --entorno, desarrollo (infra/.env con SEMILLA_PERMITIDA=si); con --entorno, la «producción
//      local» o la nube con SEMILLA_DEMO=si (602: solo agrega entradas del diario, nunca vacía; entorno-script.mjs).
// Node 24, sin dependencias.
import { entornoDelScript } from './entorno-script.mjs';

const { valor, token: tokenDe, descripcion } = await entornoDelScript('agentes');

const OBRAS = valor('OBRAS_URL', 'http://localhost:8081');
const MATERIALES = valor('MATERIALES_URL', 'http://localhost:8082');
const FINANZAS = valor('FINANZAS_URL', 'http://localhost:8083');
const IA = valor('IA_URL', 'http://localhost:8085');

const obra = (n) => `b0000000-0000-4000-8000-00000000000${n}`;
const entrada = (n, nn) => `b2000000-0000-4000-8000-000000000${n}${String(nn).padStart(2, '0')}`;

// Entradas del diario (decisión del equipo para los datos de prueba de la 502: textos y climas coherentes con
// docs/datos-prueba.md). Obra 2 (Condominio Las Lomas, atrasada): lluvias que frenan columnas y vigas (P-04), la losa
// alivianada (P-05) y el muro (P-06), las partidas del periodo. Obra 1 (Las Palmeras, a buen ritmo): dos días normales.
// diasAntes: la fecha es D − diasAntes (todas dentro de los últimos 30 días y después del inicio de cada obra).
const DIARIO = [
  { obra: 2, nn: 1, diasAntes: 26, clima: 'LLUVIA_FUERTE', texto: 'Lluvia fuerte desde la madrugada. No se pudo vaciar el hormigón de las columnas del bloque B; el personal ordenó y cubrió el material bajo techo.' },
  { obra: 2, nn: 2, diasAntes: 25, clima: 'LLUVIA_LEVE', texto: 'Lluvia intermitente. Solo se avanzó con el armado de fierro de las vigas; el vaciado sigue postergado porque el terreno está anegado.' },
  { obra: 2, nn: 3, diasAntes: 18, clima: 'LLUVIA_FUERTE', texto: 'Tormenta por la tarde. Se suspendió el encofrado de la losa alivianada y se cubrieron con nylon las bolsas de cemento.' },
  { obra: 2, nn: 4, diasAntes: 12, clima: 'LLUVIA_FUERTE', texto: 'Llovió todo el día. La mixer no pudo entrar por el barro de la calle de acceso; no hubo vaciado.' },
  { obra: 2, nn: 5, diasAntes: 11, clima: 'NUBLADO', texto: 'Se sacó el agua de las excavaciones y se revisaron los encofrados dañados por la lluvia. Trabajo a medio ritmo.' },
  { obra: 2, nn: 6, diasAntes: 5, clima: 'LLUVIA_LEVE', texto: 'Llovizna por la mañana. Por la tarde se vaciaron dos columnas del bloque B; la losa alivianada sigue atrasada.' },
  { obra: 2, nn: 7, diasAntes: 2, clima: 'SOLEADO', texto: 'Día seco. Se avanzó con el muro de ladrillo del bloque A y se preparó el encofrado de la losa.' },
  { obra: 1, nn: 1, diasAntes: 4, clima: 'SOLEADO', texto: 'Vaciado de columnas del cuarto piso sin novedades. Llegó el fierro de 3/8" para la losa.' },
  { obra: 1, nn: 2, diasAntes: 1, clima: 'NUBLADO', texto: 'Cielo nublado sin lluvia. Avance normal del muro de ladrillo del segundo piso.' },
];

const salir = (mensaje) => {
  console.error(mensaje);
  process.exit(1);
};

/** D: SEMILLA_FECHA si es válida; si no, hoy en America/La_Paz (como semilla/plataforma.mjs). */
function fechaD() {
  const dada = valor('SEMILLA_FECHA', '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(dada) && !Number.isNaN(Date.parse(`${dada}T00:00:00Z`))) return dada;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(new Date());
}

function restarDias(fecha, dias) {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

async function pedir(url, token, opciones = {}) {
  return fetch(url, {
    ...opciones,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(opciones.headers ?? {}) },
    signal: AbortSignal.timeout(10000),
  });
}

async function pedirJson(url, token) {
  const respuesta = await pedir(url, token);
  if (!respuesta.ok) throw new Error(`${url} respondió ${respuesta.status}`);
  return respuesta.json();
}

async function cargarDiario(d, tokenMaestro) {
  let problemas = 0;
  for (const e of DIARIO) {
    const fecha = restarDias(d, e.diasAntes);
    const cuerpo = { id: entrada(e.obra, e.nn), fecha, clima: e.clima, texto: e.texto };
    let respuesta;
    try {
      respuesta = await pedir(`${OBRAS}/obras/${obra(e.obra)}/diario`, tokenMaestro, { method: 'POST', body: JSON.stringify(cuerpo) });
    } catch (error) {
      salir(`Obras no responde (${OBRAS}): levántalo antes. ${error.message}`);
    }
    const etiqueta = `diario obra ${e.obra} ${fecha} ${e.clima}`;
    if (respuesta.status === 201) console.log(`ok       ${etiqueta}: registrada`);
    else if (respuesta.status === 200) console.log(`ok       ${etiqueta}: ya estaba`);
    else if (respuesta.status === 409) {
      problemas++;
      console.log(`aviso    ${etiqueta}: ya hay otra entrada ese día (409), se deja la que existe`);
    } else {
      problemas++;
      console.log(`ERROR    ${etiqueta}: ${respuesta.status} ${(await respuesta.text()).slice(0, 300)}`);
    }
  }
  return problemas;
}

/** Cada caso del escenario: true (está), false (falta) o null (no se pudo comprobar). */
async function comprobar(token) {
  const casos = [];
  const caso = async (nombre, fn) => {
    try {
      const { ok, detalle } = await fn();
      casos.push({ nombre, estado: ok, detalle });
    } catch (error) {
      casos.push({ nombre, estado: null, detalle: error.message });
    }
  };
  await caso('Obra atrasada con diario de lluvia (obra 2)', async () => {
    const o = await pedirJson(`${OBRAS}/obras/${obra(2)}`, token);
    const diario = await pedirJson(`${OBRAS}/obras/${obra(2)}/diario`, token);
    const lluvias = diario.filter((x) => x.clima.startsWith('LLUVIA')).length;
    return { ok: o.enRiesgo && lluvias > 0, detalle: `avance ${o.avancePct} %, plazo ${o.plazoPct} %, en riesgo: ${o.enRiesgo}; ${lluvias} días de lluvia en el diario de los últimos 30 días` };
  });
  await caso('Material bajo (CEM-IP30, obra 2)', async () => {
    const stock = await pedirJson(`${MATERIALES}/obras/${obra(2)}/stock`, token);
    const bajos = stock.filter((s) => s.estado === 'BAJO').map((s) => `${s.codigo} ${s.cantidad}/${s.minimo}`);
    return { ok: bajos.length > 0, detalle: bajos.join(', ') || 'ninguno en BAJO' };
  });
  await caso('Salida que supera el stock (20018, obra 2)', async () => {
    const datos = await pedirJson(`${MATERIALES}/obras/${obra(2)}/movimientos?tamano=100`, token);
    const m = datos.items.find((x) => x.id === 'f0000000-0000-4000-8000-000000020018');
    return { ok: Boolean(m?.superaStock), detalle: m ? `${m.cantidad} el ${m.registradoEn}, superaStock ${m.superaStock}` : 'no está la salida 20018' };
  });
  await caso('Cobro vencido', async () => {
    const datos = await pedirJson(`${FINANZAS}/cobros?estado=VENCIDO`, token);
    return { ok: datos.total > 0, detalle: datos.items.map((c) => `${c.numero} ${c.montoNeto} (venció ${c.venceEn})`).join(', ') || 'ninguno' };
  });
  await caso('Planilla presentada (obra 1 N.º 3)', async () => {
    const planillas = await pedirJson(`${OBRAS}/obras/${obra(1)}/planillas`, token);
    const p = planillas.find((x) => x.estado === 'PRESENTADA');
    // presentada_en (501) no sale por REST: la semilla de Obras la carga en D − 10 (herramienta MCP planillas_estado)
    return { ok: Boolean(p), detalle: p ? `N.º ${p.numero} (${p.periodo}) PRESENTADA; presentada_en = D − 10 en la semilla de Obras (501)` : 'ninguna PRESENTADA' };
  });
  await caso('Predicciones de riesgo (402)', async () => {
    const ids = [1, 2, 3].map(obra).join(',');
    const lista = await pedirJson(`${IA}/predicciones?obraIds=${ids}`, token);
    const niveles = lista.map((p) => `obra ${p.obraId.slice(-1)} ${p.nivel}${p.probabilidad == null ? '' : ` ${p.probabilidad}`}`);
    return { ok: lista.some((p) => p.probabilidad != null), detalle: niveles.join(', ') || 'sin predicciones (¿corrió la carga inicial?)' };
  });
  await caso('Consumo atípico PENDIENTE (403)', async () => {
    const lista = await pedirJson(`${IA}/consumos-atipicos?estado=PENDIENTE`, token);
    return { ok: lista.length > 0, detalle: lista.map((c) => `${c.movimientoId.slice(-5)} (obra ${c.obraId.slice(-1)})`).join(', ') || 'ninguno (corre semilla/eventos-ia.mjs)' };
  });
  return casos;
}

async function main() {
  const d = fechaD();
  console.log(`Datos de prueba de los agentes (502) · D = ${d} · ${descripcion}`);

  let tokenMaestro;
  let tokenGerente;
  try {
    tokenMaestro = await tokenDe('maestro1');
    tokenGerente = await tokenDe('gerente1');
  } catch (error) {
    salir(`No se pudo obtener el token de maestro1 o gerente1 en Keycloak: ${error.message}`);
  }

  const problemas = await cargarDiario(d, tokenMaestro);

  console.log('\nEscenario de los agentes:');
  const casos = await comprobar(tokenGerente);
  for (const c of casos) {
    const marca = c.estado === true ? 'ok      ' : c.estado === false ? 'FALTA   ' : 'sin ver ';
    console.log(`${marca} ${c.nombre}: ${c.detalle}`);
  }
  const faltan = casos.filter((c) => c.estado !== true).length;
  console.log(faltan === 0 ? '\nEl escenario está completo.' : `\n${faltan} de ${casos.length} casos faltan o no se pudieron comprobar (arriba).`);
  if (problemas > 0) process.exitCode = 2;
}

await main();
