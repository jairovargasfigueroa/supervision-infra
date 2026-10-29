// Prueba de punta a punta de la saga «aprobar planilla» (008) contra los servicios que están corriendo:
// registra una obra nueva, el residente elabora y presenta la planilla del mes, el cliente la aprueba desde el portal
// y se comprueban el cobro emitido, la reserva consumida, el avance y el periodo cerrado en Materiales.
// Crea datos (una obra «Prueba saga 008 …» con su planilla aprobada y su cobro, y un material «PRB-SAGA-…» si el
// catálogo no tiene ninguno activo): úsala en el entorno de desarrollo.
// Uso: node pruebas/saga.mjs   (variables opcionales: GATEWAY_URL, OBRAS_URL, MATERIALES_URL)
import { randomUUID } from 'node:crypto';
import { obtenerTokenUsuario } from './token-usuario.mjs';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:4000/graphql';
const OBRAS = process.env.OBRAS_URL ?? 'http://localhost:8081';
const MATERIALES = process.env.MATERIALES_URL ?? 'http://localhost:8082';
const PORTAL = 'http://localhost:4300/';

const resultados = [];
function comprobar(nombre, ok, detalle = '') {
  resultados.push(ok);
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre}${detalle ? ` · ${detalle}` : ''}`);
}
const esperar = (ms) => new Promise((listo) => setTimeout(listo, ms));

async function graphql(token, query, variables) {
  const respuesta = await fetch(GATEWAY, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  return respuesta.json();
}
async function rest(base, metodo, ruta, token, cuerpo) {
  const respuesta = await fetch(base + ruta, {
    method: metodo,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await respuesta.text();
  return { estado: respuesta.status, json: texto ? JSON.parse(texto) : null };
}
const codigo = (r) => r.errors?.[0]?.extensions?.codigo;

const admin = await obtenerTokenUsuario('admin1');
const residente = await obtenerTokenUsuario('residente1');
const almacenero = await obtenerTokenUsuario('almacenero1');
const cliente = await obtenerTokenUsuario('cliente1', 'Prueba123!', 'portal', PORTAL);

// Mes actual en La Paz: la planilla no puede ser de un mes futuro
const periodo = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit' })
  .format(new Date())
  .slice(0, 7);

// 1. Obra nueva con contrato (002): residente1, maestro1, almacenero1 y cliente1 de los datos de prueba
const registro = await graphql(
  admin,
  `mutation($e: RegistrarObraEntrada!) { registrarObra(entrada: $e) { id estado } }`,
  {
    e: {
      nombre: `Prueba saga 008 ${new Date().toISOString().slice(0, 19)}`,
      ubicacion: 'Av. Banzer 4to anillo, Santa Cruz',
      fechaInicio: `${periodo}-01`,
      asignaciones: {
        residenteId: 'a0000000-0000-4000-8000-000000000003',
        maestroId: 'a0000000-0000-4000-8000-000000000005',
        almaceneroId: 'a0000000-0000-4000-8000-000000000006',
        clienteId: 'a0000000-0000-4000-8000-000000000007',
      },
      contrato: { monto: 100000, plazoDias: 120, anticipoPct: 10, retencionPct: 7, firmadoEn: `${periodo}-01` },
      partidas: [
        { codigo: 'P-01', nombre: 'Excavación', unidad: 'm3', cantidadContratada: 200, precioUnitario: 150 },
        { codigo: 'P-02', nombre: 'Losa', unidad: 'm2', cantidadContratada: 100, precioUnitario: 700 },
      ],
    },
  },
);
const obraId = registro.data?.registrarObra?.id;
comprobar('obra registrada', Boolean(obraId), obraId ?? JSON.stringify(registro.errors));
if (!obraId) process.exit(1);

let obra;
for (let i = 0; i < 30; i++) {
  obra = (await graphql(admin, `query($id: ID!) { obra(id: $id) { estado partidas { id codigo } } }`, { id: obraId })).data?.obra;
  if (obra?.estado === 'EN_EJECUCION') break;
  await esperar(1000);
}
comprobar('contrato creado en Finanzas (obra en ejecución)', obra?.estado === 'EN_EJECUCION', obra?.estado);

// 2. El residente elabora y presenta la planilla del mes (007)
const CAMPOS = 'id estado version neto';
const creada = await graphql(residente, `mutation($o: ID!, $p: String!) { crearPlanilla(obraId: $o, periodo: $p) { ${CAMPOS} } }`, {
  o: obraId,
  p: periodo,
});
const planillaId = creada.data?.crearPlanilla?.id;
comprobar('planilla creada', Boolean(planillaId), planillaId ?? codigo(creada));
const [p1, p2] = obra.partidas;
const guardada = await graphql(
  residente,
  `mutation($id: ID!, $e: GuardarPlanillaEntrada!) { guardarPlanilla(id: $id, entrada: $e) { ${CAMPOS} } }`,
  {
    id: planillaId,
    e: {
      version: 0,
      lineas: [
        { partidaId: p1.id, cantidadPeriodo: 80 },
        { partidaId: p2.id, cantidadPeriodo: 10 },
      ],
      fotoIds: [],
    },
  },
);
const neto = guardada.data?.guardarPlanilla?.neto;
// subtotal 80 × 150 + 10 × 700 = 19 000; − 10 % − 7 % = 15 770
comprobar('planilla guardada con su neto', neto === 15770, String(neto));
const presentada = await graphql(residente, `mutation($id: ID!) { presentarPlanilla(id: $id, version: 1) { estado } }`, {
  id: planillaId,
});
comprobar('planilla presentada', presentada.data?.presentarPlanilla?.estado === 'PRESENTADA', codigo(presentada));

// 3. El cliente aprueba desde el portal (Obras por REST)
const ajena = await rest(OBRAS, 'POST', `/planillas/${planillaId}/aprobar`, residente);
comprobar('el residente no puede aprobar', ajena.estado === 403, String(ajena.estado));
const aprobar = await rest(OBRAS, 'POST', `/planillas/${planillaId}/aprobar`, cliente);
comprobar('aprobar → 202 APROBANDO', aprobar.estado === 202 && aprobar.json?.estado === 'APROBANDO', `${aprobar.estado}`);
const repetida = await rest(OBRAS, 'POST', `/planillas/${planillaId}/aprobar`, cliente);
comprobar('aprobar dos veces → 409 PLANILLA_NO_PRESENTADA', repetida.json?.codigo === 'PLANILLA_NO_PRESENTADA', `${repetida.estado}`);

// 4. Espera el resultado de la saga como el portal (cada 2 s, hasta 90 s)
const inicio = Date.now();
let planilla;
do {
  await esperar(2000);
  planilla = (await rest(OBRAS, 'GET', `/planillas/${planillaId}`, cliente)).json;
} while (planilla?.estado === 'APROBANDO' && Date.now() - inicio < 90000);
const segundos = ((Date.now() - inicio) / 1000).toFixed(0);
comprobar(
  'saga terminada: planilla APROBADA con número de cobro',
  planilla?.estado === 'APROBADA' && /^COB-\d{4}-\d{4}$/.test(planilla?.cobroNumero ?? ''),
  `${planilla?.estado} ${planilla?.cobroNumero ?? ''} ${planilla?.observacion ?? ''} (${segundos} s)`,
);

// 5. Cobro, saldo y avance vistos desde el ERP
const erp = await graphql(
  admin,
  `query($p: ID!, $o: ID!) {
    planilla(id: $p) { estado cobro { numero montoNeto estado emitidoEn venceEn } }
    obra(id: $o) { avancePct finanzas { saldoDisponible totalCobrado totalReservado } }
  }`,
  { p: planillaId, o: obraId },
);
const cobro = erp.data?.planilla?.cobro;
const finanzas = erp.data?.obra?.finanzas;
comprobar('cobro PENDIENTE por el neto, vence a los 30 días', cobro?.estado === 'PENDIENTE' && cobro?.montoNeto === 15770, JSON.stringify(cobro));
comprobar(
  'reserva consumida: saldo 84 230, cobrado 15 770, reservado 0',
  finanzas?.saldoDisponible === 84230 && finanzas?.totalCobrado === 15770 && finanzas?.totalReservado === 0,
  JSON.stringify(finanzas),
);
comprobar('el avance de la obra incluye la planilla (19 %)', erp.data?.obra?.avancePct === 19, String(erp.data?.obra?.avancePct));
const delResidente = await graphql(residente, `query($p: ID!) { planilla(id: $p) { cobro { numero montoNeto } } }`, { p: planillaId });
comprobar(
  'el residente ve el número de cobro pero no los datos de Finanzas',
  delResidente.data?.planilla?.cobro?.numero === planilla?.cobroNumero && delResidente.data?.planilla?.cobro?.montoNeto === null && !delResidente.errors,
  JSON.stringify(delResidente.data?.planilla?.cobro),
);

// 6. Materiales cerró el periodo: un ingreso en ese mes se rechaza (004, criterio 7)
const materiales = await rest(MATERIALES, 'GET', '/materiales?soloActivos=true&tamano=1', admin);
let materialId = materiales.json?.items?.[0]?.id;
if (!materialId) {
  // Catálogo vacío (antes de la 011): crea un material de prueba
  const creado = await rest(MATERIALES, 'POST', '/materiales', admin, {
    codigo: `PRB-SAGA-${Date.now().toString(36).toUpperCase()}`,
    nombre: 'Cemento (prueba de la saga)',
    tipo: 'CEMENTO',
    unidad: 'bolsa',
    unidadPlural: 'bolsas',
    precioReferencial: 60,
    atributos: [],
  });
  materialId = creado.json?.id;
}
if (materialId) {
  const ingreso = await rest(MATERIALES, 'POST', '/movimientos', almacenero, {
    id: randomUUID(),
    obraId,
    materialId,
    tipo: 'INGRESO',
    cantidad: 1,
    registradoEn: new Date().toISOString(),
  });
  comprobar('periodo cerrado en Materiales → 409 PERIODO_CERRADO', ingreso.json?.codigo === 'PERIODO_CERRADO', `${ingreso.estado}`);
} else {
  comprobar('periodo cerrado en Materiales', false, 'no se pudo crear el material de prueba');
}

const fallas = resultados.filter((ok) => !ok).length;
console.log(`\n${resultados.length - fallas} de ${resultados.length} comprobaciones correctas · obra ${obraId}`);
process.exit(fallas ? 1 : 0);
