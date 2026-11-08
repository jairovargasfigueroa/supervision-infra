// Prueba de integración de la base de reportes (401) contra lo que está corriendo:
//   1. Eventos: registra una obra (con zona) por Obras, el residente elabora y presenta la planilla del mes, el
//      cliente la aprueba (saga 008) y comprueba en reportes_db rpt_obra_resumen, rpt_planilla y rpt_cobro.
//   2. Carga inicial (con --carga): corre ia-carga-inicial dos veces con el cliente ia-reportes real y comprueba que
//      las obras de los datos de prueba (011) están en reportes_db con el mismo avance que Obras y con tantas
//      planillas, cobros y movimientos como tienen en ese momento Obras, Finanzas y Materiales (no números fijos: una
//      prueba manual puede haber aprobado otra planilla), y que la segunda corrida no duplica filas ni suma dos veces
//      el consumo.
// Necesita: Obras, Materiales y Finanzas (con su consumidor y su publicador) y el servicio de IA (ia-worker) corriendo;
// reportes_db migrada; para --carga, los datos de prueba cargados (./semilla/semilla.*). Lee reportes_db con el
// servicio psql-cli (perfil herramientas, solo SELECT). Crea datos («Prueba reportes 401 …»): solo en desarrollo.
// Uso: node pruebas/reportes.mjs [--carga] [--solo-carga]
//      (variables opcionales: OBRAS_URL, MATERIALES_URL, FINANZAS_URL; CARGA_INICIAL = comando de la carga, por
//      defecto el servicio del Compose)
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { obtenerTokenUsuario } from './token-usuario.mjs';

const INFRA = fileURLToPath(new URL('..', import.meta.url));
const OBRAS = process.env.OBRAS_URL ?? 'http://localhost:8081';
const MATERIALES = process.env.MATERIALES_URL ?? 'http://localhost:8082';
const FINANZAS = process.env.FINANZAS_URL ?? 'http://localhost:8083';
const PORTAL = 'http://localhost:4300/';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OBRAS_SEMILLA = [1, 2, 3].map((n) => `b0000000-0000-4000-8000-00000000000${n}`);
const conCarga = process.argv.includes('--carga') || process.argv.includes('--solo-carga');
const soloCarga = process.argv.includes('--solo-carga');

const resultados = [];
function comprobar(nombre, ok, detalle = '') {
  resultados.push(ok);
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre}${detalle ? ` · ${detalle}` : ''}`);
}
const esperar = (ms) => new Promise((listo) => setTimeout(listo, ms));
const numero = (valor) => (valor === null || valor === undefined || valor === '' ? null : Number(valor));

async function rest(metodo, ruta, token, cuerpo, base = OBRAS) {
  const respuesta = await fetch(base + ruta, {
    method: metodo,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await respuesta.text();
  return { estado: respuesta.status, json: texto ? JSON.parse(texto) : null };
}

/** Filas de una consulta (solo SELECT) en reportes_db, como objetos con las columnas pedidas. */
function consultar(sql, columnas) {
  const salida = spawnSync(
    'docker',
    ['compose', '--profile', 'herramientas', 'run', '--rm', '--no-TTY', 'psql-cli', '-tA', '-F', '\t', '-c', sql],
    { cwd: INFRA, encoding: 'utf8' },
  );
  if (salida.status !== 0) throw new Error(`psql-cli: ${salida.stderr || salida.stdout}`);
  return salida.stdout
    .split(/\r?\n/)
    .filter((linea) => linea && !/^\s*Container /.test(linea))
    .map((linea) => Object.fromEntries(linea.split('\t').map((valor, i) => [columnas[i], valor === '' ? null : valor])));
}

/** Espera (cada segundo, hasta `segundos`) a que la consulta devuelva una fila que cumpla `condicion`. */
async function esperarFila(sql, columnas, condicion, segundos) {
  const fin = Date.now() + segundos * 1000;
  let filas = [];
  do {
    filas = consultar(sql, columnas);
    const fila = filas.find(condicion);
    if (fila) return fila;
    await esperar(1000);
  } while (Date.now() < fin);
  return filas[0] ?? null;
}

const admin = await obtenerTokenUsuario('admin1');
const gerente = await obtenerTokenUsuario('gerente1');

// --- 1. Eventos: registrar obra y aprobar planilla ---
if (!soloCarga) {
  const residente = await obtenerTokenUsuario('residente1');
  const cliente = await obtenerTokenUsuario('cliente1', 'Prueba123!', 'portal', PORTAL);
  const periodo = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit' })
    .format(new Date())
    .slice(0, 7);
  const RESIDENTE = 'a0000000-0000-4000-8000-000000000003';
  const CLIENTE = 'a0000000-0000-4000-8000-000000000007';

  const registro = await rest('POST', '/obras', admin, {
    nombre: `Prueba reportes 401 ${new Date().toISOString().slice(0, 19)}`,
    ubicacion: 'Av. Banzer 4to anillo, Santa Cruz',
    zona: 'NORTE',
    fechaInicio: `${periodo}-01`,
    asignaciones: {
      residenteId: RESIDENTE,
      maestroId: 'a0000000-0000-4000-8000-000000000005',
      almaceneroId: 'a0000000-0000-4000-8000-000000000006',
      clienteId: CLIENTE,
    },
    contrato: { monto: 100000, plazoDias: 120, anticipoPct: 10, retencionPct: 7, firmadoEn: `${periodo}-01` },
    partidas: [
      { codigo: 'P-01', nombre: 'Excavación', unidad: 'm3', cantidadContratada: 200, precioUnitario: 150 },
      { codigo: 'P-02', nombre: 'Losa', unidad: 'm2', cantidadContratada: 100, precioUnitario: 700 },
    ],
  });
  const obraId = registro.json?.id;
  comprobar('obra registrada con zona NORTE', registro.estado === 201 && registro.json?.zona === 'NORTE', `${registro.estado} ${obraId ?? ''}`);
  if (!UUID.test(obraId ?? '')) process.exit(1);
  const registradaEn = Date.now();

  const COLUMNAS_OBRA = ['nombre', 'ubicacion', 'zona', 'clienteId', 'residenteId', 'estado', 'fechaInicio', 'plazoDias', 'montoContrato', 'avancePct', 'plazoPct'];
  const sqlObra = `select nombre, ubicacion, zona, cliente_id, residente_id, estado, fecha_inicio, plazo_dias, monto_contrato,
    avance_pct, plazo_pct from rpt_obra_resumen where obra_id = '${obraId}'`;
  const fila = await esperarFila(sqlObra, COLUMNAS_OBRA, () => true, 10);
  const segundos = ((Date.now() - registradaEn) / 1000).toFixed(1);
  comprobar('la obra aparece en rpt_obra_resumen en menos de 10 s (criterio 3)', Boolean(fila), `${segundos} s`);
  comprobar(
    'rpt_obra_resumen con nombre, ubicación, zona, cliente, residente, inicio, plazo, monto y avance 0',
    fila?.nombre === registro.json.nombre && fila?.ubicacion === 'Av. Banzer 4to anillo, Santa Cruz' && fila?.zona === 'NORTE' &&
      fila?.clienteId === CLIENTE && fila?.residenteId === RESIDENTE && fila?.fechaInicio === `${periodo}-01` &&
      numero(fila?.plazoDias) === 120 && numero(fila?.montoContrato) === 100000 && numero(fila?.avancePct) === 0 &&
      fila?.plazoPct !== null,
    JSON.stringify(fila),
  );

  let obra;
  for (let i = 0; i < 30; i++) {
    obra = (await rest('GET', `/obras/${obraId}`, admin)).json;
    if (obra?.estado === 'EN_EJECUCION') break;
    await esperar(1000);
  }
  comprobar('contrato registrado en Finanzas (obra en ejecución)', obra?.estado === 'EN_EJECUCION', obra?.estado);
  const enEjecucion = await esperarFila(sqlObra, COLUMNAS_OBRA, (f) => f.estado === 'EN_EJECUCION', 10);
  comprobar('rpt_obra_resumen queda EN_EJECUCION con ContratoRegistrado (criterio 4)', enEjecucion?.estado === 'EN_EJECUCION', enEjecucion?.estado);

  // El residente elabora y presenta la planilla del mes; el cliente la aprueba desde el portal (saga 008)
  const creada = await rest('POST', `/obras/${obraId}/planillas`, residente, { periodo });
  const planillaId = creada.json?.id;
  comprobar('planilla creada', creada.estado === 201 && UUID.test(planillaId ?? ''), `${creada.estado}`);
  if (!UUID.test(planillaId ?? '')) process.exit(1);
  const [p1, p2] = [...obra.partidas].sort((a, b) => a.codigo.localeCompare(b.codigo));
  const guardada = await rest('PUT', `/planillas/${planillaId}`, residente, {
    version: 0,
    lineas: [
      { partidaId: p1.id, cantidadPeriodo: 80 },
      { partidaId: p2.id, cantidadPeriodo: 10 },
    ],
    fotoIds: [],
  });
  // subtotal 80 × 150 + 10 × 700 = 19 000; − 10 % − 7 % = 15 770
  comprobar('planilla guardada (neto 15 770)', guardada.json?.neto === 15770, `${guardada.estado} ${guardada.json?.neto}`);
  const presentada = await rest('POST', `/planillas/${planillaId}/presentar`, residente, { version: 1 });
  comprobar('planilla presentada', presentada.json?.estado === 'PRESENTADA', `${presentada.estado}`);
  const aprobar = await rest('POST', `/planillas/${planillaId}/aprobar`, cliente);
  comprobar('aprobar → 202', aprobar.estado === 202, `${aprobar.estado}`);

  const inicio = Date.now();
  let planilla;
  do {
    await esperar(2000);
    planilla = (await rest('GET', `/planillas/${planillaId}`, cliente)).json;
  } while (planilla?.estado === 'APROBANDO' && Date.now() - inicio < 90000);
  comprobar('saga terminada: planilla APROBADA con su cobro', planilla?.estado === 'APROBADA' && UUID.test(planilla?.cobroId ?? ''), `${planilla?.estado} ${planilla?.cobroNumero ?? ''}`);

  const COLUMNAS_PLANILLA = ['estado', 'periodo', 'neto', 'montoPeriodo', 'avancePeriodoPct', 'aprobadaEn'];
  const filaPlanilla = await esperarFila(
    `select estado, periodo, neto, monto_periodo, avance_periodo_pct, aprobada_en from rpt_planilla where planilla_id = '${planillaId}'`,
    COLUMNAS_PLANILLA,
    (f) => f.estado === 'APROBADA',
    10,
  );
  comprobar(
    'rpt_planilla APROBADA con periodo, neto 15 770, monto del periodo 19 000 y avance 19 % (criterio 5)',
    filaPlanilla?.estado === 'APROBADA' && filaPlanilla?.periodo === periodo && numero(filaPlanilla?.neto) === 15770 &&
      numero(filaPlanilla?.montoPeriodo) === 19000 && numero(filaPlanilla?.avancePeriodoPct) === 19 && filaPlanilla?.aprobadaEn !== null,
    JSON.stringify(filaPlanilla),
  );
  const avanceObras = (await rest('GET', `/obras/${obraId}`, admin)).json?.avancePct;
  const filaAvance = await esperarFila(sqlObra, COLUMNAS_OBRA, (f) => numero(f.avancePct) === avanceObras, 10);
  comprobar('el avance de rpt_obra_resumen coincide con el de Obras (criterio 5)', numero(filaAvance?.avancePct) === avanceObras, `IA ${filaAvance?.avancePct} · Obras ${avanceObras}`);

  if (UUID.test(planilla?.cobroId ?? '')) {
    const filaCobro = await esperarFila(
      `select numero, obra_id, planilla_id, cliente_id, zona, monto, emitido_en, vence_en, estado from rpt_cobro where cobro_id = '${planilla.cobroId}'`,
      ['numero', 'obraId', 'planillaId', 'clienteId', 'zona', 'monto', 'emitidoEn', 'venceEn', 'estado'],
      (f) => f.numero !== null && f.obraId !== null,
      10,
    );
    comprobar(
      'rpt_cobro con número, obra, planilla, cliente, zona, monto, emisión, vencimiento y PENDIENTE (criterio 6)',
      filaCobro?.numero === planilla.cobroNumero && filaCobro?.obraId === obraId && filaCobro?.planillaId === planillaId &&
        filaCobro?.clienteId === CLIENTE && filaCobro?.zona === 'NORTE' && numero(filaCobro?.monto) === 15770 &&
        filaCobro?.emitidoEn !== null && filaCobro?.venceEn !== null && filaCobro?.estado === 'PENDIENTE',
      JSON.stringify(filaCobro),
    );
  }
}

// --- 2. Carga inicial con el cliente ia-reportes real ---
function correrCarga() {
  const comando = process.env.CARGA_INICIAL;
  const salida = comando
    ? spawnSync(comando, { cwd: INFRA, shell: true, encoding: 'utf8' })
    : spawnSync('docker', ['compose', '--profile', 'ia-carga', 'run', '--rm', '--no-TTY', 'ia-carga-inicial'], { cwd: INFRA, encoding: 'utf8' });
  return { codigo: salida.status, texto: `${salida.stdout ?? ''}${salida.stderr ?? ''}` };
}

function fotoDeLaSemilla() {
  const lista = OBRAS_SEMILLA.map((id) => `'${id}'`).join(', ');
  const cuenta = (tabla) => `(select count(*) from ${tabla} where obra_id in (${lista}))`;
  const [fila] = consultar(
    `select ${cuenta('rpt_obra_resumen')}, ${cuenta('rpt_planilla')}, ${cuenta('rpt_cobro')}, ${cuenta('rpt_movimiento')},
      (select coalesce(sum(cantidad), 0) from rpt_consumo_material where obra_id in (${lista})),
      (select coalesce(sum(monto), 0) from rpt_consumo_material where obra_id in (${lista})),
      (select estado from carga_inicial order by iniciada_en desc limit 1)`,
    ['obras', 'planillas', 'cobros', 'movimientos', 'consumoCantidad', 'consumoMonto', 'ultimaCarga'],
  );
  return fila;
}

/**
 * Lo que la carga inicial debe traer de las obras de la semilla, leído de los dueños en este momento (criterio 17):
 * planillas APROBADA u OBSERVADA, más las de otro estado que tienen observación (se cargan como OBSERVADA, diseño,
 * «Qué escribe y cómo», paso 3); cobros de Finanzas; movimientos de Materiales (404 OBRA_NO_ENCONTRADA = ninguno).
 */
async function esperadoDeLosServicios() {
  const esperado = { planillas: 0, cobros: 0, movimientos: 0 };
  for (const id of OBRAS_SEMILLA) {
    const planillas = await rest('GET', `/obras/${id}/planillas`, gerente);
    if (planillas.estado !== 200) throw new Error(`Obras GET /obras/${id}/planillas: ${planillas.estado}`);
    for (const planilla of planillas.json) {
      if (['APROBADA', 'OBSERVADA'].includes(planilla.estado)) {
        esperado.planillas++;
        continue;
      }
      const detalle = await rest('GET', `/planillas/${planilla.id}`, gerente);
      if (detalle.estado !== 200) throw new Error(`Obras GET /planillas/${planilla.id}: ${detalle.estado}`);
      if (detalle.json.observacion !== null && detalle.json.observacion !== undefined) esperado.planillas++;
    }
    const cobros = await rest('GET', `/cobros?obraId=${id}&pagina=1&tamano=1`, gerente, undefined, FINANZAS);
    if (cobros.estado !== 200) throw new Error(`Finanzas GET /cobros?obraId=${id}: ${cobros.estado}`);
    esperado.cobros += cobros.json.total;
    const movimientos = await rest('GET', `/obras/${id}/movimientos?pagina=1&tamano=1`, gerente, undefined, MATERIALES);
    if (movimientos.estado === 404 && movimientos.json?.codigo === 'OBRA_NO_ENCONTRADA') continue;
    if (movimientos.estado !== 200) throw new Error(`Materiales GET /obras/${id}/movimientos: ${movimientos.estado}`);
    esperado.movimientos += movimientos.json.total;
  }
  return esperado;
}

if (conCarga) {
  const primera = correrCarga();
  comprobar('la carga inicial termina con código 0', primera.codigo === 0, primera.codigo === 0 ? '' : primera.texto.slice(-800));
  const despues = fotoDeLaSemilla();
  comprobar('carga_inicial TERMINADA', despues?.ultimaCarga === 'TERMINADA', despues?.ultimaCarga);
  let esperado = null;
  try {
    esperado = await esperadoDeLosServicios();
  } catch (error) {
    comprobar('leer de Obras, Finanzas y Materiales lo que deben tener las obras de la semilla', false, error.message);
  }
  comprobar(
    'las 3 obras de los datos de prueba, con las planillas, cobros y movimientos que tienen sus servicios (criterio 17)',
    esperado !== null && numero(despues?.obras) === 3 && numero(despues?.planillas) === esperado.planillas &&
      numero(despues?.cobros) === esperado.cobros && numero(despues?.movimientos) === esperado.movimientos,
    `IA ${JSON.stringify({ planillas: despues?.planillas, cobros: despues?.cobros, movimientos: despues?.movimientos })} · servicios ${JSON.stringify(esperado)}`,
  );

  const obras = (await rest('GET', '/obras', gerente)).json ?? [];
  for (const id of OBRAS_SEMILLA) {
    const deObras = obras.find((o) => o.id === id);
    const [deIa] = consultar(`select avance_pct, zona from rpt_obra_resumen where obra_id = '${id}'`, ['avancePct', 'zona']);
    comprobar(
      `obra ${id.slice(-1)}: avance y zona iguales a los de Obras (criterio 20)`,
      deObras && numero(deIa?.avancePct) === deObras.avancePct && (deIa?.zona ?? null) === (deObras.zona ?? null),
      `IA ${deIa?.avancePct} ${deIa?.zona} · Obras ${deObras?.avancePct} ${deObras?.zona}`,
    );
  }

  const segunda = correrCarga();
  comprobar('la segunda carga termina con código 0', segunda.codigo === 0, segunda.codigo === 0 ? '' : segunda.texto.slice(-800));
  const otraVez = fotoDeLaSemilla();
  const { ultimaCarga: _a, ...antes } = despues ?? {};
  const { ultimaCarga: _b, ...ahora } = otraVez ?? {};
  comprobar('correrla otra vez no duplica filas ni suma dos veces el consumo (criterio 19)', JSON.stringify(antes) === JSON.stringify(ahora), JSON.stringify(ahora));
}

const fallas = resultados.filter((ok) => !ok).length;
console.log(`\n${resultados.length - fallas} de ${resultados.length} comprobaciones correctas`);
process.exit(fallas ? 1 : 0);
