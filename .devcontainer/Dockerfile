# CPAMC unified image: frontend panel + backend cpamc binary.
# Runtime profile (ports, local-engine on/off, credentials) is controlled by
# compose/environment, not by forking this Dockerfile.

FROM --platform=$BUILDPLATFORM node:22-alpine AS web-build
ARG VERSION=dev
WORKDIR /app
COPY frontend/package*.json ./
COPY frontend/bun.lock ./
ENV BUN_CONFIG_REGISTRY=https://registry.npmmirror.com
ENV BUN_INSTALL_REGISTRY=https://registry.npmmirror.com
RUN npm install -g bun
RUN bun install
COPY frontend/ .
RUN VERSION=$VERSION bun run build

# Build on the target platform so CGO/plugin loading (dlopen) works.
# X-CPA-SUPPORT-PLUGIN is "1" only when the binary is built with cgo.
FROM golang:1.26-alpine AS service-build
ARG TARGETOS
ARG TARGETARCH
ARG GO_BUILD_PARALLELISM=2
WORKDIR /src
RUN echo "https://mirrors.aliyun.com/alpine/v3.24/main" > /etc/apk/repositories \
 && echo "https://mirrors.aliyun.com/alpine/v3.24/community" >> /etc/apk/repositories \
 && apk update \
 && apk add --no-cache gcc musl-dev
COPY backend ./backend
COPY --from=web-build /app/dist/index.html ./backend/internal/core/httpapi/web/management.html
WORKDIR /src/backend
ENV GOPROXY=https://goproxy.cn,direct
RUN go mod download
# CGO is required for unix plugin host loaders and for advertising plugin UI support.
RUN CGO_ENABLED=1 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH} \
  go build -p=${GO_BUILD_PARALLELISM} -o /out/cpamc ./cmd/cpamc

FROM alpine:3.21
ARG HTTP_PORT=18317
ARG LOCAL_ENGINE_PORT=18318
RUN apk add --no-cache ca-certificates wget
WORKDIR /app
COPY --from=service-build /out/cpamc /usr/local/bin/cpamc
COPY --from=service-build /src/backend/config.example.yaml /usr/local/share/cpamc/config.example.yaml
ENV HTTP_PORT=${HTTP_PORT}
ENV HTTP_ADDR=0.0.0.0:${HTTP_PORT}
ENV USAGE_DATA_DIR=/data
ENV USAGE_DB_PATH=/data/usage.sqlite
# Defaults favor the unified dual-listener profile; compose may override.
ENV CPAMC_LOCAL_ENGINE_ENABLED=true
ENV CPAMC_LOCAL_ENGINE_CONFIG=/data/cliproxyapi/config.yaml
ENV CPAMC_LOCAL_ENGINE_HOST=0.0.0.0
ENV CPAMC_LOCAL_ENGINE_PORT=${LOCAL_ENGINE_PORT}
EXPOSE ${HTTP_PORT} ${LOCAL_ENGINE_PORT}
ENTRYPOINT ["cpamc"]
