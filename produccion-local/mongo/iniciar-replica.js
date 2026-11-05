// 601 · Inicia el replica set de un nodo "rs0" del grupo google si todavía no existe. A diferencia del de desarrollo
// (../mongo/iniciar-replica.js, miembro localhost:27017 para los servicios de la máquina), el miembro se anuncia como
// mongo:27017: así lo encuentran Materiales y el servicio de IA desde sus contenedores. Se puede ejecutar varias veces.
try {
  rs.status();
  print('replica set rs0 ya iniciado');
} catch (error) {
  if (error.codeName !== 'NotYetInitialized') throw error;
  rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'mongo:27017' }] });
  print('replica set rs0 iniciado');
}

for (let intento = 0; intento < 30 && !db.hello().isWritablePrimary; intento++) sleep(1000);
if (!db.hello().isWritablePrimary) throw new Error('el nodo no llegó a ser primario');
