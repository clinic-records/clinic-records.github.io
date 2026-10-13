#!/bin/bash
cd "$(dirname "$0")"

echo "========================================================"
echo "       Clinic Patient Records Management System"
echo "========================================================"
echo ""
echo "Starting server and launching browser..."
echo ""

if [ -f "./runtime/bin/node" ]; then
    ./runtime/bin/node dist/server.js
elif command -v node >/dev/null 2>&1; then
    node dist/server.js
else
    npm start
fi
