// 602 · Lo que se hace dentro de una máquina por SSH: desplegar (copiar los archivos y el .env de su grupo, descargar
// las imágenes y levantar), esperar a que todo esté sano, ver los contenedores y los registros.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CARPETA_REMOTA,
  INFRA,
  NUBE,
  detener,
  ejecutar,
  esperar,
  leerEnv,
  ok,
  paso,
  remoto,
  variable,
} from './comun.mjs';

/** Lo que se copia a cada máquina (rutas relativas a infra/, con la misma estructura en /opt/supervision). */
const ARCHIVOS = {
  azure: [
    'nube/rabbitmq/tls.conf',
    'nube/maquina/certificado-rabbitmq.sh',
    'produccion-local/postgres/iniciar-azure.sh',
    'rabbitmq/iniciar.sh',
    'rabbitmq/definiciones.json',
    'keycloak/realm-supervision.json',
    'keycloak/temas/supervision',
    'n8n',
    'nube/sitios',
  ],
  google: ['postgres/init-reportes.sh', 'postgres/lector-reportes.sql', 'produccion-local/mongo/iniciar-replica.js'],
  aws: [],
};

/** Direcciones de /salud (y páginas) que se revisan al final de desplegar y en «estado». */
export const SALUD = {
  azure: ['KEYCLOAK_URL:/realms/supervision/.well-known/openid-configuration', 'GATEWAY_URL:/salud', 'OBRAS_URL:/salud', 'FINANZAS_URL:/salud', 'ERP_URL:/', 'PORTAL_URL:/'],
  google: ['MATERIALES_URL:/salud', 'IA_URL:/salud'],
  aws: ['SINCRONIZACION_URL:/salud'],
};

const compose = (nube) => `docker compose -f ${CARPETA_REMOTA}/nube/compose.${nube}.yml`;

/** Variables que usa un compose (${NOMBRE…}). */
function variablesDelCompose(nube) {
  const texto = readFileSync(join(NUBE, `compose.${nube}.yml`), 'utf8');
  return new Set([...texto.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]));
}

/** El .env de la máquina: solo las variables que usa su compose, tal como están en nube/.env. */
function envDeLaMaquina(nube, env) {
  const usadas = variablesDelCompose(nube);
  const lineas = [`# 602 · .env de la máquina de ${nube} (lo escribe nube.mjs desplegar; solo las variables de su compose)`];
  for (const [nombre, crudo] of env.crudos) {
    if (usadas.has(nombre)) lineas.push(`${nombre}=${crudo}`);
  }
  return `${lineas.join('\n')}\n`;
}

/** Revisa las direcciones públicas de una nube; devuelve cuántas fallaron. */
export async function revisarSalud(nube, env = leerEnv()) {
  let fallas = 0;
  for (const entrada of SALUD[nube]) {
    const [nombre, ruta] = entrada.split(/:(.*)/s);
    const url = `${variable(nombre, env)}${ruta === '/' ? '/' : ruta}`;
    try {
      const respuesta = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (respuesta.ok) ok(`${respuesta.status} ${url}`);
      else {
        fallas++;
        console.log(`falla    ${respuesta.status} ${url}`);
      }
    } catch (error) {
      fallas++;
      console.log(`falla    ${url}: ${error.cause?.code ?? error.message}`);
    }
  }
  return fallas;
}

/** Contenedores del grupo: servicio|estado|salud|código de salida. */
function contenedores(nube) {
  const salida = remoto(nube, `${compose(nube)} ps -a --format '{{.Service}}|{{.State}}|{{.Health}}|{{.ExitCode}}'`, {
    permitirFallo: true,
  });
  return (salida ?? '')
    .split('\n')
    .filter(Boolean)
    .map((linea) => {
      const [servicio, estado, salud, codigo] = linea.split('|');
      return { servicio, estado, salud, codigo };
    });
}

/** Espera a que todos los contenedores corran (sanos si tienen healthcheck) y los de una vez terminen con 0. */
export async function esperarSano(nube, segundos = 900) {
  const limite = Date.now() + segundos * 1000;
  while (Date.now() < limite) {
    const lista = contenedores(nube);
    const fallidos = lista.filter((c) => (c.estado === 'exited' && c.codigo !== '0') || c.salud === 'unhealthy');
    if (fallidos.length) {
      detener(`Con problemas en ${nube}: ${fallidos.map((c) => c.servicio).join(', ')}. Revisa: node nube/nube.mjs registros ${nube} <servicio>`);
    }
    const pendientes = lista.filter((c) => c.estado !== 'exited' && (c.estado !== 'running' || (c.salud && c.salud !== 'healthy')));
    if (lista.length && !pendientes.length) {
      ok(`${nube}: ${lista.length} contenedores sanos`);
      return;
    }
    console.log(`esperando en ${nube}: ${pendientes.map((c) => c.servicio).join(' ') || '(sin contenedores todavía)'}`);
    await esperar(10_000);
  }
  detener(`${nube} no quedó sano en ${segundos} s: node nube/nube.mjs estado ${nube}`);
}

/** Lista de contenedores para «estado». */
export function mostrarContenedores(nube) {
  const lista = contenedores(nube);
  if (!lista.length) {
    console.log('         (sin contenedores: ¿falta desplegar?)');
    return;
  }
  for (const c of lista) console.log(`         ${c.servicio.padEnd(20)} ${c.estado}${c.salud ? ` (${c.salud})` : ''}${c.estado === 'exited' ? ` código ${c.codigo}` : ''}`);
}

function publicarFrontends() {
  paso('Frontends compilados con las direcciones de la nube');
  const argumentos =
    process.platform === 'win32'
      ? ['powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(INFRA, 'produccion-local', 'publicar-frontends.ps1'), '-Entorno', join(NUBE, '.env'), '-Destino', join(NUBE, 'sitios')]]
      : ['bash', [join(INFRA, 'produccion-local', 'publicar-frontends.sh'), '--entorno', join(NUBE, '.env'), '--destino', join(NUBE, 'sitios')]];
  ejecutar(argumentos[0], argumentos[1], { heredar: true });
}

/** Despliega una nube en su máquina (que ya existe y tiene su nombre en ~/.ssh/config). */
export async function desplegarEn(nube, { sinFrontends = false } = {}) {
  const env = leerEnv();
  if (nube === 'azure' && !sinFrontends) publicarFrontends();
  if (nube === 'azure' && !existsSync(join(NUBE, 'sitios', 'erp-shell', 'index.html'))) {
    detener('Faltan los frontends en nube/sitios: corre desplegar azure sin --sin-frontends.');
  }

  paso(`Archivos de ${nube} a ${CARPETA_REMOTA}`);
  const lista = [`nube/compose.${nube}.yml`, `nube/caddy/Caddyfile.${nube}`, 'produccion-local/caddy/comun.caddy', ...ARCHIVOS[nube]];
  const paquete = `nube/.paquete-${nube}.tar`;
  // Ruta relativa a infra/: el tar de Git Bash tomaría «C:» de una ruta absoluta como un servidor remoto
  ejecutar('tar', ['-cf', paquete, ...lista], { carpeta: INFRA });
  ejecutar('scp', ['-q', '-o', 'BatchMode=yes', join(INFRA, paquete), `supervision-${nube}:${CARPETA_REMOTA}/paquete.tar`]);
  rmSync(join(INFRA, paquete), { force: true });
  remoto(nube, `cd ${CARPETA_REMOTA} && tar -xf paquete.tar && rm paquete.tar && mkdir -p nube/datos/caddy nube/certificados nube/sitios`);
  ok(`${lista.length} rutas copiadas`);

  const archivoEnv = join(tmpdir(), `supervision-env-${nube}-${process.pid}`);
  writeFileSync(archivoEnv, envDeLaMaquina(nube, env), { encoding: 'utf8', mode: 0o600 });
  try {
    ejecutar('scp', ['-q', '-o', 'BatchMode=yes', archivoEnv, `supervision-${nube}:${CARPETA_REMOTA}/nube/.env`]);
  } finally {
    rmSync(archivoEnv, { force: true });
  }
  remoto(nube, `chmod 600 ${CARPETA_REMOTA}/nube/.env`);
  ok('.env de la máquina copiado (permisos 600; solo las variables de su compose)');

  paso(`Imágenes y contenedores de ${nube}`);
  remoto(nube, `${compose(nube)} pull -q`, { heredar: true });
  if (nube === 'azure') {
    remoto(nube, `${compose(nube)} up -d caddy`, { heredar: true });
    console.log('esperando el certificado de rabbitmq (Caddy lo saca de Let\'s Encrypt si el DNS ya apunta aquí)…');
    remoto(nube, `sudo sh ${CARPETA_REMOTA}/nube/maquina/certificado-rabbitmq.sh --esperar`, { heredar: true });
  }
  remoto(nube, `${compose(nube)} up -d --remove-orphans`, { heredar: true });
  await esperarSano(nube);

  paso(`Direcciones públicas de ${nube}`);
  const fallas = await revisarSalud(nube, env);
  if (fallas) detener(`${fallas} dirección(es) de ${nube} no responden bien (¿DNS todavía propagándose?).`);
}

export function registros(nube, servicio) {
  remoto(nube, `${compose(nube)} logs --tail 200 ${servicio ?? ''}`, { heredar: true });
}

export function sesionSsh(nube) {
  ejecutar('ssh', [`supervision-${nube}`], { heredar: true });
}
