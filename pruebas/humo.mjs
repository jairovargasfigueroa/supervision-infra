// Pruebas de humo del entorno levantado (./scripts/levantar.*). Uso: node pruebas/humo.mjs
// Lee las credenciales de .env. Sale con código 1 si alguna comprobación falla.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { leerToken, obtenerTokenUsuario } from './token-usuario.mjs';

const env = Object.fromEntries(
  readFileSync(fileURLToPath(new URL('../.env', import.meta.url)), 'utf8')
    .split(/\r?\n/)
    .filter((linea) => linea && !linea.startsWith('#') && linea.includes('='))
    .map((linea) => [linea.slice(0, linea.indexOf('=')), linea.slice(linea.indexOf('=') + 1)]),
);

const RABBITMQ = 'http://localhost:15672/api';
const KEYCLOAK = 'http://localhost:8080';
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

// --- Keycloak (1.2) ---
prueba('Keycloak: responde el realm master', async () => {
  const respuesta = await fetch(`${KEYCLOAK}/realms/master/.well-known/openid-configuration`);
  afirmar(respuesta.ok, `descubrimiento de master: ${respuesta.status}`);
});

// --- Realm supervision (1.4) ---
const USUARIOS = {
  admin1: ['admin'],
  gerente1: ['gerente'],
  residente1: ['residente'],
  residente2: ['residente'],
  maestro1: ['maestro'],
  almacenero1: ['almacenero'],
  cliente1: ['cliente'],
  cliente2: ['cliente'],
  demo1: ['residente', 'cliente'],
};
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

prueba('Realm: los 9 usuarios de prueba con su id fijo y sus roles', async () => {
  for (const [indice, [usuario, roles]] of Object.entries(USUARIOS).entries()) {
    const id = `a0000000-0000-4000-8000-0000000000${String(indice + 1).padStart(2, '0')}`;
    const datos = await adminKeycloak(`/users/${id}`);
    afirmar(datos.username === usuario, `${id} es ${datos.username}, se esperaba ${usuario}`);
    afirmar(datos.firstName && datos.lastName && datos.emailVerified, `${usuario}: nombre o correo`);
    const asignados = (await adminKeycloak(`/users/${id}/role-mappings/realm`)).map((r) => r.name);
    for (const rol of ROLES) {
      afirmar(asignados.includes(rol) === roles.includes(rol), `${usuario}: rol ${rol}`);
    }
  }
});

prueba('Realm: el cliente gateway obtiene token con audiencia plataforma-api y puede leer usuarios', async () => {
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
