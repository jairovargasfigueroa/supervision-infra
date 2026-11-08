// 601 · Ajusta el ngsw.json publicado del shell a las direcciones de los microfrontends (104: «los orígenes de los
// remotos se ajustan en la capa 6»). La compilación trae en el grupo «remotos» los de desarrollo (localhost:4201 a
// 4203); sin este ajuste, el service worker nunca guarda los remotos publicados y sin conexión no cargan.
// Uso: node produccion-local/ajustar-ngsw.mjs <ngsw.json> <url de mf-obras> <url de mf-materiales> <url de mf-supervision>
import { readFileSync, writeFileSync } from 'node:fs';

const [archivo, ...urls] = process.argv.slice(2);
if (!archivo || urls.length !== 3 || urls.some((url) => !/^https?:\/\/[^/]+/.test(url))) {
  console.error('Uso: node ajustar-ngsw.mjs <ngsw.json> <MF_OBRAS_URL> <MF_MATERIALES_URL> <MF_SUPERVISION_URL>');
  process.exit(1);
}

const manifiesto = JSON.parse(readFileSync(archivo, 'utf8'));
const remotos = manifiesto.assetGroups?.find((grupo) => grupo.name === 'remotos');
if (!remotos) {
  console.error(`${archivo} no tiene el grupo «remotos» (ngsw-config.json del shell, 104).`);
  process.exit(1);
}

// Mismo formato que genera Angular para «https://origen/**»: la expresión con «/» y «.» escapados, seguida de «\/.*»
const escapar = (texto) => texto.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
remotos.patterns = urls.map((url) => `${escapar(url.replace(/\/+$/, ''))}\\/.*`);
writeFileSync(archivo, `${JSON.stringify(manifiesto, null, 2)}\n`);
