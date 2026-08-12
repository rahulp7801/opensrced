# opensrcer runs as a single long-lived box, not serverless: it spawns
# `claude`, shells out to git/gh/patch, keeps dispatch state on local disk
# under .dispatches/, and holds an in-memory registry. This image bundles the
# external CLIs the pipeline shells out to, which is the part that's tedious
# to reproduce by hand (and the reason "clone and run" didn't work before).
#
#   docker build -t opensrcer .
#   docker run -p 3000:3000 --env-file .env.local \
#     -v opensrcer-dispatches:/app/.dispatches \
#     -v opensrcer-repos:/root/.contribai/repos \
#     opensrcer
#
# Both volumes matter: .dispatches holds the run history the dashboard reads,
# and ~/.contribai/repos is the shallow-clone cache. Without them a container
# restart loses history and re-clones every repo.

FROM node:22-bookworm-slim

# git       — clone, worktree, apply (the whole PR pipeline)
# patch     — GNU patch, the last tier of the diff-apply ladder
# python3   — optional graph features (CRG); harmless if CRG_PYTHONPATH is unset
# ca-certs  — HTTPS to github.com and the model APIs
RUN apt-get update && apt-get install -y --no-install-recommends \
      git patch python3 ca-certificates curl gnupg \
    && rm -rf /var/lib/apt/lists/*

# gh CLI — used for issue/PR reads and `gh pr create` on public flows.
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# gitleaks — hard gate on secrets in generated patches. The pipeline skips the
# scan gracefully when it's absent, which is exactly the failure mode we don't
# want in a container that opens PRs.
ARG GITLEAKS_VERSION=8.21.2
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in amd64) gl_arch=x64 ;; arm64) gl_arch=arm64 ;; *) echo "unsupported arch $arch" >&2; exit 1 ;; esac; \
    curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_${gl_arch}.tar.gz" \
      | tar -xz -C /usr/local/bin gitleaks

# Claude Code CLI — the agentic path shells out to `claude -p`.
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

# Dependencies first so a source-only change doesn't reinstall them.
# --legacy-peer-deps: react-diff-viewer-continued hasn't declared React 19.
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

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

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
