# syntax=docker/dockerfile:1

# Backend image: one image for the API, the worker and the migrations (APP_MODE, command).
#
# Base: Node.js 22 on Debian 13 (trixie) "slim": no compiler, no ssh, no curl/wget, maintained by Debian
# until 2028 (LTS 2030). At least 22.12, which is where `require()` of an ES module stopped being
# experimental: pg-boss ships as pure ESM and the build is CommonJS (package.json's `engines`).
# Pinned by digest (the multi-architecture index: linux/arm64 on ECS, linux/amd64 in
# CI), so a build never picks a different image behind the same tag; Dependabot (docker) proposes the new
# tag and digest. The Docker official image, from Docker Hub: Dependabot cannot read the public ECR mirror
# (public.ecr.aws refuses its anonymous requests and its credentials; infra/README.md, "CI and dependencies"),
# which serves the same index under the same digest. GitHub-hosted runners are not subject to Docker Hub's
# pull limits for public images; the workflows log in when DOCKERHUB_USERNAME and DOCKERHUB_TOKEN exist.
# To move it by hand:
#   docker buildx imagetools inspect node:22-trixie-slim   # Digest: sha256:...
FROM node:22.23.3-trixie-slim@sha256:154ba2f4d6fec323d28e4f4bb86bba4677f1223391a1979cf521304e03a98dfa AS base

WORKDIR /usr/src/app

################################################################################
# pnpm, at the exact version of package.json's packageManager (build stages only: the runtime image has no
# package manager).
FROM base AS pnpm

ARG PNPM_VERSION=10.27.0
RUN corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate

################################################################################
# Production dependencies.
FROM pnpm AS deps

# Bind mounts of package.json and pnpm-lock.yaml (no layer for them) and a cache of the pnpm store.
RUN --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,source=pnpm-lock.yaml,target=pnpm-lock.yaml \
    --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod

################################################################################
# Build: every dependency, then TypeScript.
FROM deps AS build

RUN --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,source=pnpm-lock.yaml,target=pnpm-lock.yaml \
    --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

################################################################################
# Runtime: Node, the production dependencies, the build and the configuration; nothing else.
FROM base AS final

ARG COMMIT_SHA=""
ENV COMMIT_SHA=${COMMIT_SHA}

# Certificate authorities of Amazon RDS. In production the backend connects to
# PostgreSQL with TLS and verifies the server certificate (`DB_SSL=true` →
# `rejectUnauthorized: true`, no explicit CA), so Node must trust the RDS CAs:
# NODE_EXTRA_CA_CERTS adds them to its default trust store. Harmless locally
# (`DB_SSL=false`). The bundle is kept in the repository (certs/, AWS's
# https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem), so the
# build never depends on what AWS serves that day: AWS adds the CAs of each new
# region to that file, which broke a download pinned to a checksum. The weekly
# workflow .github/workflows/rds-ca-bundle.yml fails when AWS's file differs and
# says how to update this one. The bundle in the image keeps working until the
# database moves to a CA it does not hold.
# The slim image has no /etc/ssl/certs (no ca-certificates package; Node keeps its
# own root store): create it first with a mode the non-root user can traverse.
RUN mkdir -p /etc/ssl/certs && chmod 755 /etc/ssl /etc/ssl/certs
COPY --chmod=644 certs/rds-global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem

# The files belong to root and are only readable by the application, which runs
# as the unprivileged `node` user (uid 1000) of the base image.
COPY package.json .
COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/dist ./dist
COPY config ./config

USER node

# Expose the ports that the application listens on.
EXPOSE 3002

ENV NODE_CONFIG_DIR=./config

# Run node directly (not through pnpm) so the app is PID 1 and receives the
# SIGTERM ECS sends when it stops a task — a package-manager wrapper would
# swallow it and the task would be killed after the stop timeout instead of
# shutting down gracefully. The health checks (ECS, compose) call /livez or /readyz
# with node itself: the image has no curl or wget.
CMD ["node", "-r", "./dist/instrumentation.js", "./dist/index.js"]
