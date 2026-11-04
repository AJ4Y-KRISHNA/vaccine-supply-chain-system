const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function allowedInternalHosts() {
  return new Set(String(process.env.DOCKER_INTERNAL_HOSTS || "").split(",")
    .map(host => host.trim().toLowerCase()).filter(Boolean));
}

function isAllowedLocalHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return LOOPBACK_HOSTS.has(host) || allowedInternalHosts().has(host);
}

module.exports = { isAllowedLocalHost, allowedInternalHosts };
