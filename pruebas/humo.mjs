// Pruebas de humo del entorno levantado (./scripts/levantar.*). Uso: node pruebas/humo.mjs
// Lee las credenciales de .env. Sale con código 1 si alguna comprobación falla.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { leerToken, obtenerTokensUsuario, obtenerTokenUsuario } from './token-usuario.mjs';

const env = Object.fromEntries(
  readFileSync(fileURLToPath(new URL('../.env', import.meta.url)), 'utf8')
    .split(/\r?\n/)
    .filter((linea) => linea && !linea.startsWith('#') && linea.includes('='))
    .map((linea) => [linea.slice(0, linea.indexOf('=')), linea.slice(linea.indexOf('=') + 1)]),
);

const RABBITMQ = 'http://localhost:15672/api';
const KEYCLOAK = 'http://localhost:8080';
const DYNAMODB = 'http://localhost:8000';
const SERVICIOS_RABBITMQ = ['obras', 'materiales', 'finanzas', 'ia', 'notificaciones'];

const autorizacionRabbit =
  'Basic ' + Buffer.from(`${env.RABBITMQ_ADMIN_USUARIO}:${env.RABBITMQ_ADMIN_CLAVE}`).toString('base64');

async function rabbit(ruta) {
  const respuesta = await fetch(`${RABBITMQ}${ruta}`, { headers: { authorization: autorizacionRabbit } });
  if (!respuesta.ok) throw new Error(`RabbitMQ ${ruta} respondió ${respuesta.status}`);
  return respuesta.json();
}

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });
function afirmar(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje);
}

// --- RabbitMQ (1.2) ---
prueba('RabbitMQ: el panel responde con el administrador de .env', async () => {
  const resumen = await rabbit('/overview');
  afirmar(resumen.rabbitmq_version?.startsWith('4.4'), `versión inesperada: ${resumen.rabbitmq_version}`);
});

prueba('RabbitMQ: hay un usuario por servicio con permisos en el vhost "/"', async () => {
  for (const usuario of SERVICIOS_RABBITMQ) {
    const permisos = await rabbit(`/users/${usuario}/permissions`);
    afirmar(permisos.some((p) => p.vhost === '/' && p.write === '.*'), `${usuario} no tiene permisos en "/"`);
  }
});

// --- RabbitMQ: exchange, colas y enlaces (1.5) ---
// pruebas/enlaces.json es la lista esperada por cola (docs/contratos/eventos.md, 401 y 010).
const ENLACES = JSON.parse(readFileSync(fileURLToPath(new URL('./enlaces.json', import.meta.url)), 'utf8'));

prueba('RabbitMQ: exchange plataforma (topic, durable) y colas durables', async () => {
  const exchange = await rabbit('/exchanges/%2F/plataforma');
  afirmar(exchange.type === 'topic' && exchange.durable, 'exchange plataforma mal declarado');
  for (const cola of [...Object.keys(ENLACES), 'plataforma.fallidos']) {
    const datos = await rabbit(`/queues/%2F/${encodeURIComponent(cola)}`);
    afirmar(datos.durable, `la cola ${cola} no es durable`);
  }
});

prueba('RabbitMQ: cada cola tiene exactamente sus enlaces', async () => {
  for (const [cola, esperados] of Object.entries(ENLACES)) {
    const enlaces = (await rabbit(`/bindings/%2F/e/plataforma/q/${cola}`)).map((e) => e.routing_key).sort();
    afirmar(
      JSON.stringify(enlaces) === JSON.stringify([...esperados].sort()),
      `${cola}: tiene [${enlaces}] y se esperaba [${[...esperados].sort()}]`,
    );
  }
});

prueba('RabbitMQ: un ObraRegistrada publicado llega a finanzas, materiales, ia y notificaciones', async () => {
  const respuesta = await fetch(`${RABBITMQ}/exchanges/%2F/plataforma/publish`, {
    method: 'POST',
    headers: { authorization: autorizacionRabbit, 'content-type': 'application/json' },
    body: JSON.stringify({
      properties: {},
      routing_key: 'evento.obras.ObraRegistrada',
      payload: '{"prueba":"humo"}',
      payload_encoding: 'string',
    }),
  });
  const { routed } = await respuesta.json();
  afirmar(routed, 'el mensaje no llegó a ninguna cola');
  // Saca el mensaje de prueba de cada cola para no dejar basura
  const destinos = Object.entries(ENLACES)
    .filter(([, claves]) => claves.includes('evento.obras.ObraRegistrada'))
    .map(([cola]) => cola);
  afirmar(destinos.sort().join() === 'finanzas,ia,materiales,notificaciones', `destinos: ${destinos}`);
  for (const cola of destinos) {
    const sacar = await fetch(`${RABBITMQ}/queues/%2F/${cola}/get`, {
      method: 'POST',
      headers: { authorization: autorizacionRabbit, 'content-type': 'application/json' },
      body: JSON.stringify({ count: 10, ackmode: 'ack_requeue_false', encoding: 'auto' }),
    });
    const mensajes = await sacar.json();
    afirmar(mensajes.some((m) => m.payload === '{"prueba":"humo"}'), `no llegó a la cola ${cola}`);
  }
});

// --- Keycloak (1.2) ---
prueba('Keycloak: responde el realm master', async () => {
  const respuesta = await fetch(`${KEYCLOAK}/realms/master/.well-known/openid-configuration`);
  afirmar(respuesta.ok, `descubrimiento de master: ${respuesta.status}`);
});

// --- Realm supervision (1.4) ---
// docs/datos-prueba.md, sección 3 (011): el id es el sub del token. Orden = sufijo del id.
const USUARIOS = {
  admin1: ['admin', 'Carla', 'Méndez Rivero', 'admin1@constructora-andina.test'],
  gerente1: ['gerente', 'Jorge', 'Antelo Suárez', 'gerente1@constructora-andina.test'],
  residente1: ['residente', 'Daniela', 'Roca Justiniano', 'residente1@constructora-andina.test'],
  residente2: ['residente', 'Marcelo', 'Vaca Saucedo', 'residente2@constructora-andina.test'],
  maestro1: ['maestro', 'Freddy', 'Choque Mamani', 'maestro1@constructora-andina.test'],
  almacenero1: ['almacenero', 'Rosa', 'Flores Arteaga', 'almacenero1@constructora-andina.test'],
  cliente1: ['cliente', 'Roberto', 'Justiniano Paz', 'cliente1@correo.test'],
  cliente2: ['cliente', 'Patricia', 'Saucedo Ribera', 'cliente2@correo.test'],
  demo1: ['residente,cliente', 'Lucía', 'Paz Antelo', 'demo1@constructora-andina.test'],
};
const idUsuario = (indice) => `a0000000-0000-4000-8000-0000000000${String(indice + 1).padStart(2, '0')}`;
const ROLES = ['admin', 'residente', 'gerente', 'maestro', 'almacenero', 'cliente'];

let tokenAdmin;
async function adminKeycloak(ruta) {
  if (!tokenAdmin) {
    const respuesta = await fetch(`${KEYCLOAK}/realms/master/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username: env.KEYCLOAK_ADMIN_USUARIO,
        password: env.KEYCLOAK_ADMIN_CLAVE,
      }),
    });
    afirmar(respuesta.ok, `token de administrador: ${respuesta.status}`);
    tokenAdmin = (await respuesta.json()).access_token;
  }
  const respuesta = await fetch(`${KEYCLOAK}/admin/realms/supervision${ruta}`, {
    headers: { authorization: `Bearer ${tokenAdmin}` },
  });
  afirmar(respuesta.ok, `admin ${ruta}: ${respuesta.status}`);
  return respuesta.json();
}

prueba('Realm: español, tema supervision, política de contraseñas y fuerza bruta', async () => {
  const realm = await adminKeycloak('');
  afirmar(realm.defaultLocale === 'es' && realm.supportedLocales.join() === 'es', 'idioma distinto de solo es');
  afirmar(realm.loginTheme === 'supervision', `tema: ${realm.loginTheme}`);
  for (const regla of ['length(8)', 'upperCase(1)', 'digits(1)', 'notUsername']) {
    afirmar(realm.passwordPolicy.includes(regla), `falta ${regla} en la política`);
  }
  afirmar(realm.bruteForceProtected && !realm.permanentLockout && realm.failureFactor === 5, 'fuerza bruta mal');
  afirmar(realm.accessTokenLifespan === 300 && realm.ssoSessionMaxLifespan === 36000, 'duración de token o sesión');
});

prueba('Realm: existen los seis roles', async () => {
  const roles = (await adminKeycloak('/roles')).map((r) => r.name);
  for (const rol of ROLES) afirmar(roles.includes(rol), `falta el rol ${rol}`);
});

prueba('Realm: clientes públicos erp, portal y app-obra con PKCE S256 y sin direct access grants', async () => {
  for (const clientId of ['erp', 'portal', 'app-obra']) {
    const [cliente] = await adminKeycloak(`/clients?clientId=${clientId}`);
    afirmar(cliente?.publicClient, `${clientId} no es público`);
    afirmar(cliente.standardFlowEnabled && !cliente.directAccessGrantsEnabled, `${clientId}: flujos`);
    afirmar(cliente.attributes['pkce.code.challenge.method'] === 'S256', `${clientId}: PKCE`);
  }
});

prueba('Realm: los 9 usuarios de prueba con su id fijo, nombre, apellido, correo y roles', async () => {
  for (const [indice, [usuario, [roles, nombre, apellido, correo]]] of Object.entries(USUARIOS).entries()) {
    const id = idUsuario(indice);
    const datos = await adminKeycloak(`/users/${id}`);
    afirmar(datos.username === usuario, `${id} es ${datos.username}, se esperaba ${usuario}`);
    afirmar(datos.firstName === nombre && datos.lastName === apellido, `${usuario}: ${datos.firstName} ${datos.lastName}`);
    afirmar(datos.email === correo && datos.emailVerified, `${usuario}: correo ${datos.email}`);
    const asignados = (await adminKeycloak(`/users/${id}/role-mappings/realm`)).map((r) => r.name);
    for (const rol of ROLES) {
      afirmar(asignados.includes(rol) === roles.split(',').includes(rol), `${usuario}: rol ${rol}`);
    }
  }
});

prueba('Realm: el sub del token de cada usuario de prueba es su id fijo', async () => {
  for (const [indice, usuario] of Object.keys(USUARIOS).entries()) {
    const { sub } = leerToken(await obtenerTokenUsuario(usuario));
    afirmar(sub === idUsuario(indice), `${usuario}: sub ${sub}, se esperaba ${idUsuario(indice)}`);
  }
});

prueba('Realm: el cliente gateway obtiene token con audiencia plataforma-api y lista usuarios por rol', async () => {
  const respuesta = await fetch(`${KEYCLOAK}/realms/supervision/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: 'gateway',
      client_secret: 'gateway-secreto-solo-desarrollo',
    }),
  });
  afirmar(respuesta.ok, `client_credentials: ${respuesta.status}`);
  const { access_token } = await respuesta.json();
  const datos = leerToken(access_token);
  afirmar([datos.aud].flat().includes('plataforma-api') && datos.azp === 'gateway', 'audiencia o azp del gateway');
  afirmar(datos.resource_access?.['realm-management']?.roles.includes('view-users'), 'sin view-users');
  const usuario = await fetch(`${KEYCLOAK}/admin/realms/supervision/users/a0000000-0000-4000-8000-000000000003`, {
    headers: { authorization: `Bearer ${access_token}` },
  });
  afirmar(usuario.ok, `leer residente1 con el token del gateway: ${usuario.status}`);
  // Lo que usa la 002 para los formularios de asignación
  const residentes = await fetch(`${KEYCLOAK}/admin/realms/supervision/roles/residente/users`, {
    headers: { authorization: `Bearer ${access_token}` },
  });
  afirmar(residentes.ok, `listar residentes con el token del gateway: ${residentes.status}`);
  const nombres = (await residentes.json()).map((u) => u.username).sort();
  afirmar(nombres.join() === 'demo1,residente1,residente2', `residentes: ${nombres}`);
});

prueba('Realm: demo1 inicia sesión en el ERP con PKCE y el token trae sub, audiencia, azp y roles', async () => {
  const datos = leerToken(await obtenerTokenUsuario('demo1'));
  afirmar(datos.sub === 'a0000000-0000-4000-8000-000000000009', `sub: ${datos.sub}`);
  afirmar([datos.aud].flat().includes('plataforma-api'), 'sin audiencia plataforma-api');
  afirmar(datos.azp === 'erp', `azp: ${datos.azp}`);
  afirmar(['residente', 'cliente'].every((r) => datos.realm_access.roles.includes(r)), 'roles de demo1');
  afirmar(datos.name === 'Lucía Paz Antelo', `name: ${datos.name}`);
});

prueba('Realm: la pantalla de inicio de sesión está en español y con el tema supervision', async () => {
  const url = new URL(`${KEYCLOAK}/realms/supervision/protocol/openid-connect/auth`);
  url.search = new URLSearchParams({
    client_id: 'portal',
    response_type: 'code',
    scope: 'openid',
    redirect_uri: 'http://localhost:4300/',
    code_challenge: 'a'.repeat(43),
    code_challenge_method: 'S256',
  }).toString();
  const html = await (await fetch(url, { redirect: 'manual' })).text();
  afirmar(/<html[^>]*lang="es"/.test(html), 'la página no está en español');
  const estilos = html.match(/href="([^"]*\/login\/supervision\/css\/supervision\.css)"/)?.[1];
  afirmar(estilos, 'no usa el tema supervision');
  const logo = await fetch(`${KEYCLOAK}${estilos.replace('css/supervision.css', 'img/logo.svg')}`);
  afirmar(logo.ok, `logo: ${logo.status}`);
});

prueba('Realm: sesión offline de 30 días y scope offline_access en app-obra (101)', async () => {
  const realm = await adminKeycloak('');
  afirmar(realm.offlineSessionIdleTimeout === 2592000, `offlineSessionIdleTimeout: ${realm.offlineSessionIdleTimeout}`);
  const [cliente] = await adminKeycloak('/clients?clientId=app-obra');
  const opcionales = (await adminKeycloak(`/clients/${cliente.id}/optional-client-scopes`)).map((s) => s.name);
  afirmar(opcionales.includes('offline_access'), `scopes opcionales de app-obra: ${opcionales}`);
  const predeterminados = (await adminKeycloak(`/clients/${cliente.id}/default-client-scopes`)).map((s) => s.name);
  afirmar(['roles', 'profile', 'email'].every((s) => predeterminados.includes(s)), `scopes de app-obra: ${predeterminados}`);
});

prueba('Realm: almacenero1 en la app con offline_access recibe un refresh token Offline con su rol', async () => {
  const tokens = await obtenerTokensUsuario('almacenero1', {
    clientId: 'app-obra',
    redirectUri: 'appobra://callback',
    scope: 'openid offline_access',
  });
  afirmar(tokens.scope.split(' ').includes('offline_access'), `scope: ${tokens.scope}`);
  const refresco = leerToken(tokens.refresh_token);
  afirmar(refresco.typ === 'Offline', `refresh token de tipo ${refresco.typ}`);
  afirmar(tokens.refresh_expires_in === 2592000, `refresh_expires_in: ${tokens.refresh_expires_in}`);
  const acceso = leerToken(tokens.access_token);
  afirmar(acceso.azp === 'app-obra' && [acceso.aud].flat().includes('plataforma-api'), 'azp o audiencia');
  afirmar(acceso.realm_access?.roles.includes('almacenero'), 'sin el rol almacenero');
});

// --- DynamoDB Local (101) ---
prueba('DynamoDB Local: responde ListTables en el 8000', async () => {
  // DynamoDB Local acepta cualquier credencial, pero exige un encabezado Authorization con forma de firma
  const respuesta = await fetch(DYNAMODB, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-amz-json-1.0',
      'x-amz-target': 'DynamoDB_20120810.ListTables',
      authorization:
        'AWS4-HMAC-SHA256 Credential=local/20260101/sa-east-1/dynamodb/aws4_request, SignedHeaders=host, Signature=0',
    },
    body: '{}',
  });
  afirmar(respuesta.ok, `ListTables: ${respuesta.status}`);
  const { TableNames } = await respuesta.json();
  afirmar(Array.isArray(TableNames), 'respuesta sin TableNames');
});

let fallidas = 0;
for (const { nombre, fn } of pruebas) {
  try {
    await fn();
    console.log(`ok    ${nombre}`);
  } catch (error) {
    fallidas++;
    console.log(`FALLA ${nombre}\n      ${error.message}`);
  }
}
console.log(`\n${pruebas.length - fallidas} de ${pruebas.length} pruebas pasaron`);
process.exit(fallidas ? 1 : 0);
