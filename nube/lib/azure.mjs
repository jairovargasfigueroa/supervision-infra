// 602 · Azure: crea la máquina vm-plataforma (y su red, IP fija y reglas), la enciende, la apaga (desasignada) y dice
// su estado. Usa la CLI de Azure con la sesión de «az login». Diseño de la 602, «Qué crea cada nube».
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  NUBE,
  USUARIO,
  asegurarClave,
  aviso,
  detener,
  ejecutar,
  esperar,
  leerEnv,
  miIp,
  ok,
  paso,
  variable,
} from './comun.mjs';

const VM = 'vm-plataforma';
const NSG = 'nsg-plataforma';
const IP = 'ip-plataforma';
const RED = 'vnet-plataforma';
const NIC = 'nic-plataforma';
const PRESUPUESTO = 'presupuesto-supervision';

const az = (argumentos, opciones = {}) => ejecutar('az', [...argumentos, '--only-show-errors'], opciones);
const grupo = (env) => variable('AZURE_GRUPO', env) || 'rg-supervision';
// La suscripción de prueba no permite máquinas pequeñas en brazilsouth ni en eastus (602, decisión 8)
const region = (env) => variable('AZURE_REGION', env) || 'northcentralus';

function sesion() {
  const cuenta = az(['account', 'show', '-o', 'json'], { json: true, permitirFallo: true });
  if (!cuenta) detener('No hay sesión de Azure: corre «az login» (en el navegador, con la cuenta de los créditos).');
  return cuenta;
}

/** IP pública fija de la máquina (vacío si todavía no existe). */
export function ipAzure(env = leerEnv()) {
  return az(['network', 'public-ip', 'show', '-g', grupo(env), '-n', IP, '--query', 'ipAddress', '-o', 'tsv'], {
    permitirFallo: true,
  }) ?? '';
}

/** Estado de la máquina («VM running», «VM deallocated»…) o null si no existe. */
export function estadoAzure(env = leerEnv()) {
  const estados = az(
    ['vm', 'get-instance-view', '-g', grupo(env), '-n', VM, '--query', 'instanceView.statuses[].displayStatus', '-o', 'json'],
    { json: true, permitirFallo: true },
  );
  return estados ? (estados.find((e) => e.startsWith('VM ')) ?? estados.join(', ')) : null;
}

/** Abre el 22 solo para la IP actual de esta PC. */
export async function abrirSshAzure(env = leerEnv()) {
  const ip = await miIp();
  az(['network', 'nsg', 'rule', 'update', '-g', grupo(env), '--nsg-name', NSG, '-n', 'ssh', '--source-address-prefixes', `${ip}/32`, '-o', 'none']);
  ok(`SSH de Azure abierto solo para ${ip}`);
}

export async function crearAzure() {
  const env = leerEnv();
  const cuenta = sesion();
  ok(`suscripción «${cuenta.name}» (${cuenta.user?.name})`);
  const g = grupo(env);
  const r = region(env);

  paso('Proveedores de recursos (una vez por suscripción)');
  for (const proveedor of ['Microsoft.Compute', 'Microsoft.Network', 'Microsoft.Storage', 'Microsoft.Consumption']) {
    const estado = az(['provider', 'show', '-n', proveedor, '--query', 'registrationState', '-o', 'tsv']);
    if (estado !== 'Registered') {
      az(['provider', 'register', '-n', proveedor, '--wait']);
    }
    ok(`${proveedor} registrado`);
  }

  paso(`Cuota de la familia B en ${r}`);
  const tamano = variable('AZURE_TAMANO', env) || 'Standard_B2als_v2';
  const usos = az(['vm', 'list-usage', '-l', r, '-o', 'json'], { json: true });
  for (const nombre of ['cores', 'standardBSFamily']) {
    const uso = usos.find((u) => u.name.value === nombre);
    if (uso) ok(`${uso.localName}: ${uso.currentValue} de ${uso.limit} vCPU`);
    if (uso && Number(uso.limit) - Number(uso.currentValue) < 2) {
      detener(`No alcanza la cuota de vCPU (${uso.localName}) en ${r} para ${tamano}: pide más cuota en el portal.`);
    }
  }

  paso('Grupo de recursos, red, reglas e IP fija');
  az(['group', 'create', '-n', g, '-l', r, '-o', 'none']);
  ok(`grupo ${g} en ${r}`);
  if (az(['network', 'nsg', 'show', '-g', g, '-n', NSG, '--query', 'name', '-o', 'tsv'], { permitirFallo: true }) === null) {
    az(['network', 'nsg', 'create', '-g', g, '-n', NSG, '-l', r, '-o', 'none']);
  }
  const ipPc = await miIp();
  const reglas = [
    ['web', '100', ['80', '443'], 'Internet'],
    ['amqps', '110', ['5671'], 'Internet'],
    ['ssh', '120', ['22'], `${ipPc}/32`],
  ];
  for (const [nombre, prioridad, puertos, origen] of reglas) {
    const argumentos = [
      'network', 'nsg', 'rule', 'create', '-g', g, '--nsg-name', NSG, '-n', nombre, '--priority', prioridad,
      '--direction', 'Inbound', '--access', 'Allow', '--protocol', 'Tcp', '--source-address-prefixes', origen,
      '--destination-port-ranges', ...puertos, '-o', 'none',
    ];
    // Recién creado, el NSG puede tardar unos segundos en verse (ResourceNotFound): se reintenta
    for (let intento = 1; az(argumentos, { permitirFallo: intento < 5 }) === null; intento++) await esperar(10_000);
  }
  ok(`${NSG}: 80, 443 y 5671 desde internet; 22 solo desde ${ipPc}`);
  if (az(['network', 'vnet', 'show', '-g', g, '-n', RED, '--query', 'name', '-o', 'tsv'], { permitirFallo: true }) === null) {
    az([
      'network', 'vnet', 'create', '-g', g, '-n', RED, '-l', r, '--address-prefixes', '10.20.0.0/16',
      '--subnet-name', 'principal', '--subnet-prefixes', '10.20.1.0/24', '-o', 'none',
    ]);
  }
  if (!ipAzure(env)) {
    az(['network', 'public-ip', 'create', '-g', g, '-n', IP, '-l', r, '--sku', 'Standard', '--allocation-method', 'Static', '--version', 'IPv4', '-o', 'none']);
  }
  ok(`IP fija ${ipAzure(env)}`);
  if (az(['network', 'nic', 'show', '-g', g, '-n', NIC, '--query', 'name', '-o', 'tsv'], { permitirFallo: true }) === null) {
    az([
      'network', 'nic', 'create', '-g', g, '-n', NIC, '-l', r, '--vnet-name', RED, '--subnet', 'principal',
      '--network-security-group', NSG, '--public-ip-address', IP, '-o', 'none',
    ]);
  }

  paso(`Máquina ${VM} (${tamano}, Ubuntu 24.04 LTS)`);
  if (estadoAzure(env)) {
    ok(`${VM} ya existe (${estadoAzure(env)}): no se toca`);
  } else {
    const clavePublica = asegurarClave(env);
    const datos = join(tmpdir(), `supervision-cloud-init-azure-${process.pid}.yaml`);
    writeFileSync(datos, readFileSync(join(NUBE, 'maquina', 'cloud-init.yaml'), 'utf8'), 'utf8');
    az([
      'vm', 'create', '-g', g, '-n', VM, '-l', r, '--nics', NIC, '--image', 'Canonical:ubuntu-24_04-lts:server:latest',
      '--size', tamano, '--admin-username', USUARIO, '--ssh-key-values', clavePublica, '--authentication-type', 'ssh',
      '--os-disk-size-gb', '32', '--storage-sku', 'StandardSSD_LRS', '--custom-data', datos, '-o', 'none',
    ]);
    ok(`${VM} creada; cloud-init instala Docker (unos minutos)`);
  }

  paso('Presupuesto mensual con avisos');
  presupuesto(env, cuenta.id);
}

function presupuesto(env, suscripcion) {
  const correo = variable('NUBE_ALERTAS_CORREO', env);
  if (!correo) {
    aviso('sin NUBE_ALERTAS_CORREO en nube/.env: no se crea el presupuesto (agrégalo y vuelve a correr «crear azure»)');
    return;
  }
  const monto = Number(variable('AZURE_PRESUPUESTO', env) || 50);
  const hoy = new Date();
  const inicio = `${hoy.getUTCFullYear()}-${String(hoy.getUTCMonth() + 1).padStart(2, '0')}-01T00:00:00Z`;
  const avisoAl = (umbral) => ({ enabled: true, operator: 'GreaterThanOrEqualTo', threshold: umbral, contactEmails: [correo], thresholdType: 'Actual' });
  const cuerpo = {
    properties: {
      category: 'Cost',
      amount: monto,
      timeGrain: 'Monthly',
      timePeriod: { startDate: inicio },
      notifications: { al50: avisoAl(50), al80: avisoAl(80), al100: avisoAl(100) },
    },
  };
  const archivo = join(tmpdir(), `supervision-presupuesto-${process.pid}.json`);
  writeFileSync(archivo, JSON.stringify(cuerpo), 'utf8');
  const url = `https://management.azure.com/subscriptions/${suscripcion}/providers/Microsoft.Consumption/budgets/${PRESUPUESTO}?api-version=2023-05-01`;
  const resultado = az(['rest', '--method', 'put', '--url', url, '--body', `@${archivo}`, '-o', 'none'], { permitirFallo: true });
  if (resultado === null) {
    aviso('Azure no dejó crear el presupuesto por la CLI. Créalo en el portal: Cost Management → Presupuestos → Agregar ' +
      `(mensual, $${monto}, avisos al 50, 80 y 100 % a ${correo}). La cuenta de prueba ya tiene además el límite de gasto.`);
  } else {
    ok(`presupuesto de $${monto} al mes con avisos al 50, 80 y 100 % a ${correo}`);
  }
}

export async function encenderAzure() {
  const env = leerEnv();
  sesion();
  az(['vm', 'start', '-g', grupo(env), '-n', VM, '-o', 'none']);
  ok(`${VM} encendida`);
  await abrirSshAzure(env);
}

export function apagarAzure() {
  const env = leerEnv();
  sesion();
  // Desasignar (no solo detener): una máquina detenida sin desasignar sigue cobrando el cómputo
  az(['vm', 'deallocate', '-g', grupo(env), '-n', VM, '-o', 'none']);
  ok(`${VM} apagada (desasignada: no cobra cómputo)`);
}
