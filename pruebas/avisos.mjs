// Prueba de punta a punta del correo «Planilla para revisar» (010) contra lo que está corriendo:
//   1. residente2 vuelve a presentar la planilla N.º 2 de la obra 2 (OBSERVADA en los datos de prueba) → en menos de
//      1 minuto le llega a demo1, cliente de esa obra, «Planilla corregida para revisar: N.º 2 · …», solo a él;
//   2. el mismo PlanillaPresentada otra vez (mismo id del sobre, solo a la cola n8n.planilla-presentada) → ningún
//      correo nuevo;
//   3. demo1, residente de la obra 3 (sin planillas), elabora y presenta la planilla del mes → «Planilla para revisar:
//      N.º 1 · Unidad Educativa Nueva Esperanza · …» a cliente1, con el neto y el enlace al portal.
// Para tener el sobre exacto que publicó Obras (con su id), la prueba enlaza un momento una cola temporal propia
// (prueba.avisos-010, se borra sola a los 10 minutos sin uso) a evento.obras.PlanillaPresentada y la borra
// al terminar.
// El push de stock bajo y del diario no se prueba aquí: necesita un proyecto de Firebase (README, «Avisos al celular
// y al cliente»).
// Necesita: ./scripts/levantar.ps1 -Perfil automatizacion, los datos de prueba recién cargados (./semilla/recargar.ps1)
// y Obras corriendo (con el evento PlanillaPresentada de la 010).
// Uso: node pruebas/avisos.mjs   (variables opcionales: OBRAS_URL, N8N_URL, MAILPIT_URL, PORTAL_URL)
// Crea datos (presenta dos planillas): úsala solo en desarrollo.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { obtenerTokenUsuario } from './token-usuario.mjs';

const env = Object.fromEntries(
  readFileSync(fileURLToPath(new URL('../.env', import.meta.url)), 'utf8')
    .split(/\r?\n/)
    .filter((linea) => linea && !linea.startsWith('#') && linea.includes('='))
    .map((linea) => [linea.slice(0, linea.indexOf('=')).trim(), linea.slice(linea.indexOf('=') + 1).trim()]),
);
const OBRAS = process.env.OBRAS_URL ?? 'http://localhost:8081';
const N8N = process.env.N8N_URL ?? 'http://localhost:5678';
const MAILPIT = `${process.env.MAILPIT_URL ?? 'http://localhost:8025'}/api/v1`;
const PORTAL = process.env.PORTAL_URL ?? env.PORTAL_URL ?? 'http://localhost:4300';
const RABBITMQ = 'http://localhost:15672/api';
const COBRANZAS = env.COBRANZA_CORREO || 'cobranzas@constructora-andina.test';
const OBRA2 = 'b0000000-0000-4000-8000-000000000002';
const OBRA3 = 'b0000000-0000-4000-8000-000000000003';
const PLANILLA_OBSERVADA = 'd0000000-0000-4000-8000-000000000202'; // obra 2, N.º 2 (datos de prueba, sección 7)
const DEMO1 = 'demo1@constructora-andina.test'; // cliente de la obra 2
const CLIENTE1 = 'cliente1@correo.test'; // cliente de la obra 3
const COLA_TEMPORAL = 'prueba.avisos-010';
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const resultados = [];
function comprobar(nombre, ok, detalle = '') {
  resultados.push(Boolean(ok));
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre}${detalle ? ` · ${detalle}` : ''}`);
  return ok;
}
const esperar = (ms) => new Promise((listo) => setTimeout(listo, ms));
const mesLaPaz = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(new Date()).slice(0, 7);
const periodoTexto = (p) => `${MESES[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
const bs = (n) => 'Bs ' + Number(n).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');

async function rest(metodo, ruta, token, cuerpo) {
  const respuesta = await fetch(OBRAS + ruta, {
    method: metodo,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await respuesta.text();
  return { estado: respuesta.status, json: texto ? JSON.parse(texto) : null };
}

// --- Mailpit: solo cuentan los correos que llegaron después de empezar la prueba ---
const inicio = new Date();
async function correos() {
  const lista = await (await fetch(`${MAILPIT}/messages?limit=200`)).json();
  return (lista.messages ?? []).filter((m) => new Date(m.Created) >= inicio);
}
async function esperarCorreo(condicion, ms) {
  const limite = Date.now() + ms;
  do {
    const encontrado = (await correos()).find(condicion);
    if (encontrado) return encontrado;
    await esperar(2000);
  } while (Date.now() < limite);
  return undefined;
}
const detalle = async (id) => (await fetch(`${MAILPIT}/message/${id}`)).json();
const direcciones = (lista) => (lista ?? []).map((d) => d.Address);
const contar = async (condicion) => (await correos()).filter(condicion).length;

// --- RabbitMQ (administrador de .env) ---
const autorizacionRabbit =
  'Basic ' + Buffer.from(`${env.RABBITMQ_ADMIN_USUARIO}:${env.RABBITMQ_ADMIN_CLAVE}`).toString('base64');
async function rabbit(metodo, ruta, cuerpo) {
  const respuesta = await fetch(`${RABBITMQ}${ruta}`, {
    method: metodo,
    headers: { authorization: autorizacionRabbit, 'content-type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await respuesta.text();
  if (!respuesta.ok) throw new Error(`RabbitMQ ${metodo} ${ruta}: ${respuesta.status} ${texto}`);
  return texto ? JSON.parse(texto) : null;
}
// Cola temporal enlazada a PlanillaPresentada: copia de lo que publica Obras, para volver a mandar a n8n exactamente el
// mismo sobre. Durable porque RabbitMQ 4 ya no acepta colas no durables compartidas; si la prueba se corta, se borra
// sola a los 10 minutos sin uso (x-expires)
async function abrirEscucha() {
  await rabbit('PUT', `/queues/%2F/${COLA_TEMPORAL}`, { durable: true, auto_delete: false, arguments: { 'x-expires': 600000 } });
  await rabbit('POST', `/bindings/%2F/e/plataforma/q/${COLA_TEMPORAL}`, { routing_key: 'evento.obras.PlanillaPresentada' });
}
async function cerrarEscucha() {
  await rabbit('DELETE', `/queues/%2F/${COLA_TEMPORAL}`).catch(() => {});
}
async function esperarSobre(planillaId, ms) {
  const limite = Date.now() + ms;
  do {
    const mensajes = await rabbit('POST', `/queues/%2F/${COLA_TEMPORAL}/get`, { count: 10, ackmode: 'ack_requeue_false', encoding: 'auto' });
    for (const m of mensajes) {
      const sobre = JSON.parse(m.payload);
      if (sobre.datos?.planillaId === planillaId) return { sobre, payload: m.payload, propiedades: m.properties };
    }
    await esperar(1000);
  } while (Date.now() < limite);
  return undefined;
}
// Solo a la cola de n8n (exchange por defecto), no a otros que escuchen PlanillaPresentada
async function republicar(evento) {
  const r = await rabbit('POST', '/exchanges/%2F/amq.default/publish', {
    properties: { delivery_mode: 2, content_type: 'application/json', headers: evento.propiedades?.headers ?? {} },
    routing_key: 'n8n.planilla-presentada',
    payload: evento.payload,
    payload_encoding: 'string',
  });
  return r.routed;
}

// 0. Piezas que responden y flujo publicado
for (const [nombre, url] of [['Mailpit', `${MAILPIT}/info`], ['n8n', `${N8N}/healthz/readiness`], ['Obras', `${OBRAS}/salud`]]) {
  const ok = await fetch(url).then((r) => r.ok, () => false);
  if (!comprobar(`${nombre} responde`, ok, url)) process.exit(1);
}
const cola = await rabbit('GET', '/queues/%2F/n8n.planilla-presentada');
if (!comprobar('n8n escucha la cola n8n.planilla-presentada (flujo «Avisar planilla para revisar» publicado)', (cola.consumers ?? 0) > 0, `${cola.consumers ?? 0} consumidores`)) process.exit(1);

await abrirEscucha();
try {
  // 1. residente2 vuelve a presentar la planilla observada de la obra 2 → «Planilla corregida para revisar»
  const residente2 = await obtenerTokenUsuario('residente2');
  const observada = (await rest('GET', `/planillas/${PLANILLA_OBSERVADA}`, residente2)).json;
  if (comprobar('planilla N.º 2 de la obra 2 OBSERVADA', observada?.estado === 'OBSERVADA', observada?.estado ?? 'no se pudo leer')) {
    const presentar = await rest('POST', `/planillas/${PLANILLA_OBSERVADA}/presentar`, residente2, { version: observada.version });
    comprobar('residente2 la presenta otra vez (200)', presentar.estado === 200, `${presentar.estado} ${presentar.json?.codigo ?? ''}`);
    const presentadaEn = Date.now();
    const evento = await esperarSobre(PLANILLA_OBSERVADA, 30000);
    comprobar('Obras publica PlanillaPresentada con reenvio = true', evento?.sobre.datos.reenvio === true, evento ? JSON.stringify(evento.sobre.datos) : 'no llegó en 30 s');

    const obra2 = (await rest('GET', `/obras/${OBRA2}`, residente2)).json;
    const asunto = `Planilla corregida para revisar: N.º 2 · ${obra2.nombre} · ${periodoTexto(observada.periodo)}`;
    const correo = await esperarCorreo((m) => m.Subject === asunto, 60000);
    comprobar(
      'correo «Planilla corregida para revisar» en menos de 1 minuto',
      correo,
      correo ? `${((new Date(correo.Created) - presentadaEn) / 1000).toFixed(0)} s · «${correo.Subject}»` : `no llegó «${asunto}»`,
    );
    if (correo) {
      const d = await detalle(correo.ID);
      comprobar('solo al cliente (demo1), sin copia a cobranzas', direcciones(d.To).join() === DEMO1 && !direcciones(d.Cc).length && !direcciones(d.Bcc).length, `para ${direcciones(d.To)} · cc ${direcciones(d.Cc)} · cco ${direcciones(d.Bcc)}`);
      comprobar('remitente de la empresa', d.From?.Address === (env.COBRANZA_REMITENTE || COBRANZAS), `${d.From?.Name} <${d.From?.Address}>`);
      const texto = d.Text.replace(/\s+/g, ' ');
      comprobar(
        'cuerpo con el neto y el enlace al portal',
        texto.includes(`le presentamos la planilla N.º 2 de ${periodoTexto(observada.periodo)} de la obra ${obra2.nombre}, con un neto de ${bs(presentar.json?.neto ?? observada.neto)}.`)
          && texto.includes(`${PORTAL}/planillas/${PLANILLA_OBSERVADA}`),
        texto.slice(0, 260),
      );
    }

    // 2. El mismo aviso otra vez → sin segundo correo
    if (evento) {
      comprobar('mismo PlanillaPresentada republicado a n8n', await republicar(evento));
      await esperar(20000);
      comprobar('sin segundo correo por el aviso repetido', (await contar((m) => m.Subject === asunto)) === 1);
    }
  } else {
    console.log('      Recarga los datos de prueba (./semilla/recargar.ps1) y vuelve a correr la prueba.');
  }

  // 3. demo1 (residente de la obra 3) elabora y presenta la planilla del mes → «Planilla para revisar» a cliente1
  const demo1 = await obtenerTokenUsuario('demo1');
  const periodo = mesLaPaz();
  const creada = await rest('POST', `/obras/${OBRA3}/planillas`, demo1, { periodo });
  if (comprobar(`demo1 crea la planilla ${periodo} de la obra 3 (201)`, creada.estado === 201, `${creada.estado} ${creada.json?.codigo ?? ''}`)) {
    const planilla = creada.json;
    const lineas = planilla.lineas.map((l, i) => ({ partidaId: l.partidaId, cantidadPeriodo: i === 0 ? 1 : 0 }));
    const guardada = await rest('PUT', `/planillas/${planilla.id}`, demo1, { version: planilla.version, lineas, fotoIds: [] });
    comprobar('demo1 carga una cantidad (200)', guardada.estado === 200, `${guardada.estado} ${guardada.json?.codigo ?? ''}`);
    const presentar = await rest('POST', `/planillas/${planilla.id}/presentar`, demo1, { version: guardada.json?.version ?? planilla.version });
    comprobar('demo1 la presenta (200)', presentar.estado === 200, `${presentar.estado} ${presentar.json?.codigo ?? ''}`);
    const presentadaEn = Date.now();
    const evento = await esperarSobre(planilla.id, 30000);
    comprobar('Obras publica PlanillaPresentada con reenvio = false', evento?.sobre.datos.reenvio === false, evento ? JSON.stringify(evento.sobre.datos) : 'no llegó en 30 s');
    const obra3 = (await rest('GET', `/obras/${OBRA3}`, demo1)).json;
    const asunto = `Planilla para revisar: N.º ${planilla.numero} · ${obra3.nombre} · ${periodoTexto(periodo)}`;
    const correo = await esperarCorreo((m) => m.Subject === asunto, 60000);
    comprobar(
      'correo «Planilla para revisar» a cliente1 en menos de 1 minuto',
      correo && direcciones(correo.To).join() === CLIENTE1,
      correo ? `${((new Date(correo.Created) - presentadaEn) / 1000).toFixed(0)} s · «${correo.Subject}» · para ${direcciones(correo.To)}` : `no llegó «${asunto}»`,
    );
    if (correo) {
      const texto = (await detalle(correo.ID)).Text.replace(/\s+/g, ' ');
      comprobar('cuerpo con el neto y el enlace al portal', texto.includes(`con un neto de ${bs(presentar.json?.neto)}.`) && texto.includes(`${PORTAL}/planillas/${planilla.id}`), texto.slice(0, 260));
    }
  } else {
    console.log('      La obra 3 ya tiene planillas (¿se corrió antes?): recarga los datos para probar el primer aviso.');
  }
} finally {
  await cerrarEscucha();
}

const fallas = resultados.filter((ok) => !ok).length;
console.log(`\n${resultados.length - fallas} de ${resultados.length} comprobaciones correctas · correos en http://localhost:8025`);
process.exit(fallas ? 1 : 0);
