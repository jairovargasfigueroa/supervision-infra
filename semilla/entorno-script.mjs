// 602 · Entorno de los scripts de Node que completan el escenario de prueba (eventos-ia.mjs y agentes.mjs).
// Sin argumentos leen infra/.env (desarrollo, con SEMILLA_PERMITIDA=si). Con --entorno <archivo> leen el de la
// «producción local» o el de la nube (nube/.env) y aceptan SEMILLA_DEMO=si: como la semilla de demostración, estos
// scripts solo agregan datos (eventos y entradas del diario con ids fijos, idempotentes) y nunca vacían nada.
// Con ese archivo toman KEYCLOAK_URL, ERP_URL (dirección de regreso del inicio de sesión) y USUARIOS_PRUEBA_CLAVE, y la
// CA local y los nombres *.localhost de la «producción local» (pruebas/red-local.mjs). Node 24, sin dependencias.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolverLocalhost, usarCa } from '../pruebas/red-local.mjs';

const INFRA = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Valores de un .env (las comillas simples o dobles exteriores se quitan). */
function leer(ruta) {
  return Object.fromEntries(
    readFileSync(ruta, 'utf8')
      .split(/\r?\n/)
      .filter((linea) => /^\s*[A-Za-z_][A-Za-z0-9_]*\s*=/.test(linea))
      .map((linea) => {
        let valor = linea.slice(linea.indexOf('=') + 1).trim();
        if (/^'.*'$|^".*"$/.test(valor)) valor = valor.slice(1, -1);
        return [linea.slice(0, linea.indexOf('=')).trim(), valor];
      }),
  );
}

/**
 * El entorno del script: { env, valor(nombre, porDefecto), token(usuario), descripcion }. Sale con un mensaje si el
 * archivo no existe o si la guarda no lo permite.
 */
export async function entornoDelScript(script) {
  const argumentos = process.argv.slice(2);
  const indice = argumentos.indexOf('--entorno');
  const archivo = indice >= 0 ? argumentos[indice + 1] : argumentos.find((a) => a.startsWith('--entorno='))?.slice(10);
  const ruta = archivo
    ? [resolve(archivo), resolve(INFRA, archivo)].find((r) => existsSync(r))
    : resolve(INFRA, '.env');
  if (!ruta || !existsSync(ruta)) {
    console.error(`${script}: no encuentro el archivo de entorno ${archivo ?? 'infra/.env'}.`);
    process.exit(2);
  }
  const env = leer(ruta);
  const valor = (nombre, porDefecto) => process.env[nombre] || env[nombre] || porDefecto;

  const desarrollo = env.SEMILLA_PERMITIDA === 'si';
  const demostracion = Boolean(archivo) && env.SEMILLA_DEMO === 'si';
  if (!desarrollo && !demostracion) {
    console.error(
      `${script}: falta SEMILLA_PERMITIDA=si en infra/.env (desarrollo) o, con --entorno, SEMILLA_DEMO=si en ese archivo ` +
        '(datos de demostración de la «producción local» o de la nube).',
    );
    process.exit(1);
  }

  if (env.CA_LOCAL) usarCa(resolve(dirname(ruta), env.CA_LOCAL));
  resolverLocalhost();
  // token-usuario.mjs lee KEYCLOAK_URL al importarse
  if (env.KEYCLOAK_URL && !process.env.KEYCLOAK_URL) process.env.KEYCLOAK_URL = env.KEYCLOAK_URL.replace(/\/+$/, '');
  const { obtenerTokensUsuario } = await import('../pruebas/token-usuario.mjs');
  const clave = valor('USUARIOS_PRUEBA_CLAVE', 'Prueba123!');
  const erp = valor('ERP_URL', 'http://localhost:4200').replace(/\/+$/, '');
  const token = async (usuario) =>
    (await obtenerTokensUsuario(usuario, { clave, clientId: 'erp', redirectUri: `${erp}/` })).access_token;

  return { env, valor, token, descripcion: archivo ? `${archivo} (${demostracion ? 'demostración' : 'desarrollo'})` : 'infra/.env' };
}
