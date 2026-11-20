#!/bin/sh
# Publishes greenlitlab, then launch-blockers (which pins it), in the right order.
# Each npm step asks for the security key in the browser: press ENTER when npm offers to open it.
set -e
npm whoami >/dev/null 2>&1 || npm login --auth-type=web
cd "$HOME/Developer/greenlitlab"
V=$(node -p 'require("./package.json").version')
if [ "$(npm view greenlitlab version)" != "$V" ]; then npm publish --auth-type=web; fi
cd "$HOME/Developer/launch-blockers"
until [ "$(npm view greenlitlab version)" = "$V" ]; do echo "waiting for npm to show greenlitlab $V..."; sleep 5; done
npm install --no-audit --no-fund "greenlitlab@$V" --save-exact
npm test
npm publish --auth-type=web
echo
echo "Both published. Tell Claude: published."
