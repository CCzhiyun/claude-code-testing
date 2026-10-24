import type {PlatformConfig,ModelMessage} from './types.js';
export function validateModelAudio(config:PlatformConfig,protocol:string,messages:ModelMessage[]){
 for(const message of messages)for(const b of Array.isArray(message.content)?message.content:[]){if(b.type!=='audio')continue;
  if(protocol!=='chat-completions')throw new Error('Audio input requires an explicitly selected audio-capable Chat Completions deployment; no automatic endpoint fallback');
  const format=b.media_type==='audio/wav'?'wav':b.media_type==='audio/mpeg'?'mp3':undefined;
  if(message.role!=='user'||!format||!config.model.audioInputFormats?.includes(format)||typeof b.data!=='string'||b.data.length>700000||!b.data||Buffer.from(b.data,'base64').length>512000||Buffer.from(b.data,'base64').toString('base64')!==b.data)throw new Error('Unsupported or unapproved bounded model audio input');
 }
}
