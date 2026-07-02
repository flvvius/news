import { Image as ExpoImage } from "expo-image";
import { withUniwind } from "uniwind";

/** expo-image is third-party, so it gets the withUniwind wrapper. */
export const Image = withUniwind(ExpoImage);
