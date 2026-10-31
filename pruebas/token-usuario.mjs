// Obtiene el token de un usuario de prueba con el flujo real del navegador (código de autorización + PKCE),
// porque los clientes públicos no permiten "direct access grants". Sirve para pruebas de humo y de punta a punta.
// Uso como script: node pruebas/token-usuario.mjs residente1 [cliente] [redirect]  → imprime el token de acceso
import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const KEYCLOAK = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = 'supervision';

const base64url = (buffer) => buffer.toString('base64url');

/** Guarda las cookies de Keycloak entre las peticiones del inicio de sesión. */
function frasco() {
  const cookies = new Map();
  return {
    guardar(respuesta) {
      for (const linea of respuesta.headers.getSetCookie()) {
        const [par] = linea.split(';');
        const igual = par.indexOf('=');
        cookies.set(par.slice(0, igual), par.slice(igual + 1));
      }
    },
    encabezado: () => [...cookies].map(([nombre, valor]) => `${nombre}=${valor}`).join('; '),
  };
}

export async function obtenerTokenUsuario(
  usuario,
  clave = 'Prueba123!',
  clientId = 'erp',
  redirectUri = 'http://localhost:4200/',
) {
  return (await obtenerTokensUsuario(usuario, { clave, clientId, redirectUri })).access_token;
}

/**
 * Igual que obtenerTokenUsuario, pero devuelve la respuesta completa de Keycloak (access_token,
 * refresh_token, scope…). `scope` permite pedir, por ejemplo, 'openid offline_access' (101).
 */
export async function obtenerTokensUsuario(
  usuario,
  { clave = 'Prueba123!', clientId = 'erp', redirectUri = 'http://localhost:4200/', scope = 'openid' } = {},
) {
  const verificador = base64url(randomBytes(32));
  const desafio = base64url(createHash('sha256').update(verificador).digest());
  const cookies = frasco();
  const oidc = `${KEYCLOAK}/realms/${REALM}/protocol/openid-connect`;

  const autorizar = new URL(`${oidc}/auth`);
  autorizar.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope,
    code_challenge: desafio,
    code_challenge_method: 'S256',
    state: base64url(randomBytes(8)),
  }).toString();

  const pantalla = await fetch(autorizar, { redirect: 'manual' });
  cookies.guardar(pantalla);
  const html = await pantalla.text();
  const accion = html.match(/<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/)?.[1];
  if (!accion) throw new Error(`No apareció el formulario de inicio de sesión (${pantalla.status})`);

  const envio = await fetch(accion.replaceAll('&amp;', '&'), {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookies.encabezado() },
    body: new URLSearchParams({ username: usuario, password: clave, credentialId: '' }),
  });
  const destino = envio.headers.get('location');
  const codigo = destino && new URL(destino).searchParams.get('code');
  if (!codigo) throw new Error(`Keycloak no devolvió el código para ${usuario} (${envio.status})`);

  const respuesta = await fetch(`${oidc}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code: codigo,
      redirect_uri: redirectUri,
      code_verifier: verificador,
    }),
  });
  if (!respuesta.ok) throw new Error(`Canje del código: ${respuesta.status} ${await respuesta.text()}`);
  return respuesta.json();
}

/** Datos del token (sin verificar la firma: solo para pruebas). */
export const leerToken = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [usuario = 'residente1', clientId, redirectUri] = process.argv.slice(2);
  console.log(await obtenerTokenUsuario(usuario, undefined, clientId, redirectUri));
}
