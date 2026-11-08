// 601 · Red de la «producción local» para los scripts de Node que corren en la máquina (Node 24, sin dependencias).
//  - Las direcciones son https://<pieza>.<grupo>.localhost:<puerto>. Los navegadores y curl resuelven *.localhost a la
//    máquina, pero Node en Windows no (getaddrinfo devuelve ENOTFOUND): resolverLocalhost() hace que dns.lookup, que
//    usan fetch, http y https, responda 127.0.0.1 para esos nombres.
//  - Los certificados los firma la CA local del ensayo: Node solo la acepta si NODE_EXTRA_CA_CERTS está definida al
//    arrancar, así que usarCa() vuelve a ejecutar el script con esa variable (una vez) cuando hace falta.
import dns from 'node:dns';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

let resuelto = false;

/** dns.lookup responde 127.0.0.1 para los nombres *.localhost (como el navegador). */
export function resolverLocalhost() {
  if (resuelto) return;
  resuelto = true;
  const original = dns.lookup;
  dns.lookup = (host, opciones, callback) => {
    if (typeof opciones === 'function') {
      callback = opciones;
      opciones = {};
    }
    if (typeof host === 'string' && /\.localhost\.?$/i.test(host)) {
      const todas = typeof opciones === 'object' && opciones?.all;
      return todas ? process.nextTick(callback, null, [{ address: '127.0.0.1', family: 4 }])
        : process.nextTick(callback, null, '127.0.0.1', 4);
    }
    return original(host, opciones, callback);
  };
}

/**
 * Si `ruta` (la CA local) existe y el proceso no arrancó con ella en NODE_EXTRA_CA_CERTS, vuelve a ejecutar este
 * mismo script con la variable y termina con su código. Sin `ruta`, no hace nada (en la nube los certificados son
 * públicos).
 */
export function usarCa(ruta) {
  if (!ruta) return;
  const absoluta = resolve(ruta);
  if (!existsSync(absoluta)) {
    console.error(`No existe la CA local ${absoluta}: genérala con produccion-local/certificados.ps1 (o .sh).`);
    process.exit(1);
  }
  if (process.env.NODE_EXTRA_CA_CERTS && resolve(process.env.NODE_EXTRA_CA_CERTS) === absoluta) return;
  const hijo = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_EXTRA_CA_CERTS: absoluta },
  });
  process.exit(hijo.status ?? 1);
}
