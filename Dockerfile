# syntax=docker/dockerfile:1

FROM oven/bun:1-debian AS app

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    ffmpeg \
    python3 \
    python3-venv \
    tini \
  && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/yt-dlp \
  && /opt/yt-dlp/bin/pip install --no-cache-dir --upgrade pip wheel \
  && /opt/yt-dlp/bin/pip install --no-cache-dir --upgrade "yt-dlp[default]" \
  && ln -s /opt/yt-dlp/bin/yt-dlp /usr/local/bin/yt-dlp

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .

RUN yt-dlp --version \
  && ffmpeg -version \
  && ffprobe -version

RUN bun run build

ENV NODE_ENV=production
ENV YTDLP_PATH=/usr/local/bin/yt-dlp
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe
ENV TMPDIR=/tmp

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bun", "run", "start"]