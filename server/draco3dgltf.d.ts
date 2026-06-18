declare module 'draco3dgltf' {
  interface DracoFactory {
    createDecoderModule(): Promise<unknown>
    createEncoderModule(): Promise<unknown>
  }

  const draco3d: DracoFactory

  export default draco3d
}
