// 503 · Eventos de prueba para el servicio de IA: lo que la carga inicial de la 401 no produce.
//
// La semilla (011) no publica eventos y la carga inicial (401) llena reportes_db por REST, pero no evalúa las salidas
// pasadas como posibles consumos atípicos (403): ia_db.consumo_atipico solo se llena cuando llega un
// MovimientoRegistrado. Este script vuelve a publicar, en la cola "ia" y solo en ella (exchange por defecto), el
// MovimientoRegistrado de dos salidas que ya existen en Materiales (docs/datos-prueba.md, sección 9):
//   - 10033: FIE-12 de la obra 1 en M-1, consumo excedido (6.000 frente a 4.800 kg previstos);
//   - 20018: CEM-IP30 de la obra 2 en M-1, salida que superó el stock (supera_stock = true).
// Los datos salen de Materiales (GET /obras/{id}/movimientos y GET /materiales, con el token de gerente1), así el
// evento es igual al que habría publicado Materiales. El modelo de IA decide si cada salida es atípica (no se fuerza).
//
// Ids fijos: el id del evento es fa000000-0000-4000-8000-0000000NNNNN con el N.º del movimiento. IA los guarda en su
// inbox (evento_aplicado): correrlo otra vez no repite nada; después de recargar (que vacía reportes_db y
// consumo_atipico) se vuelven a aplicar. Va DESPUÉS de la semilla y de la carga inicial, con ia-worker corriendo.
//
// Uso: node semilla/eventos-ia.mjs [--entorno nube/.env]   publica y, si ia-worker consume la cola, espera y muestra
//      el resultado. Sin --entorno, desarrollo (infra/.env con SEMILLA_PERMITIDA=si); con --entorno, la «producción
//      local» o la nube con SEMILLA_DEMO=si (602: solo agrega eventos, nunca vacía; semilla/entorno-script.mjs).
//      --todas (603): publica el MovimientoRegistrado de TODAS las salidas de las obras 1 a 6 (con la historia de
//      demostración), en orden cronológico; id de evento fa000000-… con el número del movimiento.
// Node 24, sin dependencias.
import { entornoDelScript } from './entorno-script.mjs';

const { env, valor, token: tokenDe, descripcion } = await entornoDelScript('eventos-ia');

const RABBITMQ = valor('RABBITMQ_PANEL_URL', 'http://localhost:15672');
const MATERIALES = valor('MATERIALES_URL', 'http://localhost:8082');
const IA = valor('IA_URL', 'http://localhost:8085');
const COLA = 'ia';
const CLAVE = 'evento.materiales.MovimientoRegistrado';
// Mismo flujo para todos los eventos de esta carga (correlacionId del sobre)
const CORRELACION = 'fa000000-0000-4000-8000-000000000000';
const TODAS = process.argv.includes('--todas');
const OBRAS_HISTORIA = [1, 2, 3, 4, 5, 6];

const obra = (n) => `b0000000-0000-4000-8000-00000000000${n}`;
const movimiento = (numero) => `f0000000-0000-4000-8000-0000000${numero}`;
const idEvento = (numero) => `fa000000-0000-4000-8000-0000000${numero}`;

/** Salidas que se vuelven a publicar (número de docs/datos-prueba.md, obra y qué muestran). */
const SALIDAS = [
  { numero: '10033', obra: 1, caso: 'FIE-12 excedido en columnas (obra 1, M-1)' },
  { numero: '20018', obra: 2, caso: 'CEM-IP30 que superó el stock (obra 2, M-1)' },
];

const salir = (mensaje) => {
  console.error(mensaje);
  process.exit(1);
};

/** Sobre común (docs/convenciones.md) del MovimientoRegistrado de un movimiento de Materiales. */
function armarEvento(numero, mov, precioReferencial) {
  return {
    id: idEvento(numero),
    tipo: 'MovimientoRegistrado',
    version: 1,
    ocurridoEn: mov.registradoEn,
    origen: 'materiales',
    correlacionId: CORRELACION,
    datos: {
      movimientoId: mov.id,
      obraId: mov.obraId,
      materialId: mov.materialId,
      tipo: mov.tipo,
      cantidad: mov.cantidad,
      precioReferencial,
      partidaId: mov.partidaId,
      periodo: mov.periodo,
      superaStock: mov.superaStock,
      registradoEn: mov.registradoEn,
    },
  };
}

async function pedirJson(url, token) {
  const respuesta = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!respuesta.ok) throw new Error(`${url} respondió ${respuesta.status}`);
  return respuesta.json();
}

/** Todas las páginas de un GET paginado de Materiales ({ items, total, pagina, tamano }). */
async function todasLasPaginas(ruta, token) {
  const items = [];
  for (let pagina = 1; ; pagina++) {
    const separador = ruta.includes('?') ? '&' : '?';
    const datos = await pedirJson(`${MATERIALES}${ruta}${separador}pagina=${pagina}&tamano=100`, token);
    items.push(...datos.items);
    if (items.length >= datos.total || datos.items.length === 0) return items;
  }
}

const autorizacionRabbit =
  'Basic ' + Buffer.from(`${env.RABBITMQ_ADMIN_USUARIO}:${env.RABBITMQ_ADMIN_CLAVE}`).toString('base64');

async function rabbit(ruta, opciones = {}) {
  const respuesta = await fetch(`${RABBITMQ}/api${ruta}`, {
    ...opciones,
    headers: { authorization: autorizacionRabbit, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!respuesta.ok) throw new Error(`RabbitMQ ${ruta} respondió ${respuesta.status}`);
  return respuesta.json();
}

/** Publica en la cola ia por el exchange por defecto: no llega a ninguna otra cola de la plataforma. */
async function publicar(evento) {
  const { routed } = await rabbit('/exchanges/%2F/amq.default/publish', {
    method: 'POST',
    body: JSON.stringify({
      routing_key: COLA,
      properties: {
        delivery_mode: 2,
        content_type: 'application/json',
        message_id: evento.id,
        correlation_id: evento.correlacionId,
        type: evento.tipo,
        // Clave original: el consumidor la usa si el mensaje termina en plataforma.fallidos
        headers: { 'x-clave-origen': CLAVE },
      },
      payload: JSON.stringify(evento),
      payload_encoding: 'string',
    }),
  });
  if (!routed) throw new Error(`El evento ${evento.id} no llegó a la cola ${COLA} (¿existe? corre ./scripts/levantar.ps1).`);
}

async function esperarCola(limiteMs) {
  const hasta = Date.now() + limiteMs;
  for (;;) {
    const cola = await rabbit(`/queues/%2F/${COLA}`);
    if ((cola.messages ?? 0) === 0) return true;
    if (Date.now() > hasta) return false;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function main() {
  console.log(`Eventos de prueba de IA (403) · ${descripcion}`);
  let token;
  try {
    token = await tokenDe('gerente1');
  } catch (error) {
    salir(`No se pudo obtener el token de gerente1 en Keycloak: ${error.message}`);
  }

  let materiales;
  try {
    materiales = new Map((await todasLasPaginas('/materiales', token)).map((m) => [m.id, m]));
  } catch (error) {
    salir(`Materiales no responde (${MATERIALES}): levántalo antes. ${error.message}`);
  }

  const eventos = [];
  if (TODAS) {
    // 603: todas las salidas de las seis obras, en orden cronológico
    for (const n of OBRAS_HISTORIA) {
      let movimientos;
      try {
        movimientos = await todasLasPaginas(`/obras/${obra(n)}/movimientos`, token);
      } catch (error) {
        console.log(`aviso    obra ${n}: ${error.message} (¿sin la historia de demostración?)`);
        continue;
      }
      for (const mov of movimientos.filter((m) => m.tipo === 'SALIDA')) {
        const numero = mov.id.slice(-5);
        eventos.push({
          salida: { numero, obra: n, caso: `obra ${n}` },
          registradoEn: mov.registradoEn,
          evento: armarEvento(numero, { ...mov, obraId: obra(n) }, materiales.get(mov.materialId)?.precioReferencial ?? null),
        });
      }
    }
    eventos.sort((a, b) => a.registradoEn.localeCompare(b.registradoEn));
  }
  for (const salida of TODAS ? [] : SALIDAS) {
    const movimientos = await todasLasPaginas(`/obras/${obra(salida.obra)}/movimientos`, token);
    const mov = movimientos.find((m) => m.id === movimiento(salida.numero));
    if (!mov) salir(`No está el movimiento ${salida.numero} (${movimiento(salida.numero)}) en Materiales: corre antes ./semilla/semilla.ps1.`);
    if (mov.tipo !== 'SALIDA') salir(`El movimiento ${salida.numero} no es una salida: revisa la semilla de Materiales.`);
    const material = materiales.get(mov.materialId);
    eventos.push({ salida, evento: armarEvento(salida.numero, { ...mov, obraId: obra(salida.obra) }, material?.precioReferencial ?? null) });
  }

  let publicados = 0;
  for (const { salida, evento } of eventos) {
    await publicar(evento);
    publicados++;
    if (!TODAS) console.log(`ok       MovimientoRegistrado ${salida.numero} publicado en la cola ${COLA} (${salida.caso}; evento ${evento.id})`);
    else if (publicados % 200 === 0 || publicados === eventos.length) console.log(`ok       ${publicados} de ${eventos.length} salidas publicadas en la cola ${COLA}`);
  }

  const cola = await rabbit(`/queues/%2F/${COLA}`);
  if ((cola.consumers ?? 0) === 0) {
    console.log(`aviso    La cola ${COLA} no tiene consumidor: los eventos se aplican cuando corra ia-worker.`);
    return;
  }
  const espera = TODAS ? 15 * 60000 : 30000;
  if (!(await esperarCola(espera))) {
    console.log(`aviso    ia-worker no vació la cola ${COLA} en ${espera / 1000} s; revisa sus registros.`);
    return;
  }
  if (TODAS) {
    // Resumen por obra: consumos atípicos que detectó el modelo (403); el token dura 5 minutos, se pide otro
    token = await tokenDe('gerente1');
    for (const n of OBRAS_HISTORIA) {
      try {
        const lista = await pedirJson(`${IA}/consumos-atipicos?obraId=${obra(n)}`, token);
        console.log(`ok       obra ${n}: ${lista.length} consumos atípicos${lista.length ? ` (${lista.map((c) => `${c.puntaje}`).join(', ')})` : ''}`);
      } catch (error) {
        console.log(`aviso    obra ${n}: no se pudo leer el resultado en IA: ${error.message}`);
      }
    }
    return;
  }
  // Resultado: consumos atípicos de las dos obras según el servicio de IA (GET /consumos-atipicos, 403)
  try {
    for (const n of [1, 2]) {
      const lista = await pedirJson(`${IA}/consumos-atipicos?obraId=${obra(n)}`, token);
      const nuestros = lista.filter((c) => SALIDAS.some((s) => movimiento(s.numero) === c.movimientoId));
      for (const salida of SALIDAS.filter((s) => s.obra === n)) {
        const c = nuestros.find((x) => x.movimientoId === movimiento(salida.numero));
        console.log(
          c
            ? `ok       ${salida.numero}: consumo atípico ${c.estadoRevision} (puntaje ${c.puntaje}; ${c.motivos.join('; ')})`
            : `ok       ${salida.numero}: el modelo la evaluó como normal (no hay consumo atípico)`,
        );
      }
    }
  } catch (error) {
    console.log(`aviso    No se pudo leer el resultado en IA (${IA}): ${error.message}`);
  }
}

await main();
