# Connecting a client

_- [back to server docs](readme.md)_

The whole point of the server is that a client connects to it and plays music. Here's how that actually happens, and what "connecting" even means under the hood.

## ☆ What "connect" really does

The client keeps one setting: the base address it talks to. Normally that's the default public server. When you "connect to a server", the client just swaps that address for yours and logs in. Every feature keeps working exactly the same, it's just pointed at your box now. Log out later and it swings back to the default. That's the entire trick, no magic.

## ☆ In the app

On the login screen there's a **Connect to server** option. It opens a little sheet with the servers you saved. Each one has a 3-dot menu:

- **Duplicate** - copy it into a new one
- **Edit** - change its details
- **Delete** - drop it from the list
- **Ping** - poke the server and show its state right there: active (with the latency), offline, or an error code
- **See details** - name, host, port, latency, auth type, and the min version the server wants

At the bottom, **Create connection**. When you make one, you type:

- the server's ip or host (the port is optional)
- a client name (letters and numbers, up to 15, it's just a label for your device)
- and whatever the server asks for: a pin, a password, or a username and password

The app can even ask the server which login it uses (that's the `/info` endpoint) and only show you the fields you actually need. All of this is saved on the device so you don't retype it next time.

## ☆ Building the address

The client turns your host and port into one address. A plain local ip (like `192.168.1.223`) is assumed to be `http`, a real domain name is assumed to be `https`. So `192.168.1.223` with port `6917` becomes `http://192.168.1.223:6917`.

That `http` vs `https` guess is exactly where the most common headache comes from, so if a connection says "offline" even though the server's clearly running, jump to [troubleshooting](troubleshooting.md), it's almost always that.

## » CORS, the quiet gatekeeper

For a browser-based client to read the server's answers, the server has to say "yeah this origin is allowed". That's the `network.allowed_origins` setting in [config.yaml](config.md). The default `"*"` lets any client in, which is fine because login is token-based, not cookie-based. If you locked it down to a list and your client isn't on it, the client won't be able to read responses. So if you tightened that setting, make sure your client's origin is in the list.
