#!/bin/bash
# Self-healing wrapper for YOLOv8 spike analysis.
# Auto-installs Python dependencies if missing, then runs the analysis.

set -e

export HOME="/tmp"
export TORCH_HOME="/tmp/torch"
export HF_HOME="/tmp/hf"
export YOLO_CONFIG_DIR="/tmp/Ultralytics"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPS_LOCK="$SCRIPT_DIR/.deps-installed.lock"
ANALYSIS_SCRIPT="$SCRIPT_DIR/spike_pose_analysis.py"
VIDEO_PATH="$1"

if [ -z "$VIDEO_PATH" ]; then
  echo '{"error":"No video path provided"}'
  exit 1
fi

if [ ! -f "$ANALYSIS_SCRIPT" ]; then
  echo '{"error":"Analysis script not found"}'
  exit 1
fi

# Check if dependencies are available
NEED_INSTALL=0
if ! python3 -c "import ultralytics" 2>/dev/null; then
  NEED_INSTALL=1
fi

if [ "$NEED_INSTALL" -eq 1 ]; then
  echo "[SpikeLab] Installing ML dependencies..." >&2

  # Install ultralytics (no deps first for speed)
  pip3 install --quiet --no-deps ultralytics 2>&1 || true

  # Install PyTorch CPU (lightweight)
  pip3 install --quiet torch --index-url https://download.pytorch.org/whl/cpu 2>&1 || true

  # Install torchvision
  pip3 install --quiet torchvision --index-url https://download.pytorch.org/whl/cpu 2>&1 || true

  # Install remaining deps
  pip3 install --quiet \
    opencv-python-headless \
    numpy \
    pillow \
    pyyaml \
    polars \
    "ultralytics-thop>=2.0.18" \
    nvidia-ml-py \
    psutil \
    requests \
    matplotlib \
    2>&1 || true

  # Verify installation worked
  if ! python3 -c "import ultralytics; import torch" 2>/dev/null; then
    echo '{"error":"Failed to install ML dependencies. Please try again."}'
    exit 1
  fi

  echo "[SpikeLab] Dependencies installed successfully." >&2
fi

# Run the actual analysis
exec python3 "$ANALYSIS_SCRIPT" "$VIDEO_PATH"