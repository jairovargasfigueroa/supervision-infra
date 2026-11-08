"""Reenvía 127.0.0.1:8080 del contenedor al Keycloak del Compose (keycloak:8080). 401.

Los contenedores del servicio de IA usan IA_KEYCLOAK_ISSUER=http://localhost:8080/realms/supervision, el mismo emisor
que traen los tokens del navegador y que validan Obras, Materiales y Finanzas en la máquina. Dentro del contenedor
«localhost» no es Keycloak: este reenvío hace que lo sea. Así:
  - ia-api baja el JWKS y valida el emisor de los tokens del ERP sin cambiar nada del servicio;
  - ia-carga-inicial pide su token por localhost:8080 y Keycloak lo emite con iss = localhost:8080, el que aceptan
    los demás servicios.
Solo biblioteca estándar (corre con el Python de la imagen del servicio de IA).
"""

import asyncio
import os

DESTINO = (os.environ.get("REENVIO_KEYCLOAK_HOST", "keycloak"), int(os.environ.get("REENVIO_KEYCLOAK_PUERTO", "8080")))
ESCUCHA = ("127.0.0.1", int(os.environ.get("REENVIO_ESCUCHA_PUERTO", "8080")))


async def copiar(lector: asyncio.StreamReader, escritor: asyncio.StreamWriter) -> None:
    try:
        while datos := await lector.read(65536):
            escritor.write(datos)
            await escritor.drain()
    except ConnectionError:
        pass
    finally:
        escritor.close()


async def atender(lector: asyncio.StreamReader, escritor: asyncio.StreamWriter) -> None:
    try:
        lector_keycloak, escritor_keycloak = await asyncio.open_connection(*DESTINO)
    except OSError:
        escritor.close()
        return
    await asyncio.gather(copiar(lector, escritor_keycloak), copiar(lector_keycloak, escritor))


async def principal() -> None:
    servidor = await asyncio.start_server(atender, *ESCUCHA)
    async with servidor:
        await servidor.serve_forever()


if __name__ == "__main__":
    asyncio.run(principal())
