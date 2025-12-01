FROM amd64/debian:stretch as upboard

WORKDIR /lamassu

# Update sources.list to use archive repositories since Stretch is deprecated
RUN sed -i 's/deb.debian.org/archive.debian.org/g' /etc/apt/sources.list && \
    sed -i 's/security.debian.org/archive.debian.org/g' /etc/apt/sources.list && \
    sed -i '/stretch-updates/d' /etc/apt/sources.list

# Install basic dependencies
RUN apt-get update && apt-get -o Acquire::Check-Valid-Until=false upgrade -y && \
    apt-get install -y --force-yes build-essential curl git pkg-config yasm \
    libasound2-dev libpcsclite-dev libavcodec-dev libavformat-dev libswscale-dev \
    ca-certificates xz-utils python

# Install Python build dependencies
RUN apt-get install -y --force-yes \
    libffi-dev libssl-dev zlib1g-dev libncurses5-dev libreadline-dev \
    libsqlite3-dev libbz2-dev liblzma-dev

# Create a separate layer for downloading and extracting Python source
RUN cd /tmp && \
    curl -O https://www.python.org/ftp/python/3.8.18/Python-3.8.18.tgz && \
    tar -xf Python-3.8.18.tgz

# Compile and install Python 3.8 in a separate layer
RUN cd /tmp/Python-3.8.18 && \
    ./configure --enable-optimizations && \
    make -j$(nproc) && \
    make altinstall && \
    cd .. && \
    rm -rf Python-3.8.18.tgz

# Create symlinks to use Python 3.8
RUN ln -sf /usr/local/bin/python3.8 /usr/bin/python3 && \
    ln -sf /usr/local/bin/python3.8 /usr/bin/python && \
    ln -sf /usr/local/bin/pip3.8 /usr/bin/pip3 && \
    ln -sf /usr/local/bin/pip3.8 /usr/bin/pip

# Install Node.js 22 using unofficial build compatible with older glibc
ENV NODE_VERSION=22.1.0
RUN mkdir -p /usr/local/lib/nodejs && \
    curl -fsSL https://unofficial-builds.nodejs.org/download/release/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64-glibc-217.tar.gz | \
    tar -xz -C /usr/local/lib/nodejs --strip-components=1

# Add node to PATH
ENV PATH=/usr/local/lib/nodejs/bin:$PATH

# Install barcode scanner libraries
RUN curl -sS https://ssubucket.ams3.digitaloceanspaces.com/barcodescannerlibs.txz | xz -dc | \
    tar -x -C /usr/local/lib --strip-components=2 barcodescannerlibs/amd64/libBarcodeScanner.a

# Tell node-gyp to use Python 3.8
ENV PYTHON=/usr/bin/python3

# Verify nodejs and python installation
RUN node --version && npm --version && python --version