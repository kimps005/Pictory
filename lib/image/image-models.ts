export const DEFAULT_IMAGE_MODEL = "@cf/black-forest-labs/flux-2-klein-4b" as const;
export const IMAGE_MODELS = [DEFAULT_IMAGE_MODEL] as const;
export type ImageModel = typeof DEFAULT_IMAGE_MODEL;
export function isImageModel(value: string): value is ImageModel { return value === DEFAULT_IMAGE_MODEL; }
