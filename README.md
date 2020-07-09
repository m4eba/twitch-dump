Saves chat, live stream video segments and pubsub events from a twitch channel to disk.

#### Install

```bash
git clone https://github.com/m4eba/twitch-dump
cd twitch-dump
npm install
npm run compile
```

#### Usage

```bash
node build/dump.js <config.json>
```

With a config.json file like:

```json
{
  "channel": "<twitch channel to save>",
  "dump": ["chat", "event", "video"],
  "path": "<outputpath>",
  "username": "<twitch username>",
  "oauth": "oauth:......",
  "clientId": "...",
  "secret": "..."
}
```

- channel: channel to save
- dump: select what to save
- path: output path of saved files
- username: username to connect to chat
- oauth: oauth token for chat, generate it here https://twitchapps.com/tmi/
- clientId: twitch api client id
- secret: twitch api secret

set the environment variable DEBUG=\* to get debug output
on linux you could just use this

```bash
DEBUG=* node build/dump.js <config.json>
```
