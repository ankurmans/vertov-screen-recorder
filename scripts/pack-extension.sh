#!/bin/sh
# Builds public/extension/vertov-extension.zip, the file uploaded to the Chrome Web Store.
set -e
cd "$(dirname "$0")/../extension"
rm -f ../public/extension/vertov-extension.zip
zip -r ../public/extension/vertov-extension.zip . -x "README.md" -x "STORE-LISTING.md" -x "vendor/mediapipe/README-mediapipe.md" -x ".*" -x "*/.*"
ls -la ../public/extension/vertov-extension.zip
