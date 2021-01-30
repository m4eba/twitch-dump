Saves chat, live stream video segments, vod segments and pubsub events from a twitch channel to disk.

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

##### Config

With a config.json file like:

```json
{
  "channel": "<twitch channel to save>",
  "dump": ["chat", "event", "video", "vod"],
  "path": "<outputpath>",
  "username": "<twitch username>",
  "oauth": "oauth:......",
  "oauthVideo": "...",
  "clientId": "...",
  "secret": "..."
}
```

- channel: channel to save
- dump: select what to save
- path: output path of saved files
- username: username to connect to chat
- oauth: oauth token for chat, generate it here https://twitchapps.com/tmi/
- oauthVideo: oauth token for video download copied from browser, see below
- clientId: twitch api client id
- secret: twitch api secret

##### Ads

To avoid ads in the video stream use a twitch account with subscriptions/turbo. You need to set oauthVideo in the config file to the oauth token from your browser. In chrome, open devtools and switch to the Application tab. Under Cookies search for 'auth-token' and copy the value.

##### Debug output

set the environment variable DEBUG=\* to get debug output
on linux you could just use this

```bash
DEBUG=* node build/dump.js <config.json>
```

see here for Windows: https://github.com/visionmedia/debug#windows-command-prompt-notes
