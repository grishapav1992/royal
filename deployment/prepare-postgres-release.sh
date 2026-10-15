#!/bin/sh
set -eu
release=/opt/royal-postgres-migration/release
mkdir -p "$release"
tar -C /opt/royal --exclude='./.env' --exclude='./.env.*' --exclude='./node_modules' --exclude='./data' --exclude='./artifacts' --exclude='./test-results*' --exclude='./playwright-report' --exclude='./dist' --exclude='./dist-server' -cf - . | tar -C "$release" -xf -
tar -C "$release" -xzf /opt/royal-postgres-migration/release-overlay.tgz
cd "$release"
docker build -t royal-game:postgres-staged . > /opt/royal-postgres-migration/game-build.log 2>&1
for service in tron-reader nile-creditor nile-play nile-reconcile nile-account-views; do
  docker build -f "deployment/finance/Dockerfile.$service" -t "royal-$service:postgres-staged" . > "/opt/royal-postgres-migration/$service-build.log" 2>&1
done
docker run --rm --user 0 --entrypoint sh -v /opt/royal-postgres-migration/tools:/tools royal-game:postgres-staged -c 'cp /app/dist-server/index.js /tools/game-index.js'
printf '%s\n' 'all PostgreSQL images built'
