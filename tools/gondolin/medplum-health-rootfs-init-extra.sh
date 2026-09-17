# Prepare the guest kernel facilities required by Docker before sandboxd starts.
mkdir -p /sys/fs/cgroup /var/lib/docker

if ! grep -q ' /sys/fs/cgroup cgroup2 ' /proc/mounts; then
  mount -t cgroup2 none /sys/fs/cgroup || log "[init] cgroup v2 mount failed"
fi

modprobe overlay >/dev/null 2>&1 || log "[init] overlay module unavailable"
modprobe bridge >/dev/null 2>&1 || log "[init] bridge module unavailable"
modprobe br_netfilter >/dev/null 2>&1 || log "[init] br_netfilter module unavailable"

sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || log "[init] could not enable IPv4 forwarding"

log "[init] starting Docker daemon"
dockerd \
  --host=unix:///var/run/docker.sock \
  --storage-driver=overlay2 \
  >/var/log/dockerd.log 2>&1 &
