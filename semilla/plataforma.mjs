// Ayudante de semilla.* y recargar.* (011) para lo que se habla por HTTP o TCP con la plataforma.
// Lo usan los scripts de PowerShell y de Bash, así los dos hacen exactamente lo mismo. Node 24, sin dependencias.
// Lee infra/.env. Uso: node semilla/plataforma.mjs <orden>
//   fecha                  imprime D (SEMILLA_FECHA si viene definida y es válida; si no, hoy en America/La_Paz)
//   comprobar [--rabbitmq] comprueba que PostgreSQL, MongoDB y Keycloak (y el panel de RabbitMQ) responden
//   usuarios               comprueba que los 9 usuarios de prueba existen con su id fijo (sale con 3 si no)
//   esperar-keycloak       espera hasta 3 minutos a que el realm supervision responda
//   servicios              avisa si Obras, Materiales o Finanzas están corriendo (8081 a 8083)
//   colas                  vacía las colas de la plataforma que existan (API del panel de RabbitMQ)
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';

const env = Object.fromEntries(
  readFileSync(fileURLToPath(new URL('../.env', import.meta.url)), 'utf8')
    .split(/\r?\n/)
    .filter((linea) => linea && !linea.startsWith('#') && linea.includes('='))
    .map((linea) => [linea.slice(0, linea.indexOf('=')).trim(), linea.slice(linea.indexOf('=') + 1).trim()]),
);
const valor = (nombre, porDefecto) => env[nombre] || porDefecto;

const KEYCLOAK = valor('KEYCLOAK_URL', 'http://localhost:8080');
const RABBITMQ = valor('RABBITMQ_PANEL_URL', 'http://localhost:15672');
const POSTGRES = valor('SEMILLA_POSTGRES', 'localhost:5433');
const MONGO = valor('SEMILLA_MONGO', 'localhost:27017');

// docs/datos-prueba.md, sección 3: el id es el sub del token (los servicios guardan ese id en residente, cliente…)
const USUARIOS = [
  'admin1', 'gerente1', 'residente1', 'residente2', 'maestro1', 'almacenero1', 'cliente1', 'cliente2', 'demo1',
].map((usuario, i) => ({ usuario, id: `a0000000-0000-4000-8000-0000000000${String(i + 1).padStart(2, '0')}` }));

// Colas de la plataforma que se vacían en recargar (rabbitmq/definiciones.json). notificaciones también:
// sus mensajes viejos apuntarían a obras y planillas borradas cuando exista el servicio de la 010.
const COLAS = ['obras', 'materiales', 'finanzas', 'ia', 'notificaciones', 'plataforma.fallidos'];
const esColaDeLaPlataforma = (nombre) => COLAS.includes(nombre) || nombre.startsWith('n8n.');

const salir = (codigo, mensaje) => {
  if (mensaje) console.error(mensaje);
  process.exit(codigo);
};

function puertoAbierto(destino) {
  const [host, puerto] = destino.split(':');
  return new Promise((resolver) => {
    const socket = connect({ host, port: Number(puerto), timeout: 3000 });
    const terminar = (ok) => {
      socket.destroy();
      resolver(ok);
    };
    socket.once('connect', () => terminar(true));
    socket.once('timeout', () => terminar(false));
    socket.once('error', () => terminar(false));
  });
}

async function responde(url, opciones = {}) {
  try {
    const respuesta = await fetch(url, { ...opciones, signal: AbortSignal.timeout(5000) });
    return respuesta.ok;
  } catch {
    return false;
  }
}

const autorizacionRabbit = () =>
  'Basic ' + Buffer.from(`${env.RABBITMQ_ADMIN_USUARIO}:${env.RABBITMQ_ADMIN_CLAVE}`).toString('base64');

async function tokenAdminKeycloak() {
  let respuesta;
  try {
    respuesta = await fetch(`${KEYCLOAK}/realms/master/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username: env.KEYCLOAK_ADMIN_USUARIO ?? '',
        password: env.KEYCLOAK_ADMIN_CLAVE ?? '',
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    salir(1, `Keycloak no responde en ${KEYCLOAK}. Levanta el entorno: ./scripts/levantar.ps1 (o .sh).`);
  }
  if (!respuesta.ok) {
    salir(1, `Keycloak rechazó al administrador (${respuesta.status}): revisa KEYCLOAK_ADMIN_USUARIO y KEYCLOAK_ADMIN_CLAVE en infra/.env.`);
  }
  return (await respuesta.json()).access_token;
}

const ordenes = {
  fecha() {
    const fijada = process.env.SEMILLA_FECHA?.trim();
    if (fijada) {
      const fecha = new Date(`${fijada}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fijada) || Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== fijada) {
        salir(1, `SEMILLA_FECHA="${fijada}" no es una fecha válida AAAA-MM-DD.`);
      }
      console.log(fijada);
      return;
    }
    // en-CA da el formato AAAA-MM-DD
    console.log(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(new Date()));
  },

  async comprobar(...opciones) {
    const piezas = [
      [`PostgreSQL (${POSTGRES})`, () => puertoAbierto(POSTGRES)],
      [`MongoDB (${MONGO})`, () => puertoAbierto(MONGO)],
      [`Keycloak (${KEYCLOAK}/realms/supervision)`, () => responde(`${KEYCLOAK}/realms/supervision/.well-known/openid-configuration`)],
    ];
    if (opciones.includes('--rabbitmq')) {
      piezas.push([
        `panel de RabbitMQ (${RABBITMQ})`,
        () => responde(`${RABBITMQ}/api/overview`, { headers: { authorization: autorizacionRabbit() } }),
      ]);
    }
    const caidas = [];
    for (const [nombre, probar] of piezas) {
      const ok = await probar();
      console.log(`${ok ? 'ok      ' : 'NO RESPONDE'} ${nombre}`);
      if (!ok) caidas.push(nombre);
    }
    if (caidas.length) {
      salir(
        1,
        `No responde: ${caidas.join(', ')}. Levanta el entorno (./scripts/levantar.ps1 o .sh; PostgreSQL y MongoDB ` +
          'instalados o con el perfil bases) y vuelve a intentarlo.',
      );
    }
  },

  async usuarios() {
    const token = await tokenAdminKeycloak();
    const problemas = [];
    for (const { usuario, id } of USUARIOS) {
      const respuesta = await fetch(`${KEYCLOAK}/admin/realms/supervision/users/${id}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (respuesta.status === 404) problemas.push(`${usuario}: no existe un usuario con el id ${id}`);
      else if (!respuesta.ok) salir(1, `Keycloak respondió ${respuesta.status} al leer ${usuario}.`);
      else {
        const datos = await respuesta.json();
        if (datos.username !== usuario) problemas.push(`${id} es ${datos.username}, se esperaba ${usuario}`);
      }
    }
    if (problemas.length) {
      salir(3, `Los usuarios de Keycloak no coinciden con docs/datos-prueba.md:\n  ${problemas.join('\n  ')}`);
    }
    console.log(`ok       ${USUARIOS.length} usuarios de prueba con su id fijo`);
  },

  async 'esperar-keycloak'() {
    const limite = Date.now() + 180_000;
    while (Date.now() < limite) {
      if (await responde(`${KEYCLOAK}/realms/supervision/.well-known/openid-configuration`)) return;
      await new Promise((r) => setTimeout(r, 3000));
    }
    salir(1, 'Keycloak no respondió en 3 minutos: revisa "docker compose logs keycloak".');
  },

  async servicios() {
    // recargar recomienda detener los servicios: sus consumidores y tareas podrían escribir mientras se vacía
    const corriendo = [];
    for (const [nombre, puerto] of [['Obras', 8081], ['Materiales', 8082], ['Finanzas', 8083]]) {
      if (await puertoAbierto(`localhost:${puerto}`)) corriendo.push(`${nombre} (${puerto})`);
    }
    if (corriendo.length) {
      console.log(`AVISO: están corriendo ${corriendo.join(', ')}. Se recomienda detenerlos (y sus consumidores) antes de recargar.`);
    }
  },

  async colas() {
    const cabeceras = { authorization: autorizacionRabbit() };
    let respuesta;
    try {
      respuesta = await fetch(`${RABBITMQ}/api/queues/%2F?columns=name,messages`, { headers: cabeceras });
    } catch {
      salir(1, `El panel de RabbitMQ no responde en ${RABBITMQ}.`);
    }
    if (!respuesta.ok) salir(1, `El panel de RabbitMQ respondió ${respuesta.status}: revisa RABBITMQ_ADMIN_* en infra/.env.`);
    const colas = (await respuesta.json()).filter((c) => esColaDeLaPlataforma(c.name));
    for (const cola of colas) {
      const vaciar = await fetch(`${RABBITMQ}/api/queues/%2F/${encodeURIComponent(cola.name)}/contents`, {
        method: 'DELETE',
        headers: cabeceras,
      });
      if (!vaciar.ok) salir(1, `No se pudo vaciar la cola ${cola.name}: ${vaciar.status}`);
      console.log(`ok       cola ${cola.name} vaciada (tenía ${cola.messages ?? 0} mensajes según el panel)`);
    }
  },
};

const [orden, ...resto] = process.argv.slice(2);
if (!ordenes[orden]) salir(1, `Orden desconocida: ${orden ?? '(ninguna)'}. Usa fecha, comprobar, usuarios, esperar-keycloak, servicios o colas.`);
await ordenes[orden](...resto);
