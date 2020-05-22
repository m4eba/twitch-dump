import fs from 'fs';
import { Config, Dump } from './config';
import { Chat } from './chat';
import TwitchClient from 'twitch';
import { Events } from './events';
import Video from './video';

const config: Config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

const client = TwitchClient.withClientCredentials(
  config.clientId,
  config.secret
);
console.log('config dump', config.dump);

if (config.dump.has(Dump.CHAT)) {
  const chat = new Chat(config);
  chat.open();
}

let events: Events | null = null;

if (config.dump.has(Dump.EVENTS)) {
  events = new Events(config, client);
  events.open();
}

if (config.dump.has(Dump.VIDEO)) {
  const video = new Video(config);
  if (events === null) {
    events = new Events(config, client, true);
  }
  events.on('stream-up', () => {
    video.start();
  });
}
