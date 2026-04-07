#!/usr/bin/env bash
set -euo pipefail

echo "=== [1/4] システム更新 ==="
apt-get update -qq
apt-get upgrade -y -qq

echo "=== [2/4] Ollama インストール ==="
curl -fsSL https://ollama.com/install.sh | sh

echo "=== [3/4] Ollama を外部公開に設定 ==="
# systemd のdrop-inファイルで OLLAMA_HOST を上書き
mkdir -p /etc/systemd/system/ollama.service.d
cat > /etc/systemd/system/ollama.service.d/override.conf << 'EOF'
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
EOF

systemctl daemon-reload
systemctl enable ollama
systemctl restart ollama

echo "=== [4/4] デフォルトモデル取得 ==="
# Ollamaが起動するまで最大30秒待機
for i in $(seq 1 30); do
  if curl -sf http://localhost:11434 > /dev/null 2>&1; then
    break
  fi
  echo "  Ollama 起動待ち... ($i/30)"
  sleep 1
done

# llama3.2 (軽量・日本語対応) をダウンロード
ollama pull llama3.2

echo ""
echo "======================================"
echo "  セットアップ完了！"
echo "  ホストから http://localhost:11434 でアクセスできます"
echo "  モデル: llama3.2"
echo "======================================"
