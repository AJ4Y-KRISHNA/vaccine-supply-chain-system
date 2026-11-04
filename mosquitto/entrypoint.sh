#!/bin/sh
set -eu

: "${MQTT_USERNAME:?MQTT_USERNAME is required}"
: "${MQTT_PASSWORD:?MQTT_PASSWORD is required}"
mkdir -p /mosquitto/data
if [ -f /mosquitto/data/passwordfile ]; then
  mosquitto_passwd -b /mosquitto/data/passwordfile "$MQTT_USERNAME" "$MQTT_PASSWORD"
else
  mosquitto_passwd -b -c /mosquitto/data/passwordfile "$MQTT_USERNAME" "$MQTT_PASSWORD"
fi
chown -R mosquitto:mosquitto /mosquitto/data
exec mosquitto -c /mosquitto/config/mosquitto.conf
