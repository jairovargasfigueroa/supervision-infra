// Pruebas de humo del entorno levantado (./scripts/levantar.*). Uso: node pruebas/humo.mjs
// Lee las credenciales de .env. Sale con código 1 si alguna comprobación falla.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
