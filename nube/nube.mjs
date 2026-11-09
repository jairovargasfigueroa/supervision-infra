#!/usr/bin/env node
// 602 · Despliegue en las tres nubes desde la PC de Jairo (Node 24, sin dependencias). Llama a las CLI az, aws,
// gcloud, ssh, scp, tar y docker. Diseño: docs/specs/602-despliegue-tres-nubes/diseno.md;
// pasos y costos: nube/README.md.
//
// Uso: node nube/nube.mjs <acción> [nube] [opciones]
//   secretos                     crea nube/.env desde .env.example y llena los secretos vacíos (y la clave SSH)
//   crear azure|aws|google       crea los recursos (si ya existen, los deja); en AWS, --datos crea solo bucket,
//                                tablas, permisos y presupuesto
//   desplegar azure|aws|google   copia los archivos y el .env de la nube a su máquina, descarga las imágenes y levanta
//                                (en Azure compila y copia los frontends; --sin-frontends usa los de nube/sitios)
//   encender azure|aws|google|todas   enciende, abre el 22 a la IP actual y espera a que todo esté sano
//   apagar azure|aws|google|todas     apaga (Azure: desasignada, sin cobro de cómputo)
//   estado [nube]                máquinas, IP, contenedores y /salud
//   registros <nube> [servicio]  últimas líneas de docker compose logs
//   ssh <nube>                   abre una sesión en la máquina
//   dns                          registros A que van en Namecheap
//   contextos                    contextos de Docker por SSH (supervision-<nube>) para la semilla de demostración
import { randomBytes, randomInt } from 'node:crypto';
import { copyFileSync, existsSync } from 'node:fs';
import {
  ErrorNube,
  NUBES,
  RUTA_EJEMPLO,
  RUTA_ENV,
  asegurarClave,
  aviso,
  detener,
  ejecutar,
  esperarSsh,
  fijarEnv,
  fijarSshConfig,
  leerEnv,
  mostrarError,
  ok,
  olvidarHuella,
  paso,
  remoto,
  variable,
} from './lib/comun.mjs';
import { abrirSshAzure, apagarAzure, crearAzure, encenderAzure, estadoAzure, ipAzure } from './lib/azure.mjs';
import { abrirSshAws, apagarAws, crearDatosAws, crearMaquinaAws, encenderAws, estadoAws, ipAws } from './lib/aws.mjs';
import { abrirSshGoogle, apagarGoogle, crearGoogle, encenderGoogle, estadoGoogle, ipGoogle } from './lib/google.mjs';
import { desplegarEn, esperarSano, mostrarContenedores, registros, revisarSalud, sesionSsh } from './lib/maquina.mjs';

const IP = { azure: ipAzure, aws: ipAws, google: ipGoogle };
const ESTADO = { azure: estadoAzure, aws: estadoAws, google: estadoGoogle };
const ENCENDER = { azure: encenderAzure, aws: encenderAws, google: encenderGoogle };
const APAGAR = { azure: apagarAzure, aws: apagarAws, google: apagarGoogle };
const ABRIR_SSH = { azure: abrirSshAzure, aws: abrirSshAws, google: abrirSshGoogle };
const encendida = (estado) => Boolean(estado) && /running/i.test(estado);

// --- secretos --------------------------------------------------------------------------------------------------------

const SECRETOS = [
  'KEYCLOAK_ADMIN_CLAVE', 'KEYCLOAK_GATEWAY_CLIENT_SECRET', 'IA_REPORTES_CLIENT_SECRET', 'IA_AGENTES_CLIENT_SECRET',
  'N8N_KEYCLOAK_SECRETO', 'POSTGRES_CLAVE', 'POSTGRES_OBRAS_CLAVE', 'POSTGRES_FINANZAS_CLAVE', 'POSTGRES_KEYCLOAK_CLAVE',
  'POSTGRES_REPORTES_CLAVE', 'POSTGRES_IA_CLAVE', 'POSTGRES_IA_LECTOR_CLAVE', 'RABBITMQ_ADMIN_CLAVE',
  'RABBITMQ_OBRAS_CLAVE', 'RABBITMQ_MATERIALES_CLAVE', 'RABBITMQ_FINANZAS_CLAVE', 'RABBITMQ_IA_CLAVE',
  'RABBITMQ_N8N_CLAVE', 'N8N_ENCRYPTION_KEY', 'N8N_PROPIETARIO_CLAVE', 'MAILPIT_CLAVE',
];
const PALABRAS = ['Obra', 'Muro', 'Losa', 'Viga', 'Pilar', 'Arena', 'Grava', 'Techo', 'Plano', 'Bloque', 'Columna', 'Zapata'];
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** 32 caracteres al azar con al menos una mayúscula, una minúscula y un dígito (políticas de n8n y Keycloak). */
function secreto() {
  for (;;) {
    const valor = [...randomBytes(32)].map((b) => ALFABETO[b % ALFABETO.length]).join('');
    if (/[A-Z]/.test(valor) && /[a-z]/.test(valor) && /\d/.test(valor)) return valor;
  }
}

/** Contraseña de los usuarios de prueba: dos palabras y cuatro dígitos (fácil de escribir en el celular). */
function claveLegible() {
  const a = PALABRAS[randomInt(PALABRAS.length)];
  let b = PALABRAS[randomInt(PALABRAS.length)];
  while (b === a) b = PALABRAS[randomInt(PALABRAS.length)];
  return `${a}-${b}-${String(randomInt(10_000)).padStart(4, '0')}`;
}

function hashConDocker(imagen, argumentos, descripcion) {
  const salida = ejecutar('docker', ['run', '--rm', ...argumentos], { permitirFallo: true, secreto: true });
  if (!salida) {
    aviso(`no se pudo generar ${descripcion} con ${imagen} (¿Docker Desktop encendido?): vuelve a correr «secretos»`);
    return '';
  }
  return salida.split('\n').pop().trim();
}

function secretos() {
  paso('nube/.env');
  if (!existsSync(RUTA_ENV)) {
    copyFileSync(RUTA_EJEMPLO, RUTA_ENV);
    ok('creado desde .env.example');
  } else {
    ok('ya existe: solo se llenan los vacíos');
  }
  let env = leerEnv();
  const cambios = {};
  for (const nombre of SECRETOS) if (!variable(nombre, env)) cambios[nombre] = secreto();
  if (!variable('FINANZAS_APP_KEY', env)) cambios.FINANZAS_APP_KEY = `base64:${randomBytes(32).toString('base64')}`;
  if (!variable('USUARIOS_PRUEBA_CLAVE', env)) cambios.USUARIOS_PRUEBA_CLAVE = claveLegible();
  if (!variable('S3_BUCKET', env)) cambios.S3_BUCKET = `supervision-obras-${randomBytes(3).toString('hex')}`;
  fijarEnv(cambios);
  ok(`${Object.keys(cambios).length} valores generados (no se muestran)`);

  env = leerEnv();
  const hashes = {};
  if (!variable('N8N_PROPIETARIO_CLAVE_HASH', env)) {
    hashes.N8N_PROPIETARIO_CLAVE_HASH = hashConDocker(
      'n8nio/n8n:2.43.7',
      ['-w', '/usr/local/lib/node_modules/n8n', '--entrypoint', 'node', 'n8nio/n8n:2.43.7', '-e',
        "console.log(require('bcryptjs').hashSync(process.argv[1], 10))", variable('N8N_PROPIETARIO_CLAVE', env)],
      'el hash de la contraseña de n8n',
    );
  }
  if (!variable('MAILPIT_CLAVE_HASH', env)) {
    hashes.MAILPIT_CLAVE_HASH = hashConDocker(
      'caddy:2.11.7-alpine',
      ['caddy:2.11.7-alpine', 'caddy', 'hash-password', '--plaintext', variable('MAILPIT_CLAVE', env)],
      'el hash de la contraseña de Mailpit',
    );
  }
  const conValor = Object.fromEntries(Object.entries(hashes).filter(([, v]) => v));
  if (Object.keys(conValor).length) {
    fijarEnv(conValor);
    ok(`hashes listos: ${Object.keys(conValor).join(', ')}`);
  }

  paso('Clave SSH');
  asegurarClave(env);
  ok('lista');

  env = leerEnv();
  const manuales = [
    ['NUBE_ALERTAS_CORREO', 'opcional: tu correo, para los avisos de presupuesto'],
    ['CLIENTE1_CORREO', 'buzón real donde llega la nota de cobro de cliente1 (vacío: cliente1@correo.test)'],
    ['SMTP_USUARIO', 'el Gmail de la plataforma (sin él, el correo queda en Mailpit)'],
    ['SMTP_CLAVE', 'su contraseña de aplicación (16 letras)'],
    ['COBRANZA_REMITENTE', 'el Gmail de la plataforma'],
    ['COBRANZA_CORREO', 'el Gmail de la plataforma'],
  ].filter(([nombre]) => !variable(nombre, env));
  if (manuales.length) {
    paso('Falta completar a mano en nube/.env');
    for (const [nombre, para] of manuales) console.log(`         ${nombre.padEnd(24)} ${para}`);
  }
  console.log('\nGuarda una copia de nube/.env fuera del repo: las bases se crean con esas contraseñas.');
}

// --- dns y contextos ---------------------------------------------------------------------------------------------

const PIEZAS = {
  azure: ['keycloak', 'gateway', 'obras', 'finanzas', 'erp', 'portal', 'mf-obras', 'mf-materiales', 'mf-supervision', 'n8n', 'mailpit', 'rabbitmq'],
  google: ['materiales', 'ia'],
  aws: ['sincronizacion'],
};

function dns() {
  const env = leerEnv();
  const dominio = variable('DOMINIO', env);
  const partes = dominio.split('.');
  const registrado = partes.slice(-2).join('.');
  const prefijo = partes.slice(0, -2).join('.');
  paso(`Registros A en Namecheap (dominio ${registrado} → Advanced DNS, TTL 5 min)`);
  for (const nube of NUBES) {
    const ip = IP[nube](env);
    if (!ip) {
      console.log(`         ${nube}: todavía sin IP (crear ${nube})`);
      continue;
    }
    if (nube === 'azure') {
      console.log(`         A   *.${prefijo}`.padEnd(40) + ip + '   (comodín; si Namecheap no lo acepta, uno por nombre:)');
      for (const pieza of PIEZAS.azure) console.log(`             ${pieza}.${prefijo}`.padEnd(40) + ip);
    } else {
      for (const pieza of PIEZAS[nube]) console.log(`         A   ${pieza}.${prefijo}`.padEnd(40) + ip);
    }
  }
  console.log(`\nNo toques los registros que ya hay (api, sga-api): son de otro proyecto.`);
}

function contextos() {
  const env = leerEnv();
  paso('Contextos de Docker por SSH');
  for (const nube of NUBES) {
    const ip = IP[nube](env);
    if (!ip) {
      console.log(`         ${nube}: sin máquina todavía`);
      continue;
    }
    fijarSshConfig(nube, ip, env);
    const nombre = `supervision-${nube}`;
    const existe = ejecutar('docker', ['context', 'inspect', nombre], { permitirFallo: true }) !== null;
    ejecutar('docker', ['context', existe ? 'update' : 'create', nombre, '--docker', `host=ssh://${nombre}`]);
    ok(`${nombre} → ssh://${nombre} (${ip})`);
  }
}

// --- crear, desplegar, encender, apagar y estado ---------------------------------------------------------------

function exigirNube(nube, permitirTodas = false) {
  const validas = permitirTodas ? [...NUBES, 'todas'] : NUBES;
  if (!validas.includes(nube)) detener(`Nube desconocida: ${nube ?? '(falta)'} (${validas.join(', ')}).`);
  return nube;
}

async function crear(nube, opciones) {
  if (nube === 'azure') await crearAzure();
  else if (nube === 'aws') {
    await crearDatosAws();
    if (!opciones.includes('--datos')) await crearMaquinaAws();
  } else await crearGoogle();
  const env = leerEnv();
  const ip = IP[nube](env);
  if (ip) {
    olvidarHuella(ip);
    fijarSshConfig(nube, ip, env);
    ok(`ssh supervision-${nube} → ${ip}`);
    console.log(`\nSiguiente: pon los registros DNS (node nube/nube.mjs dns) y después node nube/nube.mjs desplegar ${nube}.`);
  }
}

async function prepararSsh(nube) {
  const env = leerEnv();
  const ip = IP[nube](env);
  if (!ip) detener(`La máquina de ${nube} no existe: node nube/nube.mjs crear ${nube}`);
  fijarSshConfig(nube, ip, env);
  await ABRIR_SSH[nube](env);
  await esperarSsh(nube);
}

async function desplegar(nube, opciones) {
  await prepararSsh(nube);
  await desplegarEn(nube, { sinFrontends: opciones.includes('--sin-frontends') });
  ok(`${nube} desplegada`);
}

async function encender(nube) {
  const env = leerEnv();
  await ENCENDER[nube]();
  fijarSshConfig(nube, IP[nube](env), env);
  await esperarSsh(nube);
  if (nube === 'azure') {
    if (remoto(nube, 'sudo sh /opt/supervision/nube/maquina/certificado-rabbitmq.sh', { permitirFallo: true, heredar: true }) === null) {
      aviso('no se pudo renovar la copia del certificado de RabbitMQ (¿falta desplegar?)');
    }
  }
  await esperarSano(nube);
  await revisarSalud(nube, env);
}

async function estado(filtro) {
  const env = leerEnv();
  for (const nube of filtro ? [filtro] : NUBES) {
    const situacion = ESTADO[nube](env);
    paso(`${nube}: ${situacion ?? 'sin crear'}${IP[nube](env) ? ` · IP ${IP[nube](env)}` : ''}`);
    if (!encendida(situacion)) continue;
    fijarSshConfig(nube, IP[nube](env), env);
    mostrarContenedores(nube);
    await revisarSalud(nube, env);
  }
}

async function principal() {
  const [accion, nube, ...resto] = process.argv.slice(2);
  const opciones = [nube, ...resto].filter((a) => a?.startsWith('--'));
  switch (accion) {
    case 'secretos':
      return secretos();
    case 'dns':
      return dns();
    case 'contextos':
      return contextos();
    case 'crear':
      return crear(exigirNube(nube), opciones);
    case 'desplegar':
      return desplegar(exigirNube(nube), opciones);
    case 'encender':
      for (const n of exigirNube(nube, true) === 'todas' ? NUBES.filter((x) => ESTADO[x](leerEnv())) : [nube]) await encender(n);
      return;
    case 'apagar':
      for (const n of exigirNube(nube, true) === 'todas' ? [...NUBES].reverse().filter((x) => ESTADO[x](leerEnv())) : [nube]) APAGAR[n]();
      return;
    case 'estado':
      return estado(nube ? exigirNube(nube) : undefined);
    case 'registros':
      return registros(exigirNube(nube), resto.find((a) => !a.startsWith('--')));
    case 'ssh':
      return sesionSsh(exigirNube(nube));
    default:
      console.log(
        'Uso: node nube/nube.mjs <secretos|crear|desplegar|encender|apagar|estado|registros|ssh|dns|contextos> [nube]\n' +
          '(nube: azure, aws o google; encender y apagar aceptan «todas»). Detalle: nube/README.md',
      );
      if (accion) process.exitCode = 2;
  }
}

try {
  await principal();
} catch (error) {
  if (!(error instanceof ErrorNube)) throw error;
  mostrarError(error);
  process.exitCode = 1;
}
