FROM python:3.12-slim-trixie

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    GRAPHITI_TELEMETRY_ENABLED=false \
    PYTHON_DOTENV_DISABLED=1 \
    OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1

# The Linux FalkorDBLite wheel requires glibc >= 2.39. Trixie supplies 2.41.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --only-binary=:all: -r /app/requirements.txt \
    && groupadd --gid 1000 royal \
    && useradd --uid 1000 --gid 1000 --no-create-home royal \
    && mkdir -p /data \
    && chown 1000:1000 /data
COPY graphiti_bridge.py /app/graphiti_bridge.py
USER 1000:1000
EXPOSE 8093
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:8093/healthz",timeout=3).read()'
CMD ["python", "/app/graphiti_bridge.py", "serve", "--db", "/data/royal-knowledge.rdb", "--host", "0.0.0.0", "--port", "8093"]
