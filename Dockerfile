# The Saros console: the pages, served by Next.js. It keeps no data
# and no session, and decides nothing. Every /api request goes to the
# platform's service at BACKEND_ORIGIN with its headers unchanged; the service
# verifies the Google Identity-Aware Proxy assertion on each one and answers
# sign-in itself. Without BACKEND_ORIGIN every request is answered 503.
#
#   docker build -t agentfactory-console \
#     --build-arg NEXT_PUBLIC_ORIGIN=https://THE-ADDRESS-PEOPLE-WILL-USE .
#   docker run -p 8080:8080 -e BACKEND_ORIGIN=http://THE-SERVICE:8080 agentfactory-console
#
# NEXT_PUBLIC_ORIGIN is compiled into the pages, so it is a build argument and
# the build stops without it. BACKEND_ORIGIN is read at run time, so one image
# serves any deployment. deploy/console/README.md has the rest.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# The address people open the console at, in full, with no trailing slash.
ARG NEXT_PUBLIC_ORIGIN
RUN test -n "$NEXT_PUBLIC_ORIGIN" || (echo "Set --build-arg NEXT_PUBLIC_ORIGIN=https://the-address-people-will-use" >&2; exit 1)
ENV NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production NEXT_PUBLIC_ORIGIN=$NEXT_PUBLIC_ORIGIN
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build --chown=node:node /app ./
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0
USER node
EXPOSE 8080
CMD ["sh", "-c", "exec node node_modules/next/dist/bin/next start -p \"$PORT\" -H 0.0.0.0"]
