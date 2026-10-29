#!/usr/bin/env bash
# Muestra qué contenedor está sano y llama GET /salud de cada servicio que esté corriendo.
cd "$(dirname "$0")/.."
docker compose --profile '*' ps -a --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
echo
servicios="Obras=http://localhost:8081/salud Materiales=http://localhost:8082/salud Finanzas=http://localhost:8083/salud"
for s in $servicios; do
  nombre=${s%%=*}; url=${s#*=}
  if respuesta=$(curl -fsS --max-time 3 "$url" 2>/dev/null) && echo "$respuesta" | grep -q '"ok"'; then
    echo "$nombre: sano"
  else
    echo "$nombre: no responde ($url)"
  fi
done
if curl -fsS --max-time 3 -H 'content-type: application/json' -d '{"query":"{ salud }"}' http://localhost:4000/graphql 2>/dev/null | grep -q '"salud"'; then
  echo "Gateway: sano"
else
  echo "Gateway: no responde (http://localhost:4000/graphql)"
fi
