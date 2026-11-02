// Prueba de punta a punta de la cobranza automática (201) contra lo que está corriendo:
//   1. el cliente aprueba la planilla N.º 3 de la obra 1 (datos de prueba) → en menos de 1 minuto le llega la nota de
//      cobro con el PDF (copia oculta a cobranzas) y Finanzas tiene el envío NOTA_COBRO;
//   2. el mismo CobroEmitido otra vez → ningún correo nuevo;
//   3. «Recordar cobros» → recordatorio del COB-AAAA-0001 vencido y resumen a cobranzas; otra vez → nada nuevo;
//   4. admin registra el pago del cobro nuevo → constancia y envío CONSTANCIA_PAGO;
//   5. el mismo CobroPagado otra vez → ninguna constancia nueva.
// Necesita: ./scripts/levantar.ps1 -Perfil automatizacion, los datos de prueba recién cargados (./semilla/recargar.ps1),
// Obras, Materiales, Finanzas (serve, mensajeria:consumir y mensajeria:publicar) y el gateway corriendo.
// Para ejecutar «Recordar cobros» sin esperar a las 08:00 entra al panel de n8n con la cuenta de propietario: pon su
// contraseña en N8N_PROPIETARIO_CLAVE (solo en la terminal, nunca en un archivo). Sin ella, el script pide ejecutarlo
// a mano desde el panel y espera.
// Uso: node pruebas/cobranza.mjs   (variables opcionales: GATEWAY_URL, OBRAS_URL, FINANZAS_URL, N8N_URL, MAILPIT_URL)
// Crea datos (aprueba la planilla y paga su cobro): úsala solo en desarrollo.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { obtenerTokenUsuario } from './token-usuario.mjs';

const env = Object.fromEntries(
  readFileSync(fileURLToPath(new URL('../.env', import.meta.url)), 'utf8')
    .split(/\r?\n/)
    .filter((linea) => linea && !linea.startsWith('#') && linea.includes('='))
    .map((linea) => [linea.slice(0, linea.indexOf('=')).trim(), linea.slice(linea.indexOf('=') + 1).trim()]),
);
const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:4000/graphql';
const OBRAS = process.env.OBRAS_URL ?? 'http://localhost:8081';
const FINANZAS = process.env.FINANZAS_URL ?? 'http://localhost:8083';
const N8N = process.env.N8N_URL ?? 'http://localhost:5678';
const MAILPIT = `${process.env.MAILPIT_URL ?? 'http://localhost:8025'}/api/v1`;
const RABBITMQ = 'http://localhost:15672/api';
const PORTAL = 'http://localhost:4300/';
const COBRANZAS = env.COBRANZA_CORREO || 'cobranzas@constructora-andina.test';
const CLIENTE1 = 'cliente1@correo.test';
const OBRA1 = 'b0000000-0000-4000-8000-000000000001';
const COBRO_VENCIDO = 'c2000000-0000-4000-8000-000000000101'; // COB-AAAA-0001 (datos de prueba, sección 8)
const RECORDAR = 'cob201Recordar00';

const resultados = [];
function comprobar(nombre, ok, detalle = '') {
  resultados.push(ok);
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre}${detalle ? ` · ${detalle}` : ''}`);
  return ok;
}
const esperar = (ms) => new Promise((listo) => setTimeout(listo, ms));
const hoyLaPaz = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(new Date());

async function rest(base, metodo, ruta, token, cuerpo) {
  const respuesta = await fetch(base + ruta, {
    method: metodo,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await respuesta.text();
  return { estado: respuesta.status, json: texto ? JSON.parse(texto) : null };
}
async function graphql(token, query, variables) {
  const respuesta = await fetch(GATEWAY, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  return respuesta.json();
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

// --- RabbitMQ: «volver a publicar» un aviso solo a la cola de n8n (exchange por defecto), no a Obras ni a IA ---
const autorizacionRabbit =
  'Basic ' + Buffer.from(`${env.RABBITMQ_ADMIN_USUARIO}:${env.RABBITMQ_ADMIN_CLAVE}`).toString('base64');
async function rabbit(ruta, opciones = {}) {
  const respuesta = await fetch(`${RABBITMQ}${ruta}`, {
    ...opciones,
    headers: { authorization: autorizacionRabbit, 'content-type': 'application/json' },
  });
  return respuesta.json();
}
async function republicar(cola, tipo, datos) {
  const sobre = {
    id: crypto.randomUUID(),
    tipo,
    version: 1,
    ocurridoEn: new Date().toISOString(),
    origen: 'finanzas',
    correlacionId: crypto.randomUUID(),
    datos,
  };
  const r = await rabbit('/exchanges/%2F/amq.default/publish', {
    method: 'POST',
    body: JSON.stringify({ properties: { delivery_mode: 2, content_type: 'application/json' }, routing_key: cola, payload: JSON.stringify(sobre), payload_encoding: 'string' }),
  });
  return r.routed;
}

// --- n8n: ejecutar «Recordar cobros» ya (como el botón del editor) con la cuenta de propietario ---
async function ejecutarRecordar() {
  if (!process.env.N8N_PROPIETARIO_CLAVE) {
    console.log(`      Sin N8N_PROPIETARIO_CLAVE: abre ${N8N}, flujo «Recordar cobros» → «Execute workflow». Espero 3 minutos…`);
    return 'manual';
  }
  const login = await fetch(`${N8N}/rest/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ emailOrLdapLoginId: env.N8N_PROPIETARIO_CORREO, password: process.env.N8N_PROPIETARIO_CLAVE }),
  });
  if (!login.ok) throw new Error(`inicio de sesión en n8n: ${login.status}`);
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  const encabezados = { cookie, 'browser-id': 'prueba-201', 'content-type': 'application/json' };
  const flujo = (await (await fetch(`${N8N}/rest/workflows/${RECORDAR}`, { headers: encabezados })).json()).data;
  const r = await fetch(`${N8N}/rest/workflows/${RECORDAR}/run`, {
    method: 'POST',
    headers: encabezados,
    body: JSON.stringify({ workflowData: flujo, triggerToStartFrom: { name: 'Ejecutar ahora' } }),
  });
  if (!r.ok) throw new Error(`ejecutar «Recordar cobros»: ${r.status}`);
  return (await r.json()).data?.executionId;
}

// 0. Piezas que responden
const piezas = [
  ['Mailpit', `${MAILPIT}/info`],
  ['n8n', `${N8N}/healthz/readiness`],
  ['Obras', `${OBRAS}/salud`],
  ['Finanzas', `${FINANZAS}/salud`],
];
for (const [nombre, url] of piezas) {
  const ok = await fetch(url).then((r) => r.ok, () => false);
  if (!comprobar(`${nombre} responde`, ok, url)) process.exit(1);
}
for (const cola of ['n8n.cobro-emitido', 'n8n.cobro-pagado']) {
  const datos = await rabbit(`/queues/%2F/${cola}`);
  comprobar(`n8n escucha la cola ${cola} (flujo activo)`, (datos.consumers ?? 0) > 0, `${datos.consumers ?? 0} consumidores`);
}

const admin = await obtenerTokenUsuario('admin1');
const cliente = await obtenerTokenUsuario('cliente1', 'Prueba123!', 'portal', PORTAL);

// 1. Aprobar la planilla N.º 3 de la obra 1 → nota de cobro
const planillas = await rest(OBRAS, 'GET', `/obras/${OBRA1}/planillas`, cliente);
const planilla3 = planillas.json?.find?.((p) => p.numero === 3);
if (!comprobar('planilla N.º 3 de la obra 1 PRESENTADA', planilla3?.estado === 'PRESENTADA', planilla3?.estado ?? String(planillas.estado))) {
  console.log('      Recarga los datos de prueba (./semilla/recargar.ps1) y vuelve a correr la prueba.');
  process.exit(1);
}
const aprobar = await rest(OBRAS, 'POST', `/planillas/${planilla3.id}/aprobar`, cliente);
comprobar('cliente1 aprueba (202)', aprobar.estado === 202, String(aprobar.estado));
let planilla;
const inicioSaga = Date.now();
do {
  await esperar(2000);
  planilla = (await rest(OBRAS, 'GET', `/planillas/${planilla3.id}`, cliente)).json;
} while (planilla?.estado === 'APROBANDO' && Date.now() - inicioSaga < 90000);
if (!comprobar('saga terminada con cobro', planilla?.estado === 'APROBADA' && planilla.cobroId, `${planilla?.estado} ${planilla?.cobroNumero ?? ''}`)) process.exit(1);
const cobroId = planilla.cobroId;
const numero = planilla.cobroNumero;
const emitidoEn = Date.now();

const nota = await esperarCorreo((m) => m.Subject.startsWith(`Nota de cobro ${numero} · `), 60000);
comprobar(
  'nota de cobro en menos de 1 minuto',
  Boolean(nota),
  nota ? `${((new Date(nota.Created) - emitidoEn) / 1000).toFixed(0)} s después de la aprobación · «${nota.Subject}»` : 'no llegó',
);
if (nota) {
  const d = await detalle(nota.ID);
  comprobar('nota: al cliente con copia oculta a cobranzas', direcciones(d.To).join() === CLIENTE1 && direcciones(d.Bcc).includes(COBRANZAS), `para ${direcciones(d.To)} · cco ${direcciones(d.Bcc)}`);
  comprobar('nota: asunto con obra y periodo', /^Nota de cobro .+ · Edificio Residencial Las Palmeras · \S+ \d{4}$/.test(d.Subject), d.Subject);
  const pdf = (d.Attachments ?? []).find((a) => a.ContentType === 'application/pdf');
  comprobar('nota: PDF adjunto', Boolean(pdf), pdf ? `${pdf.FileName} (${pdf.Size} bytes)` : JSON.stringify(d.Attachments));
  if (pdf) {
    const bytes = Buffer.from(await (await fetch(`${MAILPIT}/message/${nota.ID}/part/${pdf.PartID}`)).arrayBuffer());
    comprobar('nota: el adjunto es un PDF', bytes.subarray(0, 5).toString() === '%PDF-', `${bytes.length} bytes`);
  }
  comprobar('nota: cuerpo con el neto y el vencimiento', /Neto a cobrar: Bs [\d.]+,\d{2}\. Vence el \d{2}\/\d{2}\/\d{4}\./.test(d.Text), d.Text.replace(/\s+/g, ' ').slice(0, 160));
}
const envios = async (id) => (await rest(FINANZAS, 'GET', `/cobros/${id}`, admin)).json?.envios ?? [];
comprobar('envío NOTA_COBRO anotado en Finanzas', (await envios(cobroId)).some((e) => e.tipo === 'NOTA_COBRO' && e.destinatario === CLIENTE1));

// 2. El mismo aviso otra vez → sin segundo correo
const cobro = (await rest(FINANZAS, 'GET', `/cobros/${cobroId}`, admin)).json;
comprobar('CobroEmitido republicado a n8n', await republicar('n8n.cobro-emitido', 'CobroEmitido', { planillaId: planilla3.id, cobroId, numero, venceEn: cobro.venceEn }));
await esperar(20000);
comprobar('sin segunda nota de cobro', (await contar((m) => m.Subject.startsWith(`Nota de cobro ${numero} · `))) === 1);

// 3. Recordar cobros → recordatorio del vencido y resumen; otra vez → nada
const vencido = (await rest(FINANZAS, 'GET', `/cobros/${COBRO_VENCIDO}`, admin)).json;
const yaRecordado = (vencido?.envios ?? []).some((e) => e.tipo === 'RECORDATORIO_VENCIDO');
if (yaRecordado) console.log('      COB-AAAA-0001 ya tenía su recordatorio (¿se corrió antes?): recarga los datos para probar el envío');
const ejecucion = await ejecutarRecordar();
const espera = ejecucion === 'manual' ? 180000 : 60000;
const recordatorio = await esperarCorreo((m) => m.Subject === `Cobro vencido: ${vencido?.numero} · Edificio Residencial Las Palmeras`, yaRecordado ? 15000 : espera);
comprobar(
  yaRecordado ? 'COB-AAAA-0001 ya recordado: no se repite' : 'recordatorio «Cobro vencido» del COB-AAAA-0001 al cliente',
  yaRecordado ? !recordatorio : Boolean(recordatorio),
  recordatorio?.Subject ?? 'sin correo',
);
if (recordatorio) {
  const d = await detalle(recordatorio.ID);
  comprobar('recordatorio: texto del criterio 12', /venció el \d{2}\/\d{2}\/\d{4}\./.test(d.Text) && d.Text.includes('Si ya realizó el pago, no tome en cuenta este mensaje.'), d.Text.replace(/\s+/g, ' ').slice(0, 200));
}
const resumen = await esperarCorreo((m) => m.Subject.startsWith('Resumen de cobranza del ') && direcciones(m.To).includes(COBRANZAS), 15000);
if (!yaRecordado) comprobar('resumen del día a cobranzas', Boolean(resumen), resumen?.Subject ?? 'no llegó');
comprobar('envío RECORDATORIO_VENCIDO anotado', (await envios(COBRO_VENCIDO)).some((e) => e.tipo === 'RECORDATORIO_VENCIDO'));
const antes = (await correos()).length;
if ((await ejecutarRecordar()) !== 'manual') {
  await esperar(20000);
  comprobar('«Recordar cobros» otra vez: ningún correo nuevo', (await correos()).length === antes, `${(await correos()).length - antes} nuevos`);
} else {
  console.log('      (ejecútalo otra vez a mano y revisa que no llegue nada nuevo a Mailpit)');
}

// 4. Registrar el pago del cobro nuevo → constancia
const pago = await graphql(
  admin,
  `mutation($c: ID!, $f: String!, $n: String) { registrarPagoCobro(cobroId: $c, pagadoEn: $f, comprobante: $n) { estado pagadoEn comprobante } }`,
  { c: cobroId, f: hoyLaPaz(), n: 'PRUEBA-201' },
);
comprobar('admin1 registra el pago (PAGADO)', pago.data?.registrarPagoCobro?.estado === 'PAGADO', JSON.stringify(pago.data ?? pago.errors));
const constancia = await esperarCorreo((m) => m.Subject === `Constancia de pago ${numero} · Edificio Residencial Las Palmeras`, 60000);
comprobar('constancia de pago al cliente', Boolean(constancia), constancia?.Subject ?? 'no llegó');
if (constancia) {
  const d = await detalle(constancia.ID);
  comprobar('constancia: copia oculta a cobranzas y comprobante', direcciones(d.Bcc).includes(COBRANZAS) && d.Text.includes('comprobante PRUEBA-201'), d.Text.replace(/\s+/g, ' ').slice(0, 200));
}
comprobar('envío CONSTANCIA_PAGO anotado', (await envios(cobroId)).some((e) => e.tipo === 'CONSTANCIA_PAGO'));

// 5. El mismo aviso de pago otra vez → sin segunda constancia
const pagado = (await rest(FINANZAS, 'GET', `/cobros/${cobroId}`, admin)).json;
comprobar(
  'CobroPagado republicado a n8n',
  await republicar('n8n.cobro-pagado', 'CobroPagado', {
    cobroId, planillaId: planilla3.id, obraId: OBRA1, numero, montoNeto: pagado.montoNeto, pagadoEn: pagado.pagadoEn, comprobante: pagado.comprobante,
  }),
);
await esperar(20000);
comprobar('sin segunda constancia', (await contar((m) => m.Subject.startsWith(`Constancia de pago ${numero} `))) === 1);

const fallas = resultados.filter((ok) => !ok).length;
console.log(`\n${resultados.length - fallas} de ${resultados.length} comprobaciones correctas · cobro ${numero} · correos en http://localhost:8025`);
process.exit(fallas ? 1 : 0);
