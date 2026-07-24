#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

DRY_RUN=false
PUSH=false

for arg in "$@"; do
  case "${arg}" in
    --dry-run)
      DRY_RUN=true
      ;;
    --push)
      PUSH=true
      ;;
    *)
      echo "未知参数: ${arg}"
      echo "用法: bash scripts/release-tag.sh [--dry-run] [--push]"
      exit 1
      ;;
  esac
done

if ! command -v python3 >/dev/null 2>&1; then
  echo "未找到 python3，无法读取 src/manifest.json。"
  exit 1
fi

VERSION="$(python3 - <<'PY'
import json
from pathlib import Path

print(json.loads(Path("src/manifest.json").read_text(encoding="utf-8"))["version"])
PY
)"
TAG_NAME="v${VERSION}"

STATUS_OUTPUT="$(git status --porcelain)"
if [[ -n "${STATUS_OUTPUT}" ]]; then
  DISALLOWED_CHANGES="$(printf "%s\n" "${STATUS_OUTPUT}" | awk 'substr($0,4) != "src/manifest.json" && substr($0,4) != "README.md" { print }')"
  if [[ -n "${DISALLOWED_CHANGES}" ]]; then
    echo "检测到除 src/manifest.json / README.md 之外的未提交变更，请先处理后再发版："
    printf "%s\n" "${DISALLOWED_CHANGES}"
    exit 1
  fi
fi

python3 - "${VERSION}" <<'PY'
import re
import sys
from pathlib import Path

version = sys.argv[1]
readme_path = Path("README.md")
content = readme_path.read_text(encoding="utf-8")
updated, count = re.subn(
    r"(^- 插件版本：`)([^`]+)(`$)",
    rf"\g<1>{version}\3",
    content,
    count=1,
    flags=re.MULTILINE,
)

if count != 1:
    raise SystemExit("README.md 中未找到“插件版本”行，无法自动同步版本。")

if updated != content:
    readme_path.write_text(updated, encoding="utf-8")
PY

if git rev-parse "${TAG_NAME}" >/dev/null 2>&1; then
  echo "本地 tag ${TAG_NAME} 已存在，请先确认是否需要删除或更换版本号。"
  exit 1
fi

if git remote get-url origin >/dev/null 2>&1; then
  REMOTE_TAG="$(git ls-remote --tags origin "refs/tags/${TAG_NAME}" 2>/dev/null || true)"
  if [[ -n "${REMOTE_TAG}" ]]; then
    echo "远程 tag ${TAG_NAME} 已存在，请先更换版本号。"
    exit 1
  fi
fi

README_CHANGED=false
if ! git diff --quiet -- README.md; then
  README_CHANGED=true
fi

if [[ "${DRY_RUN}" == "true" ]]; then
  echo "演练完成。"
  echo "当前 src/manifest.json 版本: ${VERSION}"
  echo "将创建 tag: ${TAG_NAME}"
  if [[ "${README_CHANGED}" == "true" ]]; then
    echo "README.md 将同步到版本 ${VERSION}"
  else
    echo "README.md 已与 src/manifest.json 保持一致"
  fi
  if [[ "${PUSH}" == "true" ]]; then
    echo "演练模式下不会执行 push"
  fi
  exit 0
fi

git add src/manifest.json README.md

if ! git diff --cached --quiet -- src/manifest.json README.md; then
  git commit -m "chore(release): 发布 ${VERSION}"
fi

git tag -a "${TAG_NAME}" -m "Release ${TAG_NAME}"

if [[ "${PUSH}" == "true" ]]; then
  CURRENT_BRANCH="$(git branch --show-current)"
  if [[ -z "${CURRENT_BRANCH}" ]]; then
    echo "当前处于 detached HEAD，无法自动 push，请手动推送分支和 tag。"
    exit 1
  fi

  git push origin "${CURRENT_BRANCH}"
  git push origin "${TAG_NAME}"
  echo "已推送分支 ${CURRENT_BRANCH} 和 tag ${TAG_NAME}"
else
  echo "已创建 tag ${TAG_NAME}"
  echo "下一步请执行："
  echo "  git push origin $(git branch --show-current)"
  echo "  git push origin ${TAG_NAME}"
fi
