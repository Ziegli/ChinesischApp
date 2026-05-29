#!/usr/bin/env bash
set -euo pipefail

# start_mac.sh (Variante B – dynamische URL)
# Startet den Dev-Server und öffnet automatisch die von Vite ausgegebene Local-URL

# --- PATH (Apple Silicon + Intel + System) ---
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# --- Farben ---
RED="\033[0;31m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
NC="\033[0m"

LOG="$HOME/Desktop/cnsrs_start.log"

echo -e "${YELLOW}▶ Prüfe Node & npm ...${NC}"

if ! command -v node >/dev/null 2>&1; then
  echo -e "${RED}Node ist nicht installiert. Bitte installiere Node (https://nodejs.org).${NC}"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo -e "${RED}npm ist nicht installiert. Bitte installiere npm (kommt mit Node).${NC}"
  exit 1
fi

echo -e "${GREEN}✔ Node & npm gefunden:${NC} $(node -v) $(npm -v)"

# Zum Projekt-Root wechseln
cd "$(dirname "$0")"

# package.json vorhanden?
if [ ! -f "package.json" ]; then
  echo -e "${RED}package.json nicht gefunden. Bitte im Projektordner ausführen.${NC}"
  exit 1
fi

# Log vorbereiten
{
  echo "=== CN‑SRS start: $(date) ==="
  echo "Working dir: $(pwd)"
  echo "Node: $(node -v)  npm: $(npm -v)"
} > "$LOG"

# Dependencies installieren, falls nötig
if [ ! -d "node_modules" ]; then
  echo -e "${YELLOW}▶ node_modules nicht gefunden — installiere Abhängigkeiten...${NC}"
  echo "npm install (started) $(date)" >> "$LOG"
  npm install >> "$LOG" 2>&1
  echo "npm install (finished) $(date)" >> "$LOG"
else
  echo -e "${GREEN}✔ node_modules vorhanden — überspringe npm install${NC}"
fi

# Ermitteln, ob es ein "dev"-Script gibt
HAS_DEV_SCRIPT=false
if npm run | grep -qE ' dev'; then
  HAS_DEV_SCRIPT=true
fi

echo -e "${YELLOW}▶ Starte Dev-Server (öffne automatisch die tatsächliche URL) ...${NC}"

# Funktion: liest Vite-Ausgabe und öffnet die "Local:"-URL genau einmal (BSD-sed kompatibel)
open_vite_url_from_stream() {
  local opened=0
  while IFS= read -r line; do
    # Originalausgabe anzeigen (damit Logs sichtbar sind)
    echo "$line"
    if [ "$opened" -eq 0 ]; then
      case "$line" in
        *"Local:"*"http://"*|*"Local:"*"https://"* )
          # Alles nach 'Local:' nehmen, Leerraum trimmen, am nächsten Leerraum kappen
          local url
          url=$(printf "%s\n" "$line" \
              | sed -E 's/.*Local:[[:space:]]*//; s/^[[:space:]]+//; s/[[:space:]].*$//' \
              | sed -E 's#^([^h]*)(https?://[^[:space:]]*).*#\2#')
          if [ -n "${url}" ]; then
            echo -e "${GREEN}✔ Öffne Browser: ${url}${NC}"
            echo "Open URL: ${url} $(date)" >> "$LOG"
            open "${url}" || true
            opened=1
          fi
        ;;
      esac
    fi
  done
}

# Starten – je nach Verfügbarkeit von "dev"-Script oder globalem vite
if [ "$HAS_DEV_SCRIPT" = true ]; then
  # Mit stdbuf (wenn vorhanden) zeilenweises Streaming erzwingen
  if command -v stdbuf >/dev/null 2>&1; then
    npm run dev 2>&1 | stdbuf -oL -eL open_vite_url_from_stream
  else
    npm run dev 2>&1 | open_vite_url_from_stream
  fi
else
  if command -v vite >/dev/null 2>&1; then
    if command -v stdbuf >/dev/null 2>&1; then
      vite 2>&1 | stdbuf -oL -eL open_vite_url_from_stream
    else
      vite 2>&1 | open_vite_url_from_stream
    fi
  else
    echo -e "${RED}Kein 'dev'-Script in package.json und 'vite' nicht global installiert.${NC}"
    echo 'Tipp: In package.json "dev": "vite" hinzufügen oder: npm i -g vite' >> "$LOG"
    exit 1
  fi
fi
