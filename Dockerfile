FROM python:3.11-slim-bookworm

# Install system dependencies for Blender, X11, and OpenGL
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    libglu1-mesa \
    libxi6 \
    libxrender1 \
    libxxf86vm1 \
    libxkbcommon0 \
    libxkbcommon-x11-0 \
    libsm6 \
    libxext6 \
    libdbus-1-3 \
    libpulse0 \
    libegl1 \
    libgles2 \
    libgl1 \
    libglib2.0-0 \
    xz-utils \
    wget \
    ca-certificates \
    curl \
    git \
    netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

# Download and install Blender 4.2 LTS
RUN wget -q https://download.blender.org/release/Blender4.2/blender-4.2.0-linux-x64.tar.xz && \
    tar -xvf blender-4.2.0-linux-x64.tar.xz -C /usr/local/ && \
    mv /usr/local/blender-4.2.0-linux-x64 /usr/local/blender && \
    ln -s /usr/local/blender/blender /usr/local/bin/blender && \
    rm blender-4.2.0-linux-x64.tar.xz

# Install uv for Python dependency management
RUN pip install --no-cache-dir uv

WORKDIR /app
COPY . /app

# Install Python dependencies
RUN uv pip install --system -e .

RUN chmod +x /app/entrypoint.sh

EXPOSE 9876

ENV DISPLAY=:99
ENV PYTHONUNBUFFERED=1

ENTRYPOINT ["/app/entrypoint.sh"]
