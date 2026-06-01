#!/usr/bin/env bash
# ============================================================================
#  OpenPBX — all-in-one installer for a fresh Ubuntu 22.04 droplet.
#  Paste this whole thing into the droplet's root terminal and press Enter.
#  It installs git, clones the private repo, then runs the bootstrap (Docker +
#  .env with random secrets + firewall + build + start).
#
#  Droplet public IP is auto-detected; override by exporting PUBLIC_IP first.
# ============================================================================
set -euo pipefail

REPO="bamoore91/sandbox"
BRANCH="claude/linux-pbx-twilio-sip-8Keo7"
DEST="/root/openpbx"

echo "==> OpenPBX installer (Ubuntu 22.04)"
[[ $EUID -eq 0 ]] || { echo "Run as root (sudo)."; exit 1; }

# ---- detect public IP (used by the PBX for SIP/RTP NAT) --------------------
PUBLIC_IP="${PUBLIC_IP:-$(curl -fss https://api.ipify.org || true)}"
[[ -n "$PUBLIC_IP" ]] || { read -rp "Could not auto-detect public IP. Enter it: " PUBLIC_IP; }
export PUBLIC_IP
echo "==> Public IP: $PUBLIC_IP"

# ---- git ------------------------------------------------------------------
command -v git >/dev/null 2>&1 || { apt-get update -y && apt-get install -y git; }

# ---- GitHub token (private repo, read-only) -------------------------------
echo "Paste a GitHub token with read access to $REPO (fine-grained, Contents:Read)."
read -rsp "GitHub token: " GH_TOKEN; echo
[[ -n "$GH_TOKEN" ]] || { echo "No token given."; exit 1; }

# ---- clone (token used inline only; never written to disk) -----------------
if [[ -d "$DEST/.git" ]]; then
  echo "==> $DEST already exists; updating."
  git -C "$DEST" remote set-url origin \
    "https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git"
  git -C "$DEST" fetch --depth 1 origin "$BRANCH"
  git -C "$DEST" checkout -B "$BRANCH" "origin/$BRANCH"
  git -C "$DEST" remote set-url origin "https://github.com/${REPO}.git"
else
  git clone --depth 1 --branch "$BRANCH" \
    "https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git" "$DEST"
  # scrub the token from the stored remote URL
  git -C "$DEST" remote set-url origin "https://github.com/${REPO}.git"
fi
unset GH_TOKEN

# ---- hand off to the bootstrap (Docker + .env + firewall + build + start) --
cd "$DEST"
sudo -E bash pbx/deploy/bootstrap-droplet.sh
