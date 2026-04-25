set -e

PROCESS_NAME="app-monorepo-template.dev"
CONFIG_PATH="ecosystem.config.cjs"

export NODE_ENV=production

if pm2 describe "$PROCESS_NAME" >/dev/null 2>&1; then
  pm2 reload "$CONFIG_PATH" --only "$PROCESS_NAME" --update-env
else
  pm2 start "$CONFIG_PATH" --only "$PROCESS_NAME" --update-env
fi
