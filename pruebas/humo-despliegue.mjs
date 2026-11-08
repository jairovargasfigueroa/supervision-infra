// 601 · Prueba de humo de un despliegue: la «producción local» o, en la 602, la nube. Node 24, sin dependencias.
// Recibe un archivo con las direcciones (y los secretos que necesita) y comprueba:
//   1. GET /salud de Obras, Materiales, Finanzas, IA, Sincronización y el gateway; la página inicial de cada frontend,
//      configuracion.json del shell y del portal, federation.manifest.json del shell y remoteEntry.json de cada
//      microfrontend con CORS para el origen del shell;
//   2. Keycloak: emisor, token de un usuario de prueba (ERP_URL como origen) y de los clientes de servicio (gateway,
//      ia-reportes, ia-agentes, n8n), con el emisor esperado;
//   3. gateway: { salud } sin token y una consulta con el token del gerente;
//   4. POST /mcp de Obras, Materiales, Finanzas e IA: 401 sin token;
//   5. RabbitMQ por TLS (AMQPS): saludo AMQP, colas de la plataforma y de n8n y servicios conectados por TLS;
//   6. n8n (listo y con sus flujos escuchando) y Mailpit;
//   7. con --completa: registra una obra, el residente presenta la planilla del mes, el cliente la aprueba (la saga
//      cruza dos grupos), espera el cobro y la nota de cobro en Mailpit (como pruebas/saga.mjs y cobranza.mjs); si el
//      correo sale por otro servidor (SMTP_HOST, 602: el Gmail de la plataforma), el envío NOTA_COBRO del cobro;
//   8. 602, en la nube (sin CA_LOCAL): los puertos internos de cada máquina no responden desde internet.
// Termina con un resumen y código 1 si algo falla.
// Uso: node pruebas/humo-despliegue.mjs --entorno produccion-local/.env [--completa] [--sin-google]
// --sin-google (602, mientras Google no está desplegado): omite Materiales e IA y lo dice en el resumen.
// Con --completa crea datos (una obra «Humo 601 …» con su planilla aprobada y su cobro): solo en un entorno de prueba.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import tls from 'node:tls';
import { resolverLocalhost, usarCa } from './red-local.mjs';

// --- Argumentos y entorno -------------------------------------------------------------------------------------------
const argumentos = process.argv.slice(2);
const indice = argumentos.indexOf('--entorno');
const archivo = indice >= 0 ? argumentos[indice + 1] : argumentos.find((a) => a.startsWith('--entorno='))?.slice(10);
const COMPLETA = argumentos.includes('--completa');
const SIN_GOOGLE = argumentos.includes('--sin-google');
if (COMPLETA && SIN_GOOGLE) {
  console.error('--completa necesita Google: la saga pasa por Materiales.');
  process.exit(2);
}
if (!archivo) {
  console.error('Uso: node pruebas/humo-despliegue.mjs --entorno <archivo .env> [--completa]');
  process.exit(2);
}
const rutaEnv = [resolve(archivo), resolve(dirname(fileURLToPath(import.meta.url)), '..', archivo)]
  .find((ruta) => existsSync(ruta));
if (!rutaEnv) {
  console.error(`No encuentro el archivo de entorno ${archivo}.`);
  process.exit(2);
}
const env = Object.fromEntries(
  readFileSync(rutaEnv, 'utf8')
    .split(/\r?\n/)
    .filter((linea) => /^\s*[A-Za-z_][A-Za-z0-9_]*\s*=/.test(linea))
    .map((linea) => {
      let valor = linea.slice(linea.indexOf('=') + 1).trim();
      if (/^'.*'$|^".*"$/.test(valor)) valor = valor.slice(1, -1);
      return [linea.slice(0, linea.indexOf('=')).trim(), valor];
    }),
);
// La CA local (si el entorno la trae) y los nombres *.localhost, antes de cualquier conexión
if (env.CA_LOCAL) usarCa(resolve(dirname(rutaEnv), env.CA_LOCAL));
resolverLocalhost();

const valor = (nombre) => process.env[nombre] || env[nombre] || '';
const sinBarra = (url) => url.replace(/\/+$/, '');
const KEYCLOAK = sinBarra(valor('KEYCLOAK_URL'));
const REALM = valor('KEYCLOAK_REALM') || 'supervision';
const EMISOR = `${KEYCLOAK}/realms/${REALM}`;
const GATEWAY = sinBarra(valor('GATEWAY_URL'));
const OBRAS = sinBarra(valor('OBRAS_URL'));
const FINANZAS = sinBarra(valor('FINANZAS_URL'));
const MATERIALES = sinBarra(valor('MATERIALES_URL'));
const IA = sinBarra(valor('IA_URL'));
const SINCRONIZACION = sinBarra(valor('SINCRONIZACION_URL'));
const ERP = sinBarra(valor('ERP_URL'));
const PORTAL = sinBarra(valor('PORTAL_URL'));
const N8N = sinBarra(valor('N8N_URL'));
const MAILPIT = sinBarra(valor('MAILPIT_URL'));
const RABBITMQ_PANEL = sinBarra(valor('RABBITMQ_PANEL_URL'));
const CLAVE = valor('USUARIOS_PRUEBA_CLAVE') || 'Prueba123!';
// 602: la interfaz de Mailpit va con autenticación básica en la nube; el correo puede salir por otro servidor
const AUTH_MAILPIT = valor('MAILPIT_USUARIO') && valor('MAILPIT_CLAVE')
  ? { authorization: 'Basic ' + Buffer.from(`${valor('MAILPIT_USUARIO')}:${valor('MAILPIT_CLAVE')}`).toString('base64') }
  : {};
const CORREO_EN_MAILPIT = !valor('SMTP_HOST') || valor('SMTP_HOST') === 'mailpit';
const omitidas = [];
/** Con --sin-google, las piezas de Google no se comprueban (se anotan para el resumen). */
const deGoogle = (nombre) => SIN_GOOGLE && ['Materiales', 'IA', 'materiales', 'ia'].includes(nombre);
process.env.KEYCLOAK_URL = KEYCLOAK; // token-usuario.mjs lo lee al importarse
const { obtenerTokensUsuario, leerToken } = await import('./token-usuario.mjs');

// --- Utilidades -----------------------------------------------------------------------------------------------------
const resultados = [];
function comprobar(nombre, ok, detalle = '') {
  resultados.push({ nombre, ok: Boolean(ok) });
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre}${detalle ? ` · ${detalle}` : ''}`);
  return Boolean(ok);
}
const seccion = (titulo) => console.log(`\n== ${titulo}`);
const esperar = (ms) => new Promise((listo) => setTimeout(listo, ms));
async function pedir(url, opciones = {}) {
  try {
    const respuesta = await fetch(url, { redirect: 'manual', ...opciones, signal: AbortSignal.timeout(15000) });
    const texto = await respuesta.text();
    let json = null;
    try { json = texto ? JSON.parse(texto) : null; } catch { /* no es JSON */ }
    return { estado: respuesta.status, encabezados: respuesta.headers, texto, json };
  } catch (error) {
    return { estado: 0, encabezados: new Headers(), texto: '', json: null, error: error.cause?.code ?? error.message };
  }
}
const resumen = (r) => (r.estado ? String(r.estado) : `sin respuesta (${r.error})`);
const bearer = (token) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
const graphql = (token, query, variables) =>
  pedir(`${GATEWAY}/graphql`, { method: 'POST', headers: token ? bearer(token) : { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) });
const rest = (base, metodo, ruta, token, cuerpo) =>
  pedir(base + ruta, { method: metodo, headers: bearer(token), body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
const faltan = ['KEYCLOAK_URL', 'GATEWAY_URL', 'OBRAS_URL', 'FINANZAS_URL', 'MATERIALES_URL', 'IA_URL', 'SINCRONIZACION_URL', 'ERP_URL', 'PORTAL_URL']
  .filter((nombre) => !valor(nombre));
if (faltan.length) {
  console.error(`Faltan en ${rutaEnv}: ${faltan.join(', ')}.`);
  process.exit(2);
}
console.log(`Entorno: ${rutaEnv}${COMPLETA ? ' (completa)' : ''}`);

// --- 1. Salud de los servicios y frontends --------------------------------------------------------------------------
seccion('1. Servicios y frontends');
for (const [nombre, base] of [['Obras', OBRAS], ['Materiales', MATERIALES], ['Finanzas', FINANZAS], ['IA', IA], ['Sincronización', SINCRONIZACION], ['Gateway', GATEWAY]]) {
  if (deGoogle(nombre)) { omitidas.push(`${nombre}: GET /salud`); continue; }
  const r = await pedir(`${base}/salud`);
  comprobar(`${nombre}: GET /salud`, r.estado === 200 && r.json?.estado === 'ok', `${base} → ${resumen(r)}`);
}
for (const [nombre, base] of [['ERP (shell)', ERP], ['Portal', PORTAL]]) {
  const r = await pedir(`${base}/`);
  comprobar(`${nombre}: página inicial`, r.estado === 200 && /<html/i.test(r.texto), `${base} → ${resumen(r)}`);
}
const configShell = await pedir(`${ERP}/configuracion.json`);
comprobar('ERP: configuracion.json con las direcciones del entorno',
  configShell.json?.keycloakUrl === KEYCLOAK && configShell.json?.gatewayUrl === `${GATEWAY}/graphql` && configShell.json?.portalUrl === PORTAL,
  configShell.json ? JSON.stringify(configShell.json) : resumen(configShell));
const manifiesto = await pedir(`${ERP}/federation.manifest.json`);
comprobar('ERP: federation.manifest.json con los tres microfrontends',
  manifiesto.json && ['mf-obras', 'mf-materiales', 'mf-supervision'].every((mf) => String(manifiesto.json[mf] ?? '').endsWith('/remoteEntry.json')),
  manifiesto.json ? JSON.stringify(manifiesto.json) : resumen(manifiesto));
// 104: el service worker guarda los remotos solo si su grupo «remotos» tiene los orígenes publicados
const ngsw = await pedir(`${ERP}/ngsw.json`);
const patronesRemotos = ngsw.json?.assetGroups?.find((grupo) => grupo.name === 'remotos')?.patterns ?? [];
comprobar('ERP: ngsw.json guarda los microfrontends publicados (sin localhost)',
  Object.values(manifiesto.json ?? {}).length === 3 &&
    Object.values(manifiesto.json).every((url) => patronesRemotos.some((patron) => new RegExp(`^${patron}$`).test(String(url)))),
  ngsw.json ? JSON.stringify(patronesRemotos) : resumen(ngsw));
const configPortal = await pedir(`${PORTAL}/configuracion.json`);
comprobar('Portal: configuracion.json con las direcciones del entorno',
  configPortal.json?.keycloakUrl === KEYCLOAK && sinBarra(configPortal.json?.obrasUrl ?? '') === OBRAS && sinBarra(configPortal.json?.erpUrl ?? '') === ERP,
  configPortal.json ? JSON.stringify(configPortal.json) : resumen(configPortal));
for (const [mf, url] of Object.entries(manifiesto.json ?? {})) {
  const r = await pedir(url, { headers: { origin: ERP } });
  const cors = r.encabezados.get('access-control-allow-origin');
  comprobar(`${mf}: remoteEntry.json con CORS para el shell`, r.estado === 200 && (cors === ERP || cors === '*'), `${resumen(r)} · CORS ${cors ?? '(ninguno)'}`);
}

// --- 2. Keycloak ----------------------------------------------------------------------------------------------------
seccion('2. Keycloak');
const descubrimiento = await pedir(`${EMISOR}/.well-known/openid-configuration`);
comprobar('emisor publicado', descubrimiento.json?.issuer === EMISOR, descubrimiento.json?.issuer ?? resumen(descubrimiento));
const preflight = await pedir(`${EMISOR}/protocol/openid-connect/token`, {
  method: 'OPTIONS', headers: { origin: ERP, 'access-control-request-method': 'POST' },
});
comprobar('el ERP es un origen permitido (CORS del token)', preflight.encabezados.get('access-control-allow-origin') === ERP,
  preflight.encabezados.get('access-control-allow-origin') ?? resumen(preflight));
const tokens = {};
async function tokenUsuario(usuario, clientId, redirectUri) {
  try {
    return (await obtenerTokensUsuario(usuario, { clave: CLAVE, clientId, redirectUri })).access_token;
  } catch (error) {
    return { error: error.message };
  }
}
for (const [usuario, clientId, redirect] of [['gerente1', 'erp', `${ERP}/`], ['admin1', 'erp', `${ERP}/`], ['residente1', 'erp', `${ERP}/`], ['cliente1', 'portal', `${PORTAL}/`]]) {
  const token = await tokenUsuario(usuario, clientId, redirect);
  const datos = typeof token === 'string' ? leerToken(token) : null;
  tokens[usuario] = typeof token === 'string' ? token : null;
  if (usuario === 'gerente1' || usuario === 'cliente1') {
    comprobar(`token de ${usuario} (${clientId}, regreso a ${redirect})`,
      datos?.iss === EMISOR && datos?.azp === clientId && [].concat(datos?.aud).includes('plataforma-api'),
      datos ? `iss ${datos.iss} · roles ${datos.realm_access?.roles?.filter((r) => !r.startsWith('default')).join(',')}` : token.error);
  }
}
const secretos = {
  gateway: 'KEYCLOAK_GATEWAY_CLIENT_SECRET', 'ia-reportes': 'IA_REPORTES_CLIENT_SECRET', 'ia-agentes': 'IA_AGENTES_CLIENT_SECRET', n8n: 'N8N_KEYCLOAK_SECRETO',
};
for (const [cliente, variable] of Object.entries(secretos)) {
  if (!valor(variable)) { comprobar(`token del cliente ${cliente}`, false, `falta ${variable} en el entorno`); continue; }
  const r = await pedir(`${EMISOR}/protocol/openid-connect/token`, {
    method: 'POST', body: new URLSearchParams({ grant_type: 'client_credentials', client_id: cliente, client_secret: valor(variable) }),
  });
  const datos = r.json?.access_token ? leerToken(r.json.access_token) : null;
  comprobar(`token del cliente ${cliente}`, datos?.iss === EMISOR && datos?.azp === cliente, datos ? `iss ${datos.iss}` : resumen(r));
}

// --- 3. Gateway -----------------------------------------------------------------------------------------------------
seccion('3. Gateway');
const salud = await graphql(null, '{ salud }');
comprobar('{ salud } sin token', salud.estado === 200 && typeof salud.json?.data?.salud === 'string', resumen(salud));
if (tokens.gerente1) {
  if (SIN_GOOGLE) omitidas.push('materiales en la consulta del gerente');
  const r = await graphql(tokens.gerente1, SIN_GOOGLE ? '{ obras { id nombre estado } }' : '{ obras { id nombre estado } materiales(tamano: 1) { total } }');
  comprobar('consulta del gerente (obras de Obras y materiales de Materiales)',
    r.estado === 200 && Array.isArray(r.json?.data?.obras) && !r.json?.errors,
    r.json?.errors ? JSON.stringify(r.json.errors[0]) : `${r.json?.data?.obras?.length ?? '?'} obras · ${r.json?.data?.materiales?.total ?? '?'} materiales`);
} else {
  comprobar('consulta del gerente', false, 'sin token del gerente');
}

// --- 4. MCP sin token -----------------------------------------------------------------------------------------------
seccion('4. /mcp sin token');
const inicializar = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'humo-601', version: '1' } } });
for (const [nombre, base] of [['Obras', OBRAS], ['Materiales', MATERIALES], ['Finanzas', FINANZAS], ['IA', IA]]) {
  if (deGoogle(nombre)) { omitidas.push(`${nombre}: POST /mcp`); continue; }
  const r = await pedir(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: inicializar });
  comprobar(`${nombre}: POST /mcp sin token → 401`, r.estado === 401, resumen(r));
}

// --- 5. RabbitMQ ----------------------------------------------------------------------------------------------------
seccion('5. RabbitMQ');
const host = valor('RABBITMQ_HOST');
const puerto = Number(valor('RABBITMQ_PUERTO_TLS') || 5671);
const saludo = await new Promise((listo) => {
  const socket = tls.connect({ host, port: puerto, servername: host }, () => socket.write(Buffer.from('AMQP\x00\x00\x09\x01', 'latin1')));
  socket.setTimeout(10000, () => { socket.destroy(); listo({ error: 'tiempo agotado' }); });
  socket.once('data', (datos) => {
    // Trama de método (1) Connection.Start (clase 10, método 10)
    listo({ ok: datos[0] === 1 && datos.readUInt16BE(7) === 10 && datos.readUInt16BE(9) === 10, protocolo: socket.getProtocol() });
    socket.end();
  });
  socket.once('error', (error) => listo({ error: error.code ?? error.message }));
});
comprobar(`AMQPS en ${host}:${puerto} (certificado verificado y saludo AMQP)`, saludo.ok, saludo.error ?? saludo.protocolo);
const autorizacion = 'Basic ' + Buffer.from(`${valor('RABBITMQ_ADMIN_USUARIO')}:${valor('RABBITMQ_ADMIN_CLAVE')}`).toString('base64');
const colas = await pedir(`${RABBITMQ_PANEL}/api/queues/%2F?columns=name,consumers,messages`, { headers: { authorization: autorizacion } });
const porNombre = Object.fromEntries((Array.isArray(colas.json) ? colas.json : []).map((c) => [c.name, c]));
const esperadas = ['obras', 'materiales', 'finanzas', 'ia', 'plataforma.fallidos', 'n8n.cobro-emitido', 'n8n.cobro-pagado', 'n8n.stock-bajo', 'n8n.planilla-presentada'];
comprobar('colas de la plataforma y de n8n', esperadas.every((c) => porNombre[c]),
  Array.isArray(colas.json) ? `faltan: ${esperadas.filter((c) => !porNombre[c]).join(', ') || 'ninguna'}` : resumen(colas));
for (const cola of ['obras', 'materiales', 'finanzas', 'ia']) {
  if (deGoogle(cola)) { omitidas.push(`consumidor de la cola ${cola}`); continue; }
  comprobar(`la cola ${cola} tiene consumidor`, (porNombre[cola]?.consumers ?? 0) > 0, `${porNombre[cola]?.consumers ?? 0} consumidores`);
}
const conexiones = await pedir(`${RABBITMQ_PANEL}/api/connections?columns=user,ssl`, { headers: { authorization: autorizacion } });
const lista = Array.isArray(conexiones.json) ? conexiones.json : [];
for (const usuario of ['obras', 'materiales', 'finanzas', 'ia']) {
  if (deGoogle(usuario)) { omitidas.push(`${usuario} conectado por TLS`); continue; }
  const suyas = lista.filter((c) => c.user === usuario);
  comprobar(`${usuario} conectado por TLS`, suyas.length > 0 && suyas.every((c) => c.ssl), `${suyas.length} conexiones · ssl ${suyas.map((c) => c.ssl).join(',') || '-'}`);
}

// --- 6. n8n y Mailpit -----------------------------------------------------------------------------------------------
seccion('6. n8n y Mailpit');
if (N8N) {
  const listo = await pedir(`${N8N}/healthz/readiness`);
  comprobar('n8n listo', listo.estado === 200, resumen(listo));
  // Un flujo publicado escucha su cola: los de la cobranza (201) y el de la planilla (010)
  for (const cola of ['n8n.cobro-emitido', 'n8n.cobro-pagado', 'n8n.planilla-presentada']) {
    comprobar(`flujo de ${cola} publicado (escucha su cola)`, (porNombre[cola]?.consumers ?? 0) > 0, `${porNombre[cola]?.consumers ?? 0} consumidores`);
  }
} else {
  comprobar('n8n', false, 'falta N8N_URL en el entorno');
}
const mailpit = await pedir(`${MAILPIT}/api/v1/info`, { headers: AUTH_MAILPIT });
comprobar('Mailpit responde', mailpit.estado === 200, `${MAILPIT} → ${resumen(mailpit)}`);

// --- 7. Aprobación de planilla de punta a punta ---------------------------------------------------------------------
if (COMPLETA) {
  seccion('7. Aprobar una planilla de punta a punta (--completa)');
  await completa();
}

// --- 8. Puertos internos cerrados (602, solo en la nube) --------------------------------------------------------------
if (!valor('CA_LOCAL')) {
  seccion('8. Puertos internos cerrados desde internet');
  const maquinas = [['Azure', new URL(KEYCLOAK).hostname], ['AWS', new URL(SINCRONIZACION).hostname]];
  if (!SIN_GOOGLE) maquinas.push(['Google', new URL(IA).hostname]);
  const internos = [5432, 5672, 15672, 5678, 1025, 8025, 8080, 8081, 8082, 8083, 8084, 8085, 4000, 27017, 11434];
  for (const [nube, nombre] of maquinas) {
    const abiertos = [];
    for (const puerto of internos) if (await puertoAbierto(nombre, puerto)) abiertos.push(puerto);
    comprobar(`${nube}: ningún puerto interno responde (${internos.length} probados)`, abiertos.length === 0, abiertos.length ? `abiertos: ${abiertos.join(', ')}` : nombre);
  }
}

const fallas = resultados.filter((r) => !r.ok);
if (omitidas.length) console.log(`\nOmitidas por --sin-google (${omitidas.length}): ${omitidas.join(' | ')}`);
console.log(`\n${resultados.length - fallas.length} de ${resultados.length} comprobaciones correctas${fallas.length ? `; fallaron: ${fallas.map((f) => f.nombre).join(' | ')}` : ''}`);
process.exit(fallas.length ? 1 : 0);

async function completa() {
  const { admin1: admin, residente1: residente, cliente1: cliente } = tokens;
  if (!comprobar('tokens de admin1, residente1 y cliente1', admin && residente && cliente)) return;
  const inicio = new Date();
  const periodo = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
  const registro = await graphql(admin, 'mutation($e: RegistrarObraEntrada!) { registrarObra(entrada: $e) { id } }', {
    e: {
      nombre: `Humo 601 ${new Date().toISOString().slice(0, 19)}`,
      ubicacion: 'Av. Banzer 4to anillo, Santa Cruz',
      fechaInicio: `${periodo}-01`,
      asignaciones: {
        residenteId: 'a0000000-0000-4000-8000-000000000003',
        maestroId: 'a0000000-0000-4000-8000-000000000005',
        almaceneroId: 'a0000000-0000-4000-8000-000000000006',
        clienteId: 'a0000000-0000-4000-8000-000000000007',
      },
      contrato: { monto: 100000, plazoDias: 120, anticipoPct: 10, retencionPct: 7, firmadoEn: `${periodo}-01` },
      partidas: [
        { codigo: 'P-01', nombre: 'Excavación', unidad: 'm3', cantidadContratada: 200, precioUnitario: 150 },
        { codigo: 'P-02', nombre: 'Losa', unidad: 'm2', cantidadContratada: 100, precioUnitario: 700 },
      ],
    },
  });
  const obraId = registro.json?.data?.registrarObra?.id;
  if (!comprobar('obra registrada (gateway → Obras)', obraId, obraId ?? JSON.stringify(registro.json?.errors ?? resumen(registro)))) return;
  let obra;
  for (let i = 0; i < 45 && obra?.estado !== 'EN_EJECUCION'; i++) {
    await esperar(1000);
    obra = (await graphql(admin, 'query($id: ID!) { obra(id: $id) { estado partidas { id } } }', { id: obraId })).json?.data?.obra;
  }
  if (!comprobar('contrato en Finanzas (obra EN_EJECUCION)', obra?.estado === 'EN_EJECUCION', obra?.estado)) return;
  const creada = await graphql(residente, 'mutation($o: ID!, $p: String!) { crearPlanilla(obraId: $o, periodo: $p) { id } }', { o: obraId, p: periodo });
  const planillaId = creada.json?.data?.crearPlanilla?.id;
  if (!comprobar('planilla creada', planillaId, planillaId ?? JSON.stringify(creada.json?.errors))) return;
  const [p1, p2] = obra.partidas;
  const guardada = await graphql(residente, 'mutation($id: ID!, $e: GuardarPlanillaEntrada!) { guardarPlanilla(id: $id, entrada: $e) { neto } }', {
    id: planillaId, e: { version: 0, lineas: [{ partidaId: p1.id, cantidadPeriodo: 80 }, { partidaId: p2.id, cantidadPeriodo: 10 }], fotoIds: [] },
  });
  comprobar('planilla guardada (neto 15 770)', guardada.json?.data?.guardarPlanilla?.neto === 15770, String(guardada.json?.data?.guardarPlanilla?.neto));
  const presentada = await graphql(residente, 'mutation($id: ID!) { presentarPlanilla(id: $id, version: 1) { estado } }', { id: planillaId });
  if (!comprobar('planilla presentada', presentada.json?.data?.presentarPlanilla?.estado === 'PRESENTADA', JSON.stringify(presentada.json?.errors ?? ''))) return;
  const aprobar = await rest(OBRAS, 'POST', `/planillas/${planillaId}/aprobar`, cliente);
  if (!comprobar('cliente1 aprueba desde el portal (202)', aprobar.estado === 202, resumen(aprobar))) return;
  const desde = Date.now();
  let planilla;
  do {
    await esperar(2000);
    planilla = (await rest(OBRAS, 'GET', `/planillas/${planillaId}`, cliente)).json;
  } while (planilla?.estado === 'APROBANDO' && Date.now() - desde < 120000);
  if (!comprobar('saga terminada: APROBADA con cobro (Obras → Finanzas → Materiales)', planilla?.estado === 'APROBADA' && /^COB-\d{4}-\d{4}$/.test(planilla?.cobroNumero ?? ''),
    `${planilla?.estado} ${planilla?.cobroNumero ?? ''} ${planilla?.observacion ?? ''} (${((Date.now() - desde) / 1000).toFixed(0)} s)`)) return;
  if (!CORREO_EN_MAILPIT) {
    // 602: el correo sale por otro servidor (el Gmail de la plataforma): se comprueba el envío que n8n registra en
    // Finanzas (la columna «Correos» de la pestaña Cobros del ERP)
    let envio;
    const hasta = Date.now() + 90000;
    while (!envio && Date.now() < hasta) {
      const cobros = (await graphql(admin, 'query($id: ID!) { obra(id: $id) { cobros { numero envios { tipo destinatario enviadoEn } } } }', { id: obraId })).json?.data?.obra?.cobros ?? [];
      envio = cobros.find((c) => c.numero === planilla.cobroNumero)?.envios?.find((e) => e.tipo === 'NOTA_COBRO');
      if (!envio) await esperar(3000);
    }
    comprobar(`nota de cobro enviada por ${valor('SMTP_HOST')} (envío registrado en Finanzas)`, envio, envio ? `a ${envio.destinatario} el ${envio.enviadoEn}` : 'sin envío en 90 s');
    console.log(`      obra de prueba ${obraId}`);
    return;
  }
  const asunto = `Nota de cobro ${planilla.cobroNumero} · `;
  let nota;
  const limite = Date.now() + 90000;
  while (!nota && Date.now() < limite) {
    const lista = (await pedir(`${MAILPIT}/api/v1/messages?limit=100`, { headers: AUTH_MAILPIT })).json?.messages ?? [];
    nota = lista.find((m) => new Date(m.Created) >= inicio && m.Subject.startsWith(asunto));
    if (!nota) await esperar(3000);
  }
  comprobar('nota de cobro en Mailpit (n8n)', nota, nota ? `«${nota.Subject}» a ${(nota.To ?? []).map((d) => d.Address).join(',')}` : 'no llegó en 90 s');
  console.log(`      obra de prueba ${obraId}`);
}

/** ¿Acepta conexiones TCP el puerto? (3 s; sin respuesta o rechazo = cerrado) */
function puertoAbierto(host, puerto) {
  return new Promise((listo) => {
    const socket = net.connect({ host, port: puerto });
    const terminar = (abierto) => { socket.destroy(); listo(abierto); };
    socket.setTimeout(3000, () => terminar(false));
    socket.once('connect', () => terminar(true));
    socket.once('error', () => terminar(false));
  });
}
