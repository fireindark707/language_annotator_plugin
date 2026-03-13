#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source /home/phoenix000/anaconda3/etc/profile.d/conda.sh
conda activate labor_collect
cd "$ROOT_DIR"
python scripts/run-translator-comparison-playwright.py
