# Mozilla reviewer build instructions

This source package produces the unpublished Hack Engine `1.0.1` Firefox candidate. The executable JavaScript is readable and is not minified, bundled, transpiled, or obfuscated. The build script copies an explicit runtime-file allowlist, writes the reviewed browser manifest, normalizes package timestamps, and creates the ZIP archive.

## Reference build environment

The September 21 candidate was built locally with:

- Linux on x86_64;
- Node.js 26.8.1;
- npm 11.19.0;
- Info-ZIP `zip` 3.0 and `unzip` 6.0 at `/usr/bin/zip` and `/usr/bin/unzip`.

The scripts use standard Node.js APIs and Info-ZIP only. Other operating systems and the eventual reviewer environment must be qualified before submission.

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

## Build the Firefox candidate

Run:

```sh
npm run build
```

The Firefox submission is created at:

```text
dist/hack-engine-firefox-v1.0.1.zip
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
unzip -q dist/hack-engine-firefox-v1.0.1.zip -d rebuilt
diff -ru submitted rebuilt
```

`diff` should produce no output. The Firefox manifest is copied from the source root without semantic transformation, and every packaged JavaScript, HTML, CSS, image, and documentation file comes directly from this source package.
