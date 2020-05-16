import fs from 'fs';
import { Config } from './config';
/*import { Chat } from './chat';
import { Events } from './events';
import TwitchClient from 'twitch';*/
import Video from './video';

const config: Config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
/*
const client = TwitchClient.withClientCredentials(
  config.clientId,
  config.secret
);

const chat = new Chat(config);
chat.open();

//const stats = new Stats(config);
//stats.on('stream', (id: string) => {});
//stats.start();

const events = new Events(config, client);
events.open();
*/
const video = new Video(config);
video.start();
