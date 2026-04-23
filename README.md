# Quartz v4 — mostlyuseful fork

This is a personal fork of [jackyzha0/quartz](https://github.com/jackyzha0/quartz). Reasons for forking:

- **Fix npm audit warnings** — updated transitive dependencies flagged by `npm audit`
- **Incremental rebuild** — skip unchanged pages so large wikis (2 700+ pages) build in seconds instead of minutes; state is persisted across runs and invalidated automatically on config/plugin changes
- **Progress reporting** — a progress bar during the emit phase shows how many files have been written
- **Progressive graph degradation** — the node graph hides itself behind a click-to-reveal placeholder when the neighbourhood exceeds a configurable threshold (`collapseThreshold`), and trims the rendered set to the closest N nodes (`maxNodes`) to keep the browser responsive

## Running locally with Docker

```bash
docker build -t quartz:latest . && \
docker run --init --rm \
  -u "$(id -u):$(id -g)" \
  -itp 8080:8080 -p 3001:3001 \
  -v /LOCAL/PATH/TO/sources:/data/wiki \
  -v quartz-cache:/quartz-cache \
  -e NODE_OPTIONS=--no-deprecation \
  quartz:latest \
  node ./quartz/bootstrap-cli.mjs build --serve \
    -d /data/wiki -o /quartz-cache/output --concurrency 4
```

Replace `/LOCAL/PATH/TO/sources` with the absolute path to your notes directory. The named volume `quartz-cache` persists the output and build-state between runs so incremental rebuilds are fast.

---

# Quartz v4

> “[One] who works with the door open gets all kinds of interruptions, but [they] also occasionally gets clues as to what the world is and what might be important.” — Richard Hamming

Quartz is a set of tools that helps you publish your [digital garden](https://jzhao.xyz/posts/networked-thought) and notes as a website for free.

🔗 Read the documentation and get started: https://quartz.jzhao.xyz/

[Join the Discord Community](https://discord.gg/cRFFHYye7t)

## Sponsors

<p align="center">
  <a href="https://github.com/sponsors/jackyzha0">
    <img src="https://cdn.jsdelivr.net/gh/jackyzha0/jackyzha0/sponsorkit/sponsors.svg" />
  </a>
</p>
