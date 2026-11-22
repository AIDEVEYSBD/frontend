# The console on its own: the pages and the console's own server routes.
# No backend, no worker, no database. It shows what is built, reads the
# models Vertex AI lists to the workload's service account, and says
# "not connected" wherever the control plane is not there yet.
#
#   docker build -t agentfactory-console \
#     --build-arg NEXT_PUBLIC_ORIGIN=https://THE-ADDRESS-PEOPLE-WILL-USE .
#
# NEXT_PUBLIC_ORIGIN is compiled into the pages, so it is a build argument and
# the build stops without it. deploy/console/README.md has the rest.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# The address people open the console at, in full, with no trailing slash.
ARG NEXT_PUBLIC_ORIGIN
# 1: a panel that cannot read its data says "not connected" and prints no failure (lib/quiet.ts). 0 once a control plane is behind it.
ARG NEXT_PUBLIC_CONSOLE_QUIET=0
RUN test -n "$NEXT_PUBLIC_ORIGIN" || (echo "Set --build-arg NEXT_PUBLIC_ORIGIN=https://the-address-people-will-use" >&2; exit 1)
ENV NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production \
    NEXT_PUBLIC_ORIGIN=$NEXT_PUBLIC_ORIGIN NEXT_PUBLIC_CONSOLE_QUIET=$NEXT_PUBLIC_CONSOLE_QUIET
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build --chown=node:node /app ./
ARG NEXT_PUBLIC_ORIGIN
# No registry database and no runtime beside this console: both are said outright, so nothing waits on them.
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0 \
    PUBLIC_ORIGIN=$NEXT_PUBLIC_ORIGIN \
    AGENTFACTORY_DB=off AGENTFACTORY_RUNTIME_ROOT=/data/runtime
# The runtime folder exists and is empty, and the console cannot write to it: a console on its own keeps nothing.
RUN mkdir -p /data/runtime
USER node
EXPOSE 8080
CMD ["sh", "-c", "exec node node_modules/next/dist/bin/next start -p \"$PORT\" -H 0.0.0.0"]
