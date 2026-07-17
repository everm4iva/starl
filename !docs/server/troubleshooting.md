# Troubleshooting

_- [back to server docs](readme.md)_

When something's off, it's usually one of a handful of things. Start at the top, these are ordered by how often they're the cause.

## ☆ "It says offline but the server is running"

Nine times out of ten it's an **http vs https** thing.

The client app runs on a secure (`https`) page. A plain local server at something like `http://192.168.1.223:6917` is not secure. A secure page is not allowed to quietly fetch from an insecure address, so the request gets blocked before it even leaves, and the ping just comes back "offline". The server never even heard from it. It's not broken, it's being bounced by the browser's own safety rule (this is called "mixed content", and on Android it's also the "cleartext" rule).

**First, prove the server is actually fine.** On another device on the same network, open this in a normal browser:

```
http://your-host-ip:6917/health
```

If you get back `{"status":"ok"}`, the server is totally healthy and the problem is 100% the http/https rule above, not the server.

**Ways to fix it:**

- **Use an https address instead of the raw ip.** The easiest path is putting the server behind something that gives it an https url. A tailscale funnel/vpn does exactly this, it hands your server a real `https://....vpn.domain` address, and that's actually what the default public server uses. Point the client at the https url and the block goes away.
- **Or allow cleartext in the client build.** If you're fine with plain http on your own network, the client can be built to permit it. That's a client build setting, not a server thing, so it lives on the app side, not here.

Short version: the server is happy, the client just won't talk http from an https page. Give it https and it becomes friends again.

## ☆ "The health check fails from every device"

If even a normal browser on another device can't reach `http://your-ip:6917/health`, then it's a real reach problem:

- **Firewall.** The machine running the server is probably blocking the port. The server prints the exact fix for your OS right in its boot log the moment it starts, look for the `[starl] if devices on your network can't reach this...` lines. On Windows, that first inbound connection attempt is usually also caught by an interactive "allow this app?" popup, if you clicked Cancel on that (or the network was set to Public at the time), the block sticks silently and you'll need the command from the boot log to open it back up, run it in an *admin* PowerShell.
- **Wrong ip.** Double check the server machine's local ip. It can change when the machine reconnects to wifi. Set a static ip or a reservation if you want it to stop moving.
- **Wrong port.** The address you typed has to match `server.port` in [config.yaml](config.md). Peek at the raw log the server prints on boot, it literally tells you the api port.
- **Not actually running.** Make sure the server is up and you saw the "listening" line in its terminal.

## ☆ "It connects but login fails"

- Check the mode. If your `auth.mode` is `pin`, the client has to send a pin, not a username. The app usually figures this out from `/info`, but if you set the connection's auth type by hand, make sure it matches the server.
- Empty pin or password on the server. If the mode is `pin` but you left `auth.pin` blank in the config, nobody can log in. Set the value.
- Wrong username or password. In `userpass` mode, the account has to exist. If signups are off (`allow_signup: false`), you can't register a new one until you turn it back on.

## ☆ "A browser client gets blocked reading responses"

That's CORS. If you changed `network.allowed_origins` to a specific list, only those exact origins are allowed. Either add your client's origin to the list, or set it back to `["*"]`. The default `"*"` is safe here because login uses a token in a header, not a cookie. See [config.yaml](config.md).

## ☆ "The worker never comes up"

The Python worker is what finds and pulls audio. If the brain keeps saying it's restarting the worker:

- Make sure Python is installed and its packages are there (`worker/requirements.txt`).
- Or set `worker.spawn: false` in the config and run the worker yourself so you can watch its errors directly.

## » Still stuck?

Copy the raw log the server printed on boot (ports and paths, no secrets in there), and the exact address you typed into the client. That combo answers most "why won't it connect" questions in one glance. If it's a real bug, the [Issues page](https://github.com/everm4iva/starl/issues) is the place :3
