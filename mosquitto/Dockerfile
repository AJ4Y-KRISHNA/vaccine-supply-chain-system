FROM eclipse-mosquitto:2
USER root
COPY config/mosquitto.conf /mosquitto/config/mosquitto.conf
COPY entrypoint.sh /mosquitto/entrypoint.sh
ENTRYPOINT ["/bin/sh", "/mosquitto/entrypoint.sh"]
