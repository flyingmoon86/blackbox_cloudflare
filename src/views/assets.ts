import { assets } from "../generated/assets";
export const assetUrl = (path: string): string => assets[path] || path;
