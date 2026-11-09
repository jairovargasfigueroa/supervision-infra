// 602 · Google Cloud: crea el proyecto (o usa el de GOOGLE_PROYECTO), activa Compute Engine, su red con las reglas de
// firewall, la dirección estática y la máquina vm-ia; la enciende, la apaga y dice su estado. Usa la CLI de Google con
// la sesión de «gcloud auth login» y pasa --project en cada llamada (no cambia el proyecto por defecto de gcloud).
// Diseño de la 602, «Qué crea cada nube».
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  asegurarClave,
  aviso,
  cloudInitConUsuario,
  detener,
  ejecutar,
  esperarSsh,
  fijarEnv,
  fijarSshConfig,
  leerEnv,
  miIp,
  ok,
  olvidarHuella,
  paso,
  remoto,
  variable,
} from './comun.mjs';

const VM = 'vm-ia';
const IP = 'ip-ia';
// Red propia: la «default» de un proyecto nuevo trae el 22 y el 3389 abiertos a internet
const RED = 'vpc-supervision';
const SUBRED = 'principal';
const REGLA_WEB = 'supervision-web';
const REGLA_SSH = 'supervision-ssh';

const proyecto = (env) => variable('GOOGLE_PROYECTO', env) || 'supervision-obras';
const region = (env) => variable('GOOGLE_REGION', env) || 'us-east5';
const zona = (env) => variable('GOOGLE_ZONA', env) || `${region(env)}-a`;

const gcloud = (argumentos, opciones = {}) => ejecutar('gcloud', [...argumentos, '--quiet'], opciones);
/** gcloud con el proyecto de la nube y la salida en JSON. */
const gcp = (env, argumentos, opciones = {}) =>
  gcloud([...argumentos, '--project', proyecto(env), '--format', 'json'], { ...opciones, json: true });

function sesion() {
  const cuenta = gcloud(['auth', 'list', '--filter', 'status:ACTIVE', '--format', 'value(account)'], { permitirFallo: true });
  if (cuenta === null) detener('No encuentro la CLI de Google: winget install -e --id Google.CloudSDK');
  if (!cuenta) detener('No hay sesión de Google: corre «gcloud auth login» (en el navegador, con la cuenta de los créditos).');
  return cuenta.split('\n')[0];
}

/** Dirección estática de la máquina (vacío si todavía no existe, o sin CLI o sin sesión). */
export function ipGoogle(env = leerEnv()) {
  return gcp(env, ['compute', 'addresses', 'describe', IP, '--region', region(env)], { permitirFallo: true })?.address ?? '';
}

/** Estado de la máquina («running (e2-standard-4)», «terminated (…)» = detenida…) o null si no existe. */
export function estadoGoogle(env = leerEnv()) {
  const datos = gcp(env, ['compute', 'instances', 'describe', VM, '--zone', zona(env)], { permitirFallo: true });
  return datos ? `${datos.status.toLowerCase()} (${datos.machineType.split('/').pop()})` : null;
}

/** Deja el 22 abierto solo para la IP actual de esta PC. */
export async function abrirSshGoogle(env = leerEnv()) {
  const ip = await miIp();
  gcp(env, ['compute', 'firewall-rules', 'update', REGLA_SSH, '--source-ranges', `${ip}/32`]);
  ok(`SSH de Google abierto solo para ${ip}`);
}

/** El proyecto existe y la cuenta lo ve; si no, lo crea (el ID es único en todo Google: si está tomado, con sufijo). */
function asegurarProyecto(env) {
  const id = proyecto(env);
  if (gcloud(['projects', 'describe', id, '--format', 'value(projectId)'], { permitirFallo: true })) {
    ok(`proyecto ${id}`);
    return id;
  }
  for (const candidato of [id, `${id}-${Date.now().toString(36).slice(-5)}`]) {
    if (gcloud(['projects', 'create', candidato, '--name', 'supervision-obras'], { permitirFallo: candidato === id }) !== null) {
      if (candidato !== id) fijarEnv({ GOOGLE_PROYECTO: candidato });
      ok(`proyecto ${candidato} creado${candidato !== id ? ` (${id} ya lo usa otra cuenta; guardado en nube/.env)` : ''}`);
      return candidato;
    }
  }
  return id;
}

/** Une el proyecto a la cuenta de facturación (la de la prueba gratuita) si todavía no lo está. */
function asegurarFacturacion(id) {
  const activa = gcloud(['billing', 'projects', 'describe', id, '--format', 'value(billingEnabled)'], { permitirFallo: true });
  if (activa === 'True') {
    ok('facturación activa (créditos de la cuenta)');
    return;
  }
  const cuentas = gcloud(['billing', 'accounts', 'list', '--filter', 'open=true', '--format', 'json'], { json: true }) ?? [];
  const elegida = variable('GOOGLE_FACTURACION') || (cuentas.length === 1 ? cuentas[0].name.split('/').pop() : '');
  if (!elegida) {
    const lista = cuentas.map((c) => `${c.name.split('/').pop()} (${c.displayName})`).join(', ') || 'ninguna abierta';
    detener(`No sé qué cuenta de facturación usar (${lista}): pon su ID en GOOGLE_FACTURACION de nube/.env.`);
  }
  gcloud(['billing', 'projects', 'link', id, '--billing-account', elegida, '--format', 'none']);
  ok(`proyecto unido a la cuenta de facturación ${elegida}`);
}

export async function crearGoogle() {
  let env = leerEnv();
  ok(`cuenta ${sesion()}`);
  const tipo = variable('GOOGLE_TIPO', env) || 'e2-standard-4';

  paso('Proyecto, facturación y API de Compute Engine');
  const id = asegurarProyecto(env);
  env = leerEnv();
  asegurarFacturacion(id);
  gcloud(['services', 'enable', 'compute.googleapis.com', '--project', id]);
  ok('Compute Engine activada');

  paso(`Red ${RED}, firewall y dirección estática en ${region(env)}`);
  if (!gcp(env, ['compute', 'networks', 'describe', RED], { permitirFallo: true })) {
    gcp(env, ['compute', 'networks', 'create', RED, '--subnet-mode', 'custom']);
  }
  if (!gcp(env, ['compute', 'networks', 'subnets', 'describe', SUBRED, '--region', region(env)], { permitirFallo: true })) {
    gcp(env, ['compute', 'networks', 'subnets', 'create', SUBRED, '--network', RED, '--region', region(env), '--range', '10.30.1.0/24']);
  }
  const ipPc = await miIp();
  const reglas = [
    [REGLA_WEB, 'tcp:80,tcp:443', '0.0.0.0/0'],
    [REGLA_SSH, 'tcp:22', `${ipPc}/32`],
  ];
  for (const [nombre, permitido, origen] of reglas) {
    if (!gcp(env, ['compute', 'firewall-rules', 'describe', nombre], { permitirFallo: true })) {
      gcp(env, ['compute', 'firewall-rules', 'create', nombre, '--network', RED, '--direction', 'INGRESS', '--allow', permitido, '--source-ranges', origen]);
    }
  }
  await abrirSshGoogle(env);
  ok(`${REGLA_WEB}: 80 y 443 desde internet; ${REGLA_SSH}: 22 solo desde ${ipPc}`);
  if (!ipGoogle(env)) gcp(env, ['compute', 'addresses', 'create', IP, '--region', region(env)]);
  const ip = ipGoogle(env);
  ok(`IP fija ${ip}`);

  paso(`Máquina ${VM} (${tipo}, Ubuntu 24.04 LTS)`);
  if (estadoGoogle(env)) {
    ok(`${VM} ya existe (${estadoGoogle(env)}): no se toca`);
  } else {
    const archivo = join(tmpdir(), `supervision-cloud-init-google-${process.pid}.yaml`);
    writeFileSync(archivo, cloudInitConUsuario(asegurarClave(env)), 'utf8');
    gcp(env, [
      'compute', 'instances', 'create', VM, '--zone', zona(env), '--machine-type', tipo,
      '--image-family', 'ubuntu-2404-lts-amd64', '--image-project', 'ubuntu-os-cloud',
      '--boot-disk-size', '30GB', '--boot-disk-type', 'pd-balanced',
      '--subnet', SUBRED, '--address', ip,
      // Materiales e IA no llaman a APIs de Google: la máquina va sin cuenta de servicio
      '--no-service-account', '--no-scopes',
      '--metadata-from-file', `user-data=${archivo}`,
    ]);
    ok(`${VM} creada; cloud-init instala Docker (unos minutos)`);
  }

  paso('Versión de MongoDB según el kernel');
  olvidarHuella(ip);
  fijarSshConfig('google', ip, env);
  await esperarSsh('google');
  const kernel = remoto('google', 'uname -r');
  const [mayor, menor] = kernel.split(/[.-]/).map(Number);
  // MongoDB 8.0 no arranca con kernel 6.19 o más (SERVER-125742): ahí va mongo:7.0, como en el CI de IA
  const imagen = mayor > 6 || (mayor === 6 && menor >= 19) ? 'mongo:7.0' : 'mongo:8.0';
  fijarEnv({ MONGO_IMAGEN: imagen });
  ok(`kernel ${kernel}: MONGO_IMAGEN=${imagen} en nube/.env`);

  paso('Presupuesto');
  if (!variable('NUBE_ALERTAS_CORREO', env)) {
    aviso('sin NUBE_ALERTAS_CORREO en nube/.env: no se crea el presupuesto. En la prueba gratuita Google no cobra a la tarjeta ' +
      'mientras no se active la cuenta completa: al acabarse los créditos, detiene los recursos.');
  } else {
    aviso('presupuesto de Google: créalo en la consola (Facturación → Presupuestos y alertas); los avisos llegan a los ' +
      'administradores de la cuenta de facturación.');
  }
}

export async function encenderGoogle() {
  const env = leerEnv();
  sesion();
  if (!estadoGoogle(env)) detener(`No existe ${VM}: corre «crear google».`);
  gcp(env, ['compute', 'instances', 'start', VM, '--zone', zona(env)]);
  ok(`${VM} encendida`);
  await abrirSshGoogle(env);
}

export function apagarGoogle() {
  const env = leerEnv();
  sesion();
  gcp(env, ['compute', 'instances', 'stop', VM, '--zone', zona(env)]);
  ok(`${VM} apagada (detenida: no cobra cómputo)`);
}
