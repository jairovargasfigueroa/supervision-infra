// Equivalente de mongo/iniciar-replica.js con el driver de Node, para cuando no hay mongosh.
// Lo llama mongo-local-replica.ps1/.sh con MONGO_DRIVER apuntando a node_modules/mongodb.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const { MongoClient } = createRequire(pathToFileURL(process.env.MONGO_DRIVER + '/'))('./');
const cliente = new MongoClient('mongodb://localhost:27017/?directConnection=true', { serverSelectionTimeoutMS: 10000 });
const admin = cliente.db('admin');
try {
  try {
    await admin.command({ replSetGetStatus: 1 });
    console.log('replica set rs0 ya iniciado');
  } catch (error) {
    if (error.codeName !== 'NotYetInitialized') throw error;
    await admin.command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: 'localhost:27017' }] } });
    console.log('replica set rs0 iniciado');
  }
  for (let intento = 0; intento < 30; intento++) {
    if ((await admin.command({ hello: 1 })).isWritablePrimary) process.exit(0);
    await new Promise((listo) => setTimeout(listo, 1000));
  }
  throw new Error('el nodo no llegó a ser primario');
} finally {
  await cliente.close();
}
