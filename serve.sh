#!/usr/bin/env bash
# Serve the Sophia client locally (static). Talks directly to the configured
# Sophia instance (config.json → sophiaBaseUrl) over HTTPS; CORS is open, so no
# proxy is needed.
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8000}"
echo "Serving Sophia client at http://localhost:${PORT}"
echo "Sophia instance: $(node -e 'try{console.log(require("./config.json").sophiaBaseUrl)}catch(e){console.log("(config.json missing)")}' 2>/dev/null || echo '(node not available)')"
python3 -m http.server "${PORT}"
