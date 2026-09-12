# Build from the repository root:
#   docker build -t termexo-relay .
#
# The console is embedded at compile time. By default the image ships the placeholder page, so the
# relay can be built without the Node toolchain; to embed the real console, build it first and pass
# its directory:
#   npm --prefix console install && npm --prefix console run build
#   docker build --build-arg CONSOLE_DIR=console/dist/relay-console/browser -t termexo-relay .
#
# Both base images are published for linux/amd64 and linux/arm64, so the same Dockerfile builds
# either architecture unchanged; `.github/workflows/docker.yml` builds each on a runner of its own
# architecture and joins the two into one manifest list.
#
# `.dockerignore` keeps `.cargo/config.toml` out of the image deliberately: it redirects the protocol
# crate at a sibling Termexo checkout, which does not exist here, so the image builds that crate from
# the git revision `Cargo.lock` pins.

FROM rust:1-bookworm AS builder

WORKDIR /src
COPY . .

ARG CONSOLE_DIR=console-placeholder
# CONSOLE_DIR may already be the directory build.rs reads, because the build context can carry a
# console built outside the image; copying a directory onto itself would fail, so that case is a
# no-op. The final test turns a mistyped CONSOLE_DIR into a build failure rather than an image that
# silently serves nothing.
RUN set -eu; \
    bundle=console/dist/relay-console/browser; \
    if [ "${CONSOLE_DIR}" != "${bundle}" ]; then \
        rm -rf "${bundle}"; \
        mkdir -p console/dist/relay-console; \
        cp -r "${CONSOLE_DIR}" "${bundle}"; \
    fi; \
    test -f "${bundle}/index.html"

RUN cargo build --release --locked

FROM debian:bookworm-slim

# rusqlite is built with the bundled SQLite, so only TLS roots and the C runtime are needed here.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /src/target/release/termexo-relay /usr/local/bin/termexo-relay

# The database and the self-signed certificate live here; mount a volume to keep them across
# container replacements.
ENV TERMEXO_RELAY_DATA_DIR=/var/lib/termexo-relay
VOLUME ["/var/lib/termexo-relay"]

ENV TERMEXO_RELAY_LISTEN=0.0.0.0:8443
EXPOSE 8443

# Exec form, so the relay is PID 1 and `docker stop` delivers SIGTERM straight to it.
ENTRYPOINT ["termexo-relay"]
CMD ["serve"]
