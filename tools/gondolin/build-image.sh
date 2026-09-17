#!/bin/sh
set -eu

TOOL_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
GONDOLIN="$TOOL_DIR/node_modules/.bin/gondolin"
IMAGE_REF="medplum-health-tracking:alpine-3.23"

case "$(uname -m)" in
    arm64|aarch64)
        CONFIG="$TOOL_DIR/medplum-health-tracking.aarch64.json"
        ;;
    *)
        echo "The Medplum Health Tracking image is currently configured for Apple Silicon/aarch64." >&2
        exit 1
        ;;
esac

if [ "${FORCE_MEDPLUM_HEALTH_IMAGE_BUILD:-0}" != "1" ] && \
   "$GONDOLIN" image inspect "$IMAGE_REF" >/dev/null 2>&1; then
    echo "Reusing Gondolin image $IMAGE_REF"
    exit 0
fi

echo "Building Gondolin image $IMAGE_REF"
"$GONDOLIN" build --config "$CONFIG" --tag "$IMAGE_REF"
