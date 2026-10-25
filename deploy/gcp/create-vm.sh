#!/bin/bash
# Crea la VM gratuita (e2-micro, us-central1) en el proyecto personal y la prepara. Una sola vez.
#   PROJECT=mi-proyecto deploy/create-vm.sh
set -euo pipefail
export CLOUDSDK_ACTIVE_CONFIG_NAME=tavernus
: "${PROJECT:?falta PROJECT=<id del proyecto personal>}"
VM=${VM:-tavernus}; ZONE=${ZONE:-us-central1-a}
gcloud config set project "$PROJECT"
gcloud services enable compute.googleapis.com
gcloud compute instances create "$VM" --zone "$ZONE" --machine-type e2-micro \
  --image-family debian-12 --image-project debian-cloud --boot-disk-size 30GB --boot-disk-type pd-standard
sleep 30
gcloud compute scp "$(dirname "$0")/setup-vm.sh" "$VM":/tmp/setup-vm.sh --zone "$ZONE"
gcloud compute ssh "$VM" --zone "$ZONE" --command "sudo bash /tmp/setup-vm.sh"
