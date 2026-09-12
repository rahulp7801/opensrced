# opensrcer runs as a single long-lived box, not serverless: it spawns
# `claude`, shells out to git/gh/patch, keeps dispatch state on local disk
# under .dispatches/, and holds an in-memory registry. This image bundles the
# external CLIs the pipeline shells out to, which is the part that's tedious
# to reproduce by hand (and the reason "clone and run" didn't work before).
#
#   docker build -t opensrcer .
#   docker run -p 3000:3000 --env-file .env.local \
#     -v opensrcer-dispatches:/app/.dispatches \
#     -v opensrcer-repos:/home/node/.contribai/repos \
#     opensrcer
#
# Persistent volumes hold run history, shared fixes, generated graphs, and the
# shallow-clone cache. Without them a container restart loses user state and
# re-clones every repo. The container runs as the
# non-root `node` user (uid 1000), so both volumes must be writable by it —
# hence /home/node rather than /root.

FROM node:24-bookworm-slim

# git       — clone, worktree, apply (the whole PR pipeline)
# patch     — GNU patch, the last tier of the diff-apply ladder
# python3   — graphify runtime used by repository graph generation
# ca-certs  — HTTPS to github.com and the model APIs
RUN apt-get update && apt-get install -y --no-install-recommends \
      git patch python3 python3-venv ca-certificates curl gnupg \
    && rm -rf /var/lib/apt/lists/*

# gh CLI — used for issue/PR reads and `gh pr create` on public flows.
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# gitleaks — hard gate on secrets in generated patches. The pipeline fails
# closed when the scanner is absent.
ARG GITLEAKS_VERSION=8.30.1
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in amd64) gl_arch=x64 ;; arm64) gl_arch=arm64 ;; *) echo "unsupported arch $arch" >&2; exit 1 ;; esac; \
    curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_${gl_arch}.tar.gz" \
      | tar -xz -C /usr/local/bin gitleaks

# Claude Code CLI — the agentic path shells out to `claude -p`.
ARG CLAUDE_CODE_VERSION=2.1.269
RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"

WORKDIR /app

# Dependencies first so a source-only change doesn't reinstall them.
# --legacy-peer-deps: react-diff-viewer-continued hasn't declared React 19.
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

# Keep graph dependencies isolated and identical to the Vercel worker image.
COPY requirements-graph.txt ./
RUN python3 -m venv /opt/graph \
    && /opt/graph/bin/python -m pip install --no-cache-dir -r requirements-graph.txt
ENV OPENSRCER_GRAPH_PYTHON=/opt/graph/bin/python

# The MCP server is a separate package with its own deps and build. Without
# dist/server.js every agentic dispatch fails at startup, so it is built here
# rather than left to a first-run step.
COPY mcp-server/package.json mcp-server/package-lock.json ./mcp-server/
RUN cd mcp-server && npm ci
COPY mcp-server ./mcp-server
RUN cd mcp-server && npm run build

COPY . .

# AUTH0_SECRET must exist at build time because lib/api-keys.ts is imported
# during the Next build. It is never used to decrypt anything here — supply
# the real one at runtime via --env-file.
RUN AUTH0_SECRET=build-time-placeholder-not-a-real-secret \
    APP_BASE_URL=http://localhost:3000 \
    AUTH0_DOMAIN=example.us.auth0.com \
    AUTH0_CLIENT_ID=build AUTH0_CLIENT_SECRET=build \
    npm run build

# Drop root. This container runs the target repository's own test suite
# (OPENSRCER_RUN_TESTS) and an LLM agent that shells out — both are code this
# image did not write. As root, a malicious postinstall script owns the
# container; as `node` it is confined to the app's own files and volumes.
#
# The mounted paths must be writable by uid 1000 (the `node` user):
#   /app/.dispatches            dispatch logs + sidecars
#   /app/.fixes                 shared fix records
#   /home/node/.contribai/repos shallow-clone cache
#   /home/node/.opensrcer       generated graphs
# Note the cache path moved with HOME — update the -v flag in the header
# comment above accordingly when running as non-root.
RUN mkdir -p /app/.dispatches /app/.fixes /home/node/.contribai/repos /home/node/.opensrcer \
    && chown -R node:node /app /home/node/.contribai /home/node/.opensrcer
USER node

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
