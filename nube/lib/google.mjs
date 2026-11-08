// 602 · Google Cloud: la máquina vm-ia se crea cuando esté la cuenta (paso 6 del «Orden» de la 602; tarea pendiente
// de infra). Mientras tanto, estas funciones avisan y «estado» la muestra como «sin crear».
import { detener } from './comun.mjs';

const PENDIENTE =
  'Google Cloud todavía no está implementado en nube.mjs: se hace cuando esté la cuenta (paso 6 del «Orden» de la 602).';

export const ipGoogle = () => '';
export const estadoGoogle = () => null;
export const crearGoogle = async () => detener(PENDIENTE);
export const encenderGoogle = async () => detener(PENDIENTE);
export const apagarGoogle = () => detener(PENDIENTE);
