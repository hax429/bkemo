export type RecorderState =
  | { status: 'idle' }
  | { status: 'recording'; startedAt: number }
  | { status: 'review'; blob: Blob; mimeType: string; durationSeconds: number }
  | { status: 'unsupported'; message: string }
  | { status: 'denied'; message: string };

export class VoiceRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private startedAt = 0;
  private stream: MediaStream | null = null;

  static isSupported(): boolean {
    return typeof navigator !== 'undefined'
      && !!navigator.mediaDevices?.getUserMedia
      && typeof MediaRecorder !== 'undefined';
  }

  async start(): Promise<RecorderState> {
    if (!VoiceRecorder.isSupported()) {
      return { status: 'unsupported', message: 'MediaRecorder is not available in this Obsidian build' };
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      this.chunks = [];
      this.mediaRecorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.chunks.push(event.data);
      };
      this.startedAt = Date.now();
      this.mediaRecorder.start();
      return { status: 'recording', startedAt: this.startedAt };
    } catch {
      return { status: 'denied', message: 'Microphone access was denied' };
    }
  }

  async stop(): Promise<RecorderState> {
    const recorder = this.mediaRecorder;
    if (!recorder || recorder.state === 'inactive') return { status: 'idle' };
    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        resolve(new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' }));
      };
      recorder.stop();
    });
    this.cleanupStream();
    const durationSeconds = Math.max(1, Math.round((Date.now() - this.startedAt) / 1000));
    this.mediaRecorder = null;
    return {
      status: 'review',
      blob,
      mimeType: blob.type || 'audio/webm',
      durationSeconds,
    };
  }

  discard(): RecorderState {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.cleanupStream();
    this.mediaRecorder = null;
    this.chunks = [];
    return { status: 'idle' };
  }

  private cleanupStream() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}
