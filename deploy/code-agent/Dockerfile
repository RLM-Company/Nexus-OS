# Audited locally provisioned immutable build images. Operator supplies both arguments.
ARG OCI_CLI_IMAGE
ARG BUILD_NODE_IMAGE
FROM ${OCI_CLI_IMAGE} AS oci_cli
FROM ${BUILD_NODE_IMAGE}
COPY --from=oci_cli /usr/local/bin/docker /usr/bin/docker
WORKDIR /app
RUN npm install --global pnpm@11.19.0
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @cosmora/tool-runtime... build
ENV NODE_ENV=production
CMD ["node", "deploy/code-agent/sidecar.mjs"]
