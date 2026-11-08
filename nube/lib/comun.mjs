// 602 · Lo común de nube.mjs: el .env de la nube, comandos externos (az, aws, ssh, docker…), la IP de Jairo, la clave
// SSH y el bloque de ~/.ssh/config con los nombres de las máquinas. Node 24, sin dependencias.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const NUBE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const INFRA = resolve(NUBE, '..');
export const RUTA_ENV = join(NUBE, '.env');
export const RUTA_EJEMPLO = join(NUBE, '.env.example');
export const NUBES = ['azure', 'google', 'aws'];
// Usuario de las máquinas y carpeta donde vive lo desplegado (la misma estructura que infra/)
export const USUARIO = 'supervision';
export const CARPETA_REMOTA = '/opt/supervision';

const color = (codigo) => (texto) => (process.stdout.isTTY ? `\x1b[${codigo}m${texto}\x1b[0m` : texto);
const cian = color(36);
const rojo = color(31);
export const paso = (texto) => console.log(`\n${cian(`== ${texto}`)}`);
export const ok = (texto) => console.log(`ok       ${texto}`);
export const aviso = (texto) => console.log(`aviso    ${texto}`);
export class ErrorNube extends Error {}
export const detener = (texto) => {
  throw new ErrorNube(texto);
};
export const mostrarError = (error) => console.error(`\n${rojo(`ERROR: ${error.message}`)}`);

// --- .env ----------------------------------------------------------------------------------------------------------

/** Valor sin comillas de una línea NOMBRE=valor (las comillas simples o dobles exteriores se quitan). */
const sinComillas = (valor) => (/^'.*'$|^".*"$/.test(valor) ? valor.slice(1, -1) : valor);

/** Lee un .env: { valores: Map(nombre → valor sin comillas), crudos: Map(nombre → texto tal cual) }. */
export function leerEnv(ruta = RUTA_ENV) {
  if (!existsSync(ruta)) detener(`Falta ${ruta}: corre primero «node nube/nube.mjs secretos».`);
  const valores = new Map();
  const crudos = new Map();
  for (const linea of readFileSync(ruta, 'utf8').split(/\r?\n/)) {
    const coincidencia = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(linea);
    if (!coincidencia) continue;
    const crudo = coincidencia[2].trim();
    crudos.set(coincidencia[1], crudo);
    valores.set(coincidencia[1], sinComillas(crudo));
  }
  return { valores, crudos };
}

/** Valor de una variable del .env de la nube (o vacío). */
export function variable(nombre, env = leerEnv()) {
  return env.valores.get(nombre) ?? '';
}

/** Exige una variable con valor en el .env. */
export function exigir(nombre, env = leerEnv()) {
  const valor = variable(nombre, env);
  if (!valor) detener(`Falta ${nombre} en nube/.env.`);
  return valor;
}

/**
 * Escribe valores en el .env sin tocar el resto (comentarios y orden): reemplaza la línea de cada variable o, si no
 * está, la agrega al final. Los valores con caracteres especiales van entre comillas simples.
 */
export function fijarEnv(cambios, ruta = RUTA_ENV) {
  let texto = readFileSync(ruta, 'utf8');
  for (const [nombre, valor] of Object.entries(cambios)) {
    const linea = `${nombre}=${/^[A-Za-z0-9_.:/@+-]*$/.test(valor) ? valor : `'${valor}'`}`;
    const patron = new RegExp(`^${nombre}=.*$`, 'm');
    texto = patron.test(texto) ? texto.replace(patron, () => linea) : `${texto.replace(/\n?$/, '\n')}${linea}\n`;
  }
  writeFileSync(ruta, texto, 'utf8');
}

// --- Comandos externos -----------------------------------------------------------------------------------------------

/**
 * En Windows, `az` es un .cmd y Node no lo ejecuta sin shell (y con shell habría que escapar comillas y JSON):
 * se llama directo al Python de la CLI de Azure, como hace az.cmd.
 */
function resolverComando(programa, argumentos) {
  if (process.platform !== 'win32' || programa !== 'az') return [programa, argumentos];
  const candidatos = [
    process.env.AZ_CLI_DIR,
    'C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2',
    'C:\\Program Files (x86)\\Microsoft SDKs\\Azure\\CLI2',
  ].filter(Boolean);
  const carpeta = candidatos.find((c) => existsSync(join(c, 'python.exe')));
  if (!carpeta) detener('No encuentro la CLI de Azure: winget install -e --id Microsoft.AzureCLI');
  return [join(carpeta, 'python.exe'), ['-IBm', 'azure.cli', ...argumentos]];
}

/**
 * Ejecuta un comando y devuelve su salida (texto). Con `json: true`, la interpreta como JSON. Si falla, se detiene
 * con su error, salvo `permitirFallo: true` (devuelve null). `secreto: true` no muestra la salida en el error.
 */
export function ejecutar(programa, argumentos, opciones = {}) {
  const [ejecutable, args] = resolverComando(programa, argumentos);
  const resultado = spawnSync(ejecutable, args, {
    encoding: 'utf8',
    input: opciones.entrada,
    cwd: opciones.carpeta,
    env: { ...process.env, ...opciones.entorno },
    maxBuffer: 64 * 1024 * 1024,
    stdio: opciones.heredar ? 'inherit' : ['pipe', 'pipe', 'pipe'],
  });
  if (resultado.error) {
    if (opciones.permitirFallo) return null;
    detener(`No se pudo ejecutar ${programa}: ${resultado.error.message}`);
  }
  if (resultado.status !== 0) {
    if (opciones.permitirFallo) return null;
    const detalle = opciones.secreto ? '(salida oculta)' : (resultado.stderr || resultado.stdout || '').trim();
    detener(`Falló «${programa} ${argumentos.slice(0, 4).join(' ')}…»:\n${detalle}`);
  }
  const salida = (resultado.stdout ?? '').trim();
  if (!opciones.json) return salida;
  return salida ? JSON.parse(salida) : null;
}

export const esperar = (ms) => new Promise((listo) => setTimeout(listo, ms));

// --- Red y SSH -------------------------------------------------------------------------------------------------------

/** IP pública actual de esta PC (para abrir el 22 solo a ella). */
export async function miIp() {
  const respuesta = await fetch('https://checkip.amazonaws.com', { signal: AbortSignal.timeout(10_000) });
  const ip = (await respuesta.text()).trim();
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) detener(`No pude saber la IP pública de esta PC (respuesta: ${ip}).`);
  return ip;
}

/** Ruta de la clave SSH privada (SSH_CLAVE, con ~ = carpeta del usuario). */
export function rutaClave(env = leerEnv()) {
  const valor = variable('SSH_CLAVE', env) || '~/.ssh/supervision_nube';
  return valor.startsWith('~') ? join(homedir(), valor.slice(1)) : resolve(valor);
}

/** Crea la clave SSH (ed25519, sin frase) si no existe; devuelve la clave pública. */
export function asegurarClave(env = leerEnv()) {
  const privada = rutaClave(env);
  if (!existsSync(privada)) {
    mkdirSync(dirname(privada), { recursive: true });
    ejecutar('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'supervision-nube', '-f', privada]);
    ok(`clave SSH creada en ${privada}`);
  }
  return readFileSync(`${privada}.pub`, 'utf8').trim();
}

const MARCA_INICIO = '# >>> supervision-nube (lo escribe infra/nube/nube.mjs; no lo edites a mano) >>>';
const MARCA_FIN = '# <<< supervision-nube <<<';

/**
 * Agrega o actualiza en ~/.ssh/config el nombre `supervision-<nube>` con la IP, el usuario y la clave de la máquina.
 * Así `ssh supervision-azure` funciona y los contextos de Docker (ssh://supervision-azure) usan la clave correcta.
 */
export function fijarSshConfig(nube, ip, env = leerEnv()) {
  const ruta = join(homedir(), '.ssh', 'config');
  mkdirSync(dirname(ruta), { recursive: true });
  const texto = existsSync(ruta) ? readFileSync(ruta, 'utf8') : '';
  const inicio = texto.indexOf(MARCA_INICIO);
  const fin = texto.indexOf(MARCA_FIN);
  const bloque = inicio >= 0 && fin > inicio ? texto.slice(inicio + MARCA_INICIO.length, fin) : '';
  const hosts = new Map();
  for (const parte of bloque.split(/\n(?=Host )/)) {
    const nombre = /^Host (\S+)/m.exec(parte)?.[1];
    if (nombre) hosts.set(nombre, parte.trim());
  }
  hosts.set(
    `supervision-${nube}`,
    [
      `Host supervision-${nube}`,
      `  HostName ${ip}`,
      `  User ${USUARIO}`,
      `  IdentityFile ${rutaClave(env).replaceAll('\\', '/')}`,
      '  IdentitiesOnly yes',
      '  StrictHostKeyChecking accept-new',
      '  ServerAliveInterval 30',
    ].join('\n'),
  );
  const nuevo = `${MARCA_INICIO}\n${[...hosts.values()].join('\n\n')}\n${MARCA_FIN}`;
  const resultado =
    inicio >= 0 && fin > inicio
      ? texto.slice(0, inicio) + nuevo + texto.slice(fin + MARCA_FIN.length)
      : `${texto.replace(/\n*$/, texto ? '\n\n' : '')}${nuevo}\n`;
  writeFileSync(ruta, resultado, 'utf8');
}

/** Olvida la huella SSH vieja de una IP (al recrear una máquina con la misma IP fija). */
export function olvidarHuella(ip) {
  ejecutar('ssh-keygen', ['-R', ip], { permitirFallo: true });
}

/** Ejecuta un comando en la máquina por SSH (con el nombre de ~/.ssh/config). */
export function remoto(nube, comando, opciones = {}) {
  return ejecutar('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', `supervision-${nube}`, comando], opciones);
}

/** Espera a que la máquina acepte SSH y termine cloud-init (Docker instalado). */
export async function esperarSsh(nube, segundos = 600) {
  const limite = Date.now() + segundos * 1000;
  while (Date.now() < limite) {
    if (remoto(nube, 'true', { permitirFallo: true }) !== null) {
      remoto(nube, 'cloud-init status --wait >/dev/null 2>&1 || true; docker --version', { permitirFallo: true });
      if (remoto(nube, 'docker info --format "{{.ServerVersion}}"', { permitirFallo: true }) !== null) return;
    }
    await esperar(10_000);
  }
  detener(`La máquina de ${nube} no respondió por SSH (o Docker no quedó instalado) en ${segundos} s.`);
}
