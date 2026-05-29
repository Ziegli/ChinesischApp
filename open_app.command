#!/bin/zsh
# Öffnet Terminal, führt start_mac.sh aus und zeigt die URL im Browser

cd "$(dirname "$0")"

# Sicherstellen, dass start_mac.sh ausführbar ist
chmod +x ./start_mac.sh 2>/dev/null

# Wenn Terminal per Doppelklick startet, bleibt das Fenster offen.
# Wir starten das Skript im selben Fenster.
./start_mac.sh
