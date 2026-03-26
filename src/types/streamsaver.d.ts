declare module 'streamsaver' {
  const streamSaver: {
    createWriteStream(filename: string, options?: { size?: number }): WritableStream<Uint8Array>;
    mitm: string;
  };
  export default streamSaver;
}
