FROM node:22-bookworm-slim AS build

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_MANJING_API_BASE=/api
ENV NEXT_PUBLIC_MANJING_API_BASE=${NEXT_PUBLIC_MANJING_API_BASE}

COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    MANJING_APP_ROOT=/app \
    MANJING_DATA_ROOT=/data \
    MANJING_PYTHON=/usr/bin/python3 \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    LIBTV_BIN=/usr/local/bin/libtv

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg python3 tini unzip \
  && rm -rf /var/lib/apt/lists/*

ARG INSTALL_LIBTV=1
ARG TARGETARCH=amd64
ARG LIBTV_VERSION=1.1.3
ARG LIBTV_SHA256_AMD64=cf86f462c5aed60f95dca978cc91ece98c60bcfa27337da008ad59953c3ea7da
ARG LIBTV_SHA256_ARM64=369b43f5be1d28dbbde7c1b6711ed746bf9bff1028ba794a6dae4fa01bed601c
RUN if [ "$INSTALL_LIBTV" = "1" ]; then \
      case "$TARGETARCH" in \
        amd64) libtv_arch=x64; libtv_sha="$LIBTV_SHA256_AMD64" ;; \
        arm64) libtv_arch=arm64; libtv_sha="$LIBTV_SHA256_ARM64" ;; \
        *) echo "Unsupported LibTV architecture: $TARGETARCH" >&2; exit 1 ;; \
      esac; \
      libtv_zip=/tmp/libtv.zip; \
      curl -fsSL "https://liblibai-web-static.liblib.cloud/cli/${LIBTV_VERSION}/libtv-linux-${libtv_arch}.zip" -o "$libtv_zip"; \
      echo "$libtv_sha  $libtv_zip" | sha256sum -c -; \
      unzip -j "$libtv_zip" '*/libtv' -d /tmp/libtv-bin; \
      install -m 0755 /tmp/libtv-bin/libtv /usr/local/bin/libtv; \
      /usr/local/bin/libtv --version; \
    else \
      printf '#!/bin/sh\necho "LibTV CLI 未安装" >&2\nexit 127\n' > /usr/local/bin/libtv; \
      chmod 0755 /usr/local/bin/libtv; \
    fi

WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 3000 8080
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "run", "start:web"]
