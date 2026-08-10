# Mozilla reviewer build instructions

This source package produces the submitted Hack Engine `0.7.0` Firefox add-on. The executable JavaScript is readable and is not minified, bundled, transpiled, or obfuscated. The build script copies an explicit runtime-file allowlist, writes the reviewed browser manifest, normalizes package timestamps, and creates the ZIP archive.

## Reference build environment

The submitted package was built and verified with:

- macOS 15.7.8 on ARM64;
- Node.js 22.19.0;
- npm 11.6.0;
- Info-ZIP `zip` 3.0 and `unzip` 6.0 at `/usr/bin/zip` and `/usr/bin/unzip`.

The scripts use standard Node.js APIs and Info-ZIP only. They are also suitable for Mozilla's Ubuntu 24.04 ARM64 reviewer environment with its provided Node.js 24 and npm 11 versions.

## Install the required programs

Node.js and npm can be obtained from <https://nodejs.org/en/download>. On macOS with Homebrew, Node 22 can be installed with:

```sh
brew install node@22
npm install --global npm@11.6.0
```

On Ubuntu, use the Node.js and npm versions provided in Mozilla's reviewer environment and install Info-ZIP if necessary:

```sh
sudo apt-get update
sudo apt-get install -y zip unzip
```

No global JavaScript build tools are required. From the extracted source-package root, install the locked development dependency:

```sh
npm ci --ignore-scripts
```

## Build the submitted Firefox add-on

Run:

```sh
npm run build
```

The Firefox submission is created at:

```text
dist/hack-engine-firefox-v0.7.0.zip
```

The same command also produces the Chrome package and `dist/SHA256SUMS.txt`. These extra outputs do not affect the Firefox package.

## Validate the result

Run the repository's package checks and Mozilla's official validator:

```sh
npm run check
npm run lint:firefox
```

Both commands must exit successfully. `web-ext lint` should report zero errors and zero warnings.

To compare the rebuilt add-on with the submitted package, extract each ZIP into a separate empty directory and compare the unpacked trees:

```sh
unzip -q submitted-firefox.zip -d submitted
unzip -q dist/hack-engine-firefox-v0.7.0.zip -d rebuilt
diff -ru submitted rebuilt
```

`diff` should produce no output. The Firefox manifest is copied from the source root without semantic transformation, and every packaged JavaScript, HTML, CSS, image, and documentation file comes directly from this source package.
