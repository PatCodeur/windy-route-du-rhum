FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# Le relais n'a aucune dépendance npm : seul le moteur Node est nécessaire.
RUN printf '{"type":"module"}\n' > package.json \
    && mkdir -p src tools deploy state/ftp dist/live \
    && chown -R node:node /app

COPY src/identities.js src/historySnapshot.js src/data.js src/history.js src/liveFeed.js ./src/
COPY tools/publish-report.mjs tools/ftp-relay.py ./tools/
COPY deploy/http_server.py deploy/run.py ./deploy/

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER node
EXPOSE 8080
CMD ["python3", "-u", "deploy/run.py"]
