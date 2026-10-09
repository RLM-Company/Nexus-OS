# Operator must supply an audited local immutable node:24 image digest/ID. No automatic pulls.
ARG NODE_IMAGE
FROM ${NODE_IMAGE}
WORKDIR /workspace
USER 65534:65534
