// 503 · recargar: vacía ia_db.consumo_atipico (403). Cada documento es una salida de Materiales que recargar acaba de
// borrar, y la carga inicial no los vuelve a crear: los recrea semilla/eventos-ia.mjs con las fechas nuevas (y en
// PENDIENTE, aunque en una demostración se hayan revisado). No toca otras colecciones de ia_db.
// Lo corre semilla/recargar.* con el servicio mongo-cli (perfil herramientas).
const db_ia = db.getSiblingDB('ia_db');
const borrados = db_ia.consumo_atipico.deleteMany({}).deletedCount;
print(`ia_db.consumo_atipico vaciada: ${borrados} documentos`);
