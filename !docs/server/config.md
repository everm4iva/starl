# The config file

_- [back to server docs](readme.md)_

Everything you can change lives in one file: `config.yaml`, sitting right next to the server. Open it in any text editor, tweak, save, restart the server. That's the whole loop.

The server reads it every time it starts. If the file isn't there yet, the server writes a fresh one for you (with a private login secret already filled in). If you ever delete the secret line by accident, the server just makes a new one and saves it back, so nobody gets locked out.

One rule: keep the shape the same. You're changing values, not renaming the sections.

## ☆ server

```yaml
server:
  name: "My Starl Server"        # the name people see on the status page and in the client
  description: "just a cozy little music server"
  picture: ""                    # a picture, path or url, empty means the default one
  port: 6912                     # the api port, where the client talks to the server
  page_port: 6910                # the page port, where the website and status page live
```

## ☆ limits

```yaml
limits:
  max_memory_mb: 1024            # a soft memory hint for now
  max_storage_gb: 20             # how big the cache can get before cleanup gets pushier
  min_version: "0.1.0"           # the oldest client version allowed in, older ones get told to update
```

These are gentle for now. Think of them as goals the server leans toward, not hard walls.

## ☆ auth

How people get in. Full breakdown lives in [login modes](login-modes.md), but here's the shape:

```yaml
auth:
  mode: "userpass"               # none | pin | password | userpass
  pin: ""                        # only for pin mode, the shared code, like "4823"
  password: ""                   # only for password mode, the shared password
  allow_signup: true             # only for userpass mode, let new users make an account
  secret: "..."                  # signs the logins, keep it secret, it's made just for you
```

## ☆ worker

```yaml
worker:
  port: 6913                     # the python worker port, internal plumbing
  spawn: true                    # let the server run the worker for you, or run it yourself
```

Set `spawn: false` if you'd rather start the Python worker on your own (its own service, another terminal, whatever). Otherwise leave it and forget it.

## ☆ network

Who's allowed to reach the server from a browser. This is the CORS setting, and it matters for connecting the client.

```yaml
network:
  allowed_origins: ["*"]         # "*" means any client or site can reach it
```

`"*"` is the friendly default and it's safe here, because logging in uses a token in a header, not a cookie, so no random website can borrow someone's session. Wanna lock it down to only your own client? Swap it for a list:

```yaml
network:
  allowed_origins: ["https://localhost", "https://your.app"]
```

Only those exact origins get in then. More on this in [troubleshooting](troubleshooting.md).

## » A note about secrets

The `secret` in `auth`, and the pin or password if you set one, are yours. This file is not meant to be shared. Don't paste your `config.yaml` into a public issue or a screenshot. If you ever want a clean file, just delete `config.yaml` and start the server, it makes a brand new one.
