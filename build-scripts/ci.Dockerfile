FROM lamassu/upboard-build:4.3 as native-builder
  ARG NPM_TOKEN
  ARG GPG_PASSPHRASE
  ARG GPG_PASSPHRASE_LICENSE

  RUN curl -sS https://ssubucket.ams3.digitaloceanspaces.com/ssuboard/licenses-2018.12.28.json.xz.gpg \
    | gpg --batch --passphrase "$GPG_PASSPHRASE_LICENSE" --decrypt | xz -dc > licenses.json
  RUN curl -sL https://ssubucket.ams3.digitaloceanspaces.com/deploy-files_2019.06.07.txz | xz -dc | tar -x
  RUN curl -sL https://ssubucket.ams3.digitaloceanspaces.com/bnr-sdk.tar.gz.gpg | \
    gpg --batch --yes --passphrase "$GPG_PASSPHRASE" --decrypt | \
    tar -xzf - -C /usr/lib

  RUN apt-get install -y libusb-1.0-0-dev
  #g++ build-essential libv4l-dev
  RUN curl -sL https://ssubucket.ams3.digitaloceanspaces.com/libgenmegadevice_amd64_0.8-1.deb.gpg -o /tmp/libgenmegadevice_amd64_0.8-1.deb.gpg && \
    gpg --batch --yes --passphrase "$GPG_PASSPHRASE" --output /tmp/libgenmegadevice_amd64_0.8-1.deb --decrypt /tmp/libgenmegadevice_amd64_0.8-1.deb.gpg && \
    dpkg -i /tmp/libgenmegadevice_amd64_0.8-1.deb && \
    rm /tmp/libgenmegadevice_amd64_0.8-1.deb /tmp/libgenmegadevice_amd64_0.8-1.deb.gpg
  COPY ["package.json", ".npmrc", "./"]

  RUN npm install --global json
  RUN json -I -f package.json -e 'this._dependencies = {}'
  RUN json -I -f package.json -e 'this._dependencies["@lamassu/v4l2camera"] = this.optionalDependencies["@lamassu/v4l2camera"];'
  RUN json -I -f package.json -e 'this._dependencies["@lamassu/manatee"] = this.optionalDependencies["@lamassu/manatee"];'
  RUN json -I -f package.json -e 'this._dependencies["@lamassu/supyo"] = this.optionalDependencies["@lamassu/supyo"];'
  RUN json -I -f package.json -e 'delete this.optionalDependencies; this.dependencies = this._dependencies;'

  RUN npm install --omit=dev

FROM lamassu/upboard-build:3.0 as build

  WORKDIR lamassu-machine

  ARG NPM_TOKEN
  ARG GPG_PASSPHRASE
  ARG GPG_PASSPHRASE_LICENSE

  RUN curl -sS https://ssubucket.ams3.digitaloceanspaces.com/ssuboard/licenses-2018.12.28.json.xz.gpg \
    | gpg --batch --passphrase "$GPG_PASSPHRASE_LICENSE" --decrypt | xz -dc > licenses.json
  RUN curl -sL https://ssubucket.ams3.digitaloceanspaces.com/deploy-files_2019.06.07.txz | xz -dc | tar -x
  RUN curl -sL https://ssubucket.ams3.digitaloceanspaces.com/bnr-sdk.tar.gz.gpg | \
    gpg --batch --yes --passphrase "$GPG_PASSPHRASE" --decrypt | \
    tar -xzf - -C /usr/lib

  RUN apt-get install -y libusb-1.0-0-dev
  #g++ build-essential libv4l-dev
  RUN curl -sL https://ssubucket.ams3.digitaloceanspaces.com/libgenmegadevice_amd64_0.8-1.deb.gpg -o /tmp/libgenmegadevice_amd64_0.8-1.deb.gpg && \
    gpg --batch --yes --passphrase "$GPG_PASSPHRASE" --output /tmp/libgenmegadevice_amd64_0.8-1.deb --decrypt /tmp/libgenmegadevice_amd64_0.8-1.deb.gpg && \
    dpkg -i /tmp/libgenmegadevice_amd64_0.8-1.deb && \
    rm /tmp/libgenmegadevice_amd64_0.8-1.deb /tmp/libgenmegadevice_amd64_0.8-1.deb.gpg

  COPY ["package.json", "package-lock.json", ".npmrc", "./"]

  ENV CXXFLAGS="-static-libstdc++ -static-libgcc"

  RUN npm version --allow-same-version --git-tag-version false --commit-hooks false 1.0.0

  RUN npm install --global json
  RUN json -I -f package.json -e 'this.dependencies["@lamassu/bnr-advance"] = this.optionalDependencies["@lamassu/bnr-advance"]; delete this.optionalDependencies["@lamassu/bnr-advance"]'
  RUN json -I -f package.json -e 'this.dependencies["@lamassu/genmega"] = this.optionalDependencies["@lamassu/genmega"]; delete this.optionalDependencies["@lamassu/genmega"]'
  RUN json -I -f package.json -e 'delete this.optionalDependencies["@lamassu/v4l2camera"]; delete this.optionalDependencies["@lamassu/manatee"]; delete this.optionalDependencies["@lamassu/supyo"]'

  RUN npm i

  # Copy the built v4l2camera module from the native-builder
  COPY --from=native-builder /lamassu/node_modules/ ./node_modules/

  COPY . ./

  RUN bash ./deploy/codebase/ci-build.sh && \
      bash ./deploy/codebase/package.sh