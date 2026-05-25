import { BufferLoader } from 'langchain/document_loaders/fs/buffer';
import { BaseProvider } from './BaseProvider';
import { OpenAIVoice } from '@mastra/voice-openai';
import { MastraVoice } from '@mastra/core/voice';
import OpenAI from 'openai';

interface AudioConfig {
  provider: string;
  apiKey?: any;
  baseURL?: any;
  modelKey: string;
  apiVersion?: string;
  speaker?: string;
  speed?: number;
}

export class AudioProvider extends BaseProvider {
  async getAudioModel(config: AudioConfig): Promise<MastraVoice | null> {
    await this.initializeFetch();

    switch (config.provider.toLowerCase()) {
      case 'openai':
        if (config.apiKey) {
          const openAIVoice = new OpenAIVoice({
            speechModel: {
              apiKey: config.apiKey,
            },
            listeningModel: {
              name: config.modelKey as any || "whisper-1",
              apiKey: config.apiKey,
            },
          });
          return openAIVoice as unknown as MastraVoice
        }
        return null
      case 'azureopenai':
        return null;
      case 'azure':
        // TODO: Implement Azure OpenAI audio support
        return null;
      case 'custom':
      default:
        if (config.apiKey) {
          const openAIVoice = new OpenAIVoice({
            speechModel: {
              apiKey: config.apiKey,
            },
            listeningModel: {
              name: config.modelKey as any || "whisper-1",
              apiKey: config.apiKey,
            },
          });
          openAIVoice.listeningClient = new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.baseURL,
            fetch: this.proxiedFetch,
          });
          return openAIVoice as unknown as MastraVoice
        }
        return null
    }
  }
}