// A drawing bigger than one request (4.5 MB on Vercel) is sent in pieces and put together on the server.
export const PART_MAX = 4_400_000
export const PARTS_MAX = 8 // up to about 35 MB
export const UPLOAD_ID = /^[a-z0-9]{6,24}$/
export const partName = (upload: string, part: number) => `up-${upload}-${part}.part`
