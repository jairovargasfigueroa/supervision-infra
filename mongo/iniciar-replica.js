// Inicia el replica set de un nodo "rs0" si todavía no existe (las transacciones del outbox de Materiales lo necesitan).
// El miembro se anuncia como localhost:27017 para que los servicios que corren en la máquina lo encuentren
// con mongodb://localhost:27017/materiales_db?replicaSet=rs0. Se puede ejecutar varias veces.
try {
  rs.status();
  print('replica set rs0 ya iniciado');
} catch (error) {
  if (error.codeName !== 'NotYetInitialized') throw error;
  rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'localhost:27017' }] });
  print('replica set rs0 iniciado');
}

// Espera a que el nodo sea primario antes de terminar.
for (let intento = 0; intento < 30 && !db.hello().isWritablePrimary; intento++) sleep(1000);
if (!db.hello().isWritablePrimary) throw new Error('el nodo no llegó a ser primario');
