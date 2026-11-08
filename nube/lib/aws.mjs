// 602 · AWS: crea los datos (bucket S3, tablas de DynamoDB, usuario obras-s3, rol de la máquina y presupuesto) y la
// máquina vm-sincronizacion (t3.micro con Elastic IP); la enciende, la apaga y dice su estado. Usa la CLI de AWS con
// el perfil por defecto (usuario IAM jairo-cli) y la región AWS_REGION. Diseño de la 602, «Qué crea cada nube».
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
  exigir,
  fijarEnv,
  leerEnv,
  miIp,
  ok,
  paso,
  variable,
} from './comun.mjs';

const VM = 'vm-sincronizacion';
const GRUPO_SEGURIDAD = 'sg-sincronizacion';
const PAR_CLAVES = 'supervision-nube';
const ROL = 'sincronizacion-ec2';
const USUARIO_S3 = 'obras-s3';
const TABLAS = [
  { nombre: 'operacion_procesada', clave: 'id_operacion', ttl: 'expira_en' },
  { nombre: 'estado_dispositivo', clave: 'id_dispositivo' },
];
const AMI_UBUNTU = '/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id';

// La organización de la cuenta solo permite us-east-2 (su SCP bloquea las demás regiones)
const region = (env) => variable('AWS_REGION', env) || 'us-east-2';
const aws = (env, argumentos, opciones = {}) => ejecutar('aws', [...argumentos, '--region', region(env)], opciones);
const awsJson = (env, argumentos, opciones = {}) => aws(env, [...argumentos, '--output', 'json'], { ...opciones, json: true });
const awsTexto = (env, argumentos, opciones = {}) => aws(env, [...argumentos, '--output', 'text'], opciones);

/** Escribe un JSON en un archivo temporal y devuelve su ruta como file:// (para los documentos de política). */
function archivoJson(nombre, contenido) {
  const ruta = join(tmpdir(), `supervision-${nombre}-${process.pid}.json`);
  writeFileSync(ruta, JSON.stringify(contenido), 'utf8');
  return `file://${ruta}`;
}

function cuenta(env) {
  const identidad = awsJson(env, ['sts', 'get-caller-identity'], { permitirFallo: true });
  if (!identidad) detener('No hay credenciales de AWS: corre «aws configure» con el usuario IAM jairo-cli.');
  return identidad;
}

// --- Datos -------------------------------------------------------------------------------------------------------

export async function crearDatosAws() {
  const env = leerEnv();
  const identidad = cuenta(env);
  ok(`cuenta ${identidad.Account} (${identidad.Arn.split('/').pop()}), región ${region(env)}`);
  const bucket = exigir('S3_BUCKET', env);

  paso(`Bucket S3 ${bucket}`);
  if (aws(env, ['s3api', 'head-bucket', '--bucket', bucket], { permitirFallo: true }) === null) {
    aws(env, ['s3api', 'create-bucket', '--bucket', bucket, '--create-bucket-configuration', `LocationConstraint=${region(env)}`]);
    ok('creado');
  } else {
    ok('ya existe');
  }
  aws(env, [
    's3api', 'put-public-access-block', '--bucket', bucket, '--public-access-block-configuration',
    'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true',
  ]);
  aws(env, [
    's3api', 'put-bucket-encryption', '--bucket', bucket, '--server-side-encryption-configuration',
    archivoJson('cifrado', { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] }),
  ]);
  const origenes = [exigir('ERP_URL', env), exigir('PORTAL_URL', env)];
  aws(env, [
    's3api', 'put-bucket-cors', '--bucket', bucket, '--cors-configuration',
    archivoJson('cors', { CORSRules: [{ AllowedMethods: ['GET', 'HEAD'], AllowedOrigins: origenes, AllowedHeaders: ['*'], MaxAgeSeconds: 3600 }] }),
  ]);
  ok(`privado, cifrado y con CORS GET y HEAD para ${origenes.join(' y ')}`);

  paso('Tablas de DynamoDB (bajo demanda)');
  for (const tabla of TABLAS) {
    if (aws(env, ['dynamodb', 'describe-table', '--table-name', tabla.nombre], { permitirFallo: true }) === null) {
      aws(env, [
        'dynamodb', 'create-table', '--table-name', tabla.nombre, '--billing-mode', 'PAY_PER_REQUEST',
        '--attribute-definitions', `AttributeName=${tabla.clave},AttributeType=S`,
        '--key-schema', `AttributeName=${tabla.clave},KeyType=HASH`,
      ]);
      aws(env, ['dynamodb', 'wait', 'table-exists', '--table-name', tabla.nombre]);
    }
    if (tabla.ttl) {
      const ttl = awsTexto(env, ['dynamodb', 'describe-time-to-live', '--table-name', tabla.nombre, '--query', 'TimeToLiveDescription.TimeToLiveStatus']);
      if (ttl !== 'ENABLED' && ttl !== 'ENABLING') {
        aws(env, ['dynamodb', 'update-time-to-live', '--table-name', tabla.nombre, '--time-to-live-specification', `Enabled=true,AttributeName=${tabla.ttl}`]);
      }
    }
    ok(`${tabla.nombre} (clave ${tabla.clave}${tabla.ttl ? `, TTL en ${tabla.ttl}` : ''})`);
  }

  paso(`Usuario IAM ${USUARIO_S3} (solo fotos/ del bucket)`);
  if (aws(env, ['iam', 'get-user', '--user-name', USUARIO_S3], { permitirFallo: true }) === null) {
    aws(env, ['iam', 'create-user', '--user-name', USUARIO_S3]);
  }
  aws(env, [
    'iam', 'put-user-policy', '--user-name', USUARIO_S3, '--policy-name', 'fotos', '--policy-document',
    archivoJson('politica-obras-s3', {
      Version: '2012-10-17',
      Statement: [
        { Effect: 'Allow', Action: ['s3:PutObject', 's3:GetObject'], Resource: `arn:aws:s3:::${bucket}/fotos/*` },
        { Effect: 'Allow', Action: ['s3:ListBucket'], Resource: `arn:aws:s3:::${bucket}` },
      ],
    }),
  ]);
  if (variable('OBRAS_S3_ACCESS_KEY', env)) {
    ok('su clave de acceso ya está en nube/.env');
  } else {
    const claves = awsJson(env, ['iam', 'list-access-keys', '--user-name', USUARIO_S3]).AccessKeyMetadata;
    if (claves.length >= 2) detener(`${USUARIO_S3} ya tiene 2 claves de acceso: borra una en la consola de IAM y vuelve a correr.`);
    const clave = awsJson(env, ['iam', 'create-access-key', '--user-name', USUARIO_S3], { secreto: true }).AccessKey;
    fijarEnv({ OBRAS_S3_ACCESS_KEY: clave.AccessKeyId, OBRAS_S3_SECRET_KEY: clave.SecretAccessKey });
    ok('clave de acceso creada y guardada en nube/.env (no se muestra)');
  }

  paso(`Rol ${ROL} de la máquina (DynamoDB, sin claves)`);
  if (aws(env, ['iam', 'get-role', '--role-name', ROL], { permitirFallo: true }) === null) {
    aws(env, [
      'iam', 'create-role', '--role-name', ROL, '--assume-role-policy-document',
      archivoJson('confianza-ec2', {
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Principal: { Service: 'ec2.amazonaws.com' }, Action: 'sts:AssumeRole' }],
      }),
    ]);
  }
  const tablasArn = TABLAS.map((t) => `arn:aws:dynamodb:${region(env)}:${identidad.Account}:table/${t.nombre}`);
  aws(env, [
    'iam', 'put-role-policy', '--role-name', ROL, '--policy-name', 'dynamodb', '--policy-document',
    archivoJson('politica-dynamodb', {
      Version: '2012-10-17',
      Statement: [{ Effect: 'Allow', Action: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'], Resource: tablasArn }],
    }),
  ]);
  if (aws(env, ['iam', 'get-instance-profile', '--instance-profile-name', ROL], { permitirFallo: true }) === null) {
    aws(env, ['iam', 'create-instance-profile', '--instance-profile-name', ROL]);
    aws(env, ['iam', 'add-role-to-instance-profile', '--instance-profile-name', ROL, '--role-name', ROL]);
  }
  ok('rol y perfil de instancia listos (GetItem, PutItem, UpdateItem y DeleteItem en las dos tablas)');

  paso('Presupuesto mensual con avisos');
  presupuesto(env, identidad.Account);
}

function presupuesto(env, cuentaId) {
  const correo = variable('NUBE_ALERTAS_CORREO', env);
  if (!correo) {
    aviso('sin NUBE_ALERTAS_CORREO en nube/.env: no se crea el presupuesto (agrégalo y vuelve a correr «crear aws --datos»)');
    return;
  }
  const monto = String(variable('AWS_PRESUPUESTO', env) || 20);
  const existentes = awsJson(env, ['budgets', 'describe-budgets', '--account-id', cuentaId], { permitirFallo: true })?.Budgets ?? [];
  if (existentes.some((b) => b.BudgetName === 'supervision')) {
    ok('el presupuesto «supervision» ya existe');
    return;
  }
  const avisoAl = (umbral) => ({
    Notification: { NotificationType: 'ACTUAL', ComparisonOperator: 'GREATER_THAN', Threshold: umbral, ThresholdType: 'PERCENTAGE' },
    Subscribers: [{ SubscriptionType: 'EMAIL', Address: correo }],
  });
  aws(env, [
    'budgets', 'create-budget', '--account-id', cuentaId,
    '--budget', archivoJson('presupuesto', { BudgetName: 'supervision', BudgetLimit: { Amount: monto, Unit: 'USD' }, TimeUnit: 'MONTHLY', BudgetType: 'COST' }),
    '--notifications-with-subscribers', archivoJson('avisos', [avisoAl(50), avisoAl(80), avisoAl(100)]),
  ]);
  ok(`presupuesto de $${monto} al mes con avisos al 50, 80 y 100 % a ${correo}`);
}

// --- Máquina -------------------------------------------------------------------------------------------------------

/** La instancia vm-sincronizacion (que no esté terminada) o null. */
function instancia(env) {
  const reservas = awsJson(env, [
    'ec2', 'describe-instances', '--filters', `Name=tag:Name,Values=${VM}`,
    'Name=instance-state-name,Values=pending,running,stopping,stopped',
  ]).Reservations;
  return reservas.flatMap((r) => r.Instances)[0] ?? null;
}

function grupoSeguridad(env) {
  return awsJson(env, ['ec2', 'describe-security-groups', '--filters', `Name=group-name,Values=${GRUPO_SEGURIDAD}`]).SecurityGroups[0] ?? null;
}

/** Elastic IP de la máquina (vacío si no hay). */
export function ipAws(env = leerEnv()) {
  const direcciones = awsJson(env, ['ec2', 'describe-addresses', '--filters', `Name=tag:Name,Values=ip-sincronizacion`], { permitirFallo: true });
  return direcciones?.Addresses?.[0]?.PublicIp ?? '';
}

export function estadoAws(env = leerEnv()) {
  const datos = instancia(env);
  return datos ? `${datos.State.Name} (${datos.InstanceType})` : null;
}

/** Deja el 22 abierto solo para la IP actual de esta PC. */
export async function abrirSshAws(env = leerEnv()) {
  const grupo = grupoSeguridad(env);
  if (!grupo) detener(`No existe ${GRUPO_SEGURIDAD}: corre «crear aws».`);
  const ip = await miIp();
  const actuales = grupo.IpPermissions.filter((p) => p.FromPort === 22).flatMap((p) => p.IpRanges.map((r) => r.CidrIp));
  for (const cidr of actuales.filter((c) => c !== `${ip}/32`)) {
    aws(env, ['ec2', 'revoke-security-group-ingress', '--group-id', grupo.GroupId, '--protocol', 'tcp', '--port', '22', '--cidr', cidr]);
  }
  if (!actuales.includes(`${ip}/32`)) {
    aws(env, ['ec2', 'authorize-security-group-ingress', '--group-id', grupo.GroupId, '--protocol', 'tcp', '--port', '22', '--cidr', `${ip}/32`]);
  }
  ok(`SSH de AWS abierto solo para ${ip}`);
}

/** cloud-init con el usuario supervision y la clave SSH (en AWS el usuario por defecto es ubuntu). */
export function cloudInitConUsuario(clavePublica) {
  const usuario = [
    'users:',
    '  - default',
    `  - name: ${USUARIO}`,
    '    groups: [sudo]',
    '    sudo: "ALL=(ALL) NOPASSWD:ALL"',
    '    shell: /bin/bash',
    '    ssh_authorized_keys:',
    `      - ${clavePublica}`,
  ].join('\n');
  return readFileSync(join(NUBE, 'maquina', 'cloud-init.yaml'), 'utf8').replace(/^# __USUARIO__.*$/m, usuario);
}

export async function crearMaquinaAws() {
  const env = leerEnv();
  cuenta(env);
  const tipo = variable('AWS_TIPO', env) || 't3.micro';
  const clavePublica = asegurarClave(env);

  paso('Par de claves y grupo de seguridad');
  if (aws(env, ['ec2', 'describe-key-pairs', '--key-names', PAR_CLAVES], { permitirFallo: true }) === null) {
    const archivo = join(tmpdir(), `supervision-clave-${process.pid}.pub`);
    writeFileSync(archivo, `${clavePublica}\n`, 'utf8');
    aws(env, ['ec2', 'import-key-pair', '--key-name', PAR_CLAVES, '--public-key-material', `fileb://${archivo}`]);
  }
  ok(`par de claves ${PAR_CLAVES}`);
  let grupo = grupoSeguridad(env);
  if (!grupo) {
    const vpc = awsTexto(env, ['ec2', 'describe-vpcs', '--filters', 'Name=isDefault,Values=true', '--query', 'Vpcs[0].VpcId']);
    if (!vpc || vpc === 'None') detener(`No hay VPC por defecto en ${region(env)}: créala en la consola de VPC («Create default VPC»).`);
    aws(env, ['ec2', 'create-security-group', '--group-name', GRUPO_SEGURIDAD, '--description', 'Sincronizacion: 80 y 443; 22 solo desde la IP de Jairo', '--vpc-id', vpc]);
    grupo = grupoSeguridad(env);
    for (const puerto of ['80', '443']) {
      aws(env, ['ec2', 'authorize-security-group-ingress', '--group-id', grupo.GroupId, '--protocol', 'tcp', '--port', puerto, '--cidr', '0.0.0.0/0']);
    }
  }
  await abrirSshAws(env);

  paso(`Máquina ${VM} (${tipo}, Ubuntu 24.04 LTS)`);
  let datos = instancia(env);
  if (datos) {
    ok(`${VM} ya existe (${datos.State.Name}): no se toca`);
  } else {
    const ami = awsTexto(env, ['ssm', 'get-parameter', '--name', AMI_UBUNTU, '--query', 'Parameter.Value']);
    const archivo = join(tmpdir(), `supervision-cloud-init-aws-${process.pid}.yaml`);
    writeFileSync(archivo, cloudInitConUsuario(clavePublica), 'utf8');
    const argumentos = [
      'ec2', 'run-instances', '--image-id', ami, '--instance-type', tipo, '--key-name', PAR_CLAVES,
      '--security-group-ids', grupo.GroupId, '--iam-instance-profile', `Name=${ROL}`,
      '--metadata-options', 'HttpTokens=required,HttpPutResponseHopLimit=2,HttpEndpoint=enabled',
      // Créditos de CPU «standard»: sin cobros extra si la CPU se queda alta
      '--credit-specification', 'CpuCredits=standard',
      '--block-device-mappings', 'DeviceName=/dev/sda1,Ebs={VolumeSize=16,VolumeType=gp3,DeleteOnTermination=true}',
      '--user-data', `file://${archivo}`,
      '--tag-specifications', `ResourceType=instance,Tags=[{Key=Name,Value=${VM}}]`,
    ];
    // El perfil de instancia recién creado tarda unos segundos en verse desde EC2
    for (let intento = 1; ; intento++) {
      const resultado = aws(env, argumentos, { permitirFallo: intento < 6 });
      if (resultado !== null) break;
      await esperar(10_000);
    }
    aws(env, ['ec2', 'wait', 'instance-running', '--filters', `Name=tag:Name,Values=${VM}`]);
    datos = instancia(env);
    ok(`${VM} creada (${datos.InstanceId}); cloud-init instala Docker (unos minutos)`);
  }

  paso('Elastic IP');
  let ip = ipAws(env);
  if (!ip) {
    const asignacion = awsJson(env, ['ec2', 'allocate-address', '--domain', 'vpc', '--tag-specifications', 'ResourceType=elastic-ip,Tags=[{Key=Name,Value=ip-sincronizacion}]']);
    ip = asignacion.PublicIp;
  }
  const direccion = awsJson(env, ['ec2', 'describe-addresses', '--public-ips', ip]).Addresses[0];
  if (direccion.InstanceId !== datos.InstanceId) {
    aws(env, ['ec2', 'associate-address', '--instance-id', datos.InstanceId, '--allocation-id', direccion.AllocationId]);
  }
  ok(`IP fija ${ip}`);
}

export async function encenderAws() {
  const env = leerEnv();
  const datos = instancia(env);
  if (!datos) detener(`No existe ${VM}: corre «crear aws».`);
  if (datos.State.Name !== 'running') {
    aws(env, ['ec2', 'start-instances', '--instance-ids', datos.InstanceId]);
    aws(env, ['ec2', 'wait', 'instance-running', '--instance-ids', datos.InstanceId]);
  }
  ok(`${VM} encendida`);
  await abrirSshAws(env);
}

export function apagarAws() {
  const env = leerEnv();
  const datos = instancia(env);
  if (!datos) detener(`No existe ${VM}.`);
  aws(env, ['ec2', 'stop-instances', '--instance-ids', datos.InstanceId]);
  aws(env, ['ec2', 'wait', 'instance-stopped', '--instance-ids', datos.InstanceId]);
  ok(`${VM} apagada`);
}
