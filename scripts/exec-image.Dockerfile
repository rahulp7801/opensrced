# Exec box image: where target-repository code (installs, tests, linters)
# runs during an agentic dispatch. It holds no credentials; see
# lib/exec-box.ts. Build once per host:
#
#   docker build -t opensrcer-exec:2 -f scripts/exec-image.Dockerfile scripts
#
# node:24-bookworm already carries git, gcc/make and Python 3.11; venv, pip
# and headers are what's missing for `pip install -e .` style setups.
FROM node:24-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3-venv python3-pip python3-dev \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install --no-cache-dir --break-system-packages uv==0.7.13 pre-commit==4.0.1
# The server script is mounted read-only at run time (lib/exec-box.ts), so
# the image never goes stale against the code that drives it.
# Unprivileged: repo scripts get the `node` user and its empty home.
# /home/node/.cache and /home/node/env exist and are node-owned so the per-repository volumes
# mounted there (package cache, installed environment; lib/exec-box.ts) inherit it on first use.
RUN mkdir -p /work /home/node/.cache /home/node/env && chown node:node /work /home/node/.cache /home/node/env
USER node
WORKDIR /work
EXPOSE 7070
