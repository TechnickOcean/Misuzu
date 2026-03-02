#!/bin/sh
set -eu

if [ -n "${FLAG:-}" ]; then
  printf "%s\n" "$FLAG" > /flag
  chmod 444 /flag
  echo "[entrypoint] wrote /flag from FLAG"
else
  if [ ! -s /flag ]; then
    echo "FLAG_NOT_SET" > /flag
    chmod 444 /flag
    echo "[entrypoint] FLAG not set, wrote placeholder to /flag"
  else
    echo "[entrypoint] /flag already exists"
  fi
fi
unset FLAG
exec python /app/app.py
