import React, { useEffect, useState } from "react";
import {
  Image,
  PanResponderInstance,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from "react-native";
import { BorderRadius } from "@/constants/theme";

interface ImageDimensions {
  uri: string;
  width: number;
  height: number;
}

interface EventLogoImageProps {
  uri: string;
  shape: "circle" | "square";
  zoom: number;
  offsetX: number;
  offsetY: number;
  maxWidth: number;
  maxHeight: number;
  accessibilityLabel?: string;
  imageTestID?: string;
  frameTestID?: string;
  frameStyle?: StyleProp<ViewStyle>;
  panHandlers?: PanResponderInstance["panHandlers"];
  children?: React.ReactNode;
}

/**
 * Displays the event image at its natural aspect ratio inside a responsive
 * bounding box. Framing offsets use the same 120-unit coordinate system as
 * the Appearance editor, regardless of the destination's rendered size.
 */
export function EventLogoImage({
  uri,
  shape,
  zoom,
  offsetX,
  offsetY,
  maxWidth,
  maxHeight,
  accessibilityLabel,
  imageTestID,
  frameTestID,
  frameStyle,
  panHandlers,
  children,
}: EventLogoImageProps) {
  const [dimensions, setDimensions] = useState<ImageDimensions | null>(null);
  const currentDimensions = dimensions?.uri === uri ? dimensions : null;
  const sourceAspectRatio =
    currentDimensions &&
    currentDimensions.width > 0 &&
    currentDimensions.height > 0
      ? currentDimensions.width / currentDimensions.height
      : 1.8;
  const aspectRatio = shape === "circle" ? 1 : sourceAspectRatio;
  const width = Math.min(maxWidth, maxHeight * aspectRatio);
  const height = width / aspectRatio;
  const positionScaleX = width / 120;
  const positionScaleY = height / 120;
  const zoomScale = zoom / 100;
  const imageWidth = width * zoomScale;
  const imageHeight = height * zoomScale;
  const imageLeft = (width - imageWidth) / 2 + offsetX * positionScaleX;
  const imageTop = (height - imageHeight) / 2 + offsetY * positionScaleY;

  useEffect(() => {
    let active = true;
    Image.getSize(
      uri,
      (imageWidth, imageHeight) => {
        if (active && imageWidth > 0 && imageHeight > 0) {
          setDimensions({
            uri,
            width: imageWidth,
            height: imageHeight,
          });
        }
      },
      () => {
        // Image load events below provide dimensions on platforms where
        // getSize cannot inspect the source URI.
      },
    );

    return () => {
      active = false;
    };
  }, [uri]);

  return (
    <View
      testID={frameTestID}
      {...panHandlers}
      style={[
        styles.frame,
        {
          width,
          height,
          borderRadius: shape === "circle" ? width / 2 : BorderRadius.md,
        },
        frameStyle,
      ]}
    >
      <Image
        testID={imageTestID}
        source={{ uri }}
        style={[
          styles.image,
          {
            width: imageWidth,
            height: imageHeight,
            left: imageLeft,
            top: imageTop,
          },
        ]}
        resizeMode="cover"
        accessibilityLabel={accessibilityLabel}
        onLoad={(event) => {
          const loadEvent = event as unknown as {
            nativeEvent?: {
              source?: { width?: number; height?: number };
              width?: number;
              height?: number;
            };
            currentTarget?: { naturalWidth?: number; naturalHeight?: number };
            target?: { naturalWidth?: number; naturalHeight?: number };
          };
          const source = loadEvent.nativeEvent?.source;
          const imageWidth =
            source?.width ??
            loadEvent.nativeEvent?.width ??
            loadEvent.currentTarget?.naturalWidth ??
            loadEvent.target?.naturalWidth;
          const imageHeight =
            source?.height ??
            loadEvent.nativeEvent?.height ??
            loadEvent.currentTarget?.naturalHeight ??
            loadEvent.target?.naturalHeight;
          if (
            typeof imageWidth === "number" &&
            typeof imageHeight === "number" &&
            imageWidth > 0 &&
            imageHeight > 0
          ) {
            setDimensions({
              uri,
              width: imageWidth,
              height: imageHeight,
            });
          }
        }}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    position: "relative",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  image: {
    position: "absolute",
  },
});
