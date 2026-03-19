FROM node:20 AS builder

# Install Go for WASM build
COPY --from=golang:1.25 /usr/local/go /usr/local/go
ENV PATH="/usr/local/go/bin:${PATH}"

WORKDIR /plugin
COPY . .
RUN npm ci && npm run build
RUN npx --no-install headlamp-plugin extract . /plugin/extracted \
    && cp dist/main.wasm.gz /plugin/extracted/

FROM alpine:3.20
RUN mkdir -p /plugins/insights-plugin
COPY --from=builder /plugin/extracted/ /plugins/insights-plugin/
CMD ["echo", "Plugin installed at /plugins/insights-plugin/"]
