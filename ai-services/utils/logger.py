import logging
import json
import os
from contextvars import ContextVar
from datetime import datetime, timezone

correlation_id_context = ContextVar("correlation_id", default=None)


class JsonFormatter(logging.Formatter):
    def format(self, record):
        entry = {
            "timestamp": datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
            "level": record.levelname.lower(),
            "service": "vaccine-supply-chain-ai",
            "logger": record.name,
            "event": getattr(record, "event", record.getMessage()),
            "message": record.getMessage(),
        }
        correlation_id = getattr(record, "correlation_id", None) or correlation_id_context.get()
        if correlation_id:
            entry["correlationId"] = correlation_id
        for source, target in (("method", "method"), ("path", "path"), ("status_code", "statusCode"),
                               ("duration_ms", "durationMs")):
            value = getattr(record, source, None)
            if value is not None:
                entry[target] = value
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry, separators=(",", ":"))


def configure_logging():
    level = os.getenv("LOG_LEVEL", "INFO").upper()
    root = logging.getLogger()
    if not root.handlers:
        formatter = JsonFormatter()
        stream = logging.StreamHandler()
        stream.setFormatter(formatter)
        file_handler = logging.FileHandler(os.getenv("LOG_FILE", "logs/oracle.log"))
        file_handler.setFormatter(formatter)
        root.addHandler(stream)
        root.addHandler(file_handler)
    root.setLevel(level)

    logging.getLogger("transformers").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)

    return logging.getLogger("oracle")
