// Reenvía 127.0.0.1:8080 del contenedor de n8n al Keycloak del Compose (keycloak:8080). 201.
//
// Los flujos piden el token del cliente n8n en KEYCLOAK_URL=http://localhost:8080: Keycloak lo emite con
// iss = http://localhost:8080/realms/supervision, el emisor que validan Obras y Finanzas en la máquina, y la API de
// administración se llama por la misma dirección. Dentro del contenedor «localhost» no es Keycloak: este reenvío hace
// que lo sea (lo mismo que ia/reenviar-keycloak.py para los contenedores de IA, aquí con el Node de la imagen de n8n).
// Lo arranca n8n/iniciar.sh antes de n8n. Solo biblioteca estándar.
import net from 'node:net';

const destino = {
  host: process.env.REENVIO_KEYCLOAK_HOST ?? 'keycloak',
  port: Number(process.env.REENVIO_KEYCLOAK_PUERTO ?? 8080),
};
const puertoEscucha = Number(process.env.REENVIO_ESCUCHA_PUERTO ?? 8080);

const servidor = net.createServer((entrante) => {
  const saliente = net.connect(destino);
  entrante.pipe(saliente);
  saliente.pipe(entrante);
  const cerrar = () => {
    entrante.destroy();
    saliente.destroy();
  };
  entrante.on('error', cerrar);
  saliente.on('error', cerrar);
  entrante.on('close', cerrar);
  saliente.on('close', cerrar);
});

servidor.listen(puertoEscucha, '127.0.0.1', () => {
  console.log(`reenvío 127.0.0.1:${puertoEscucha} → ${destino.host}:${destino.port}`);
});
