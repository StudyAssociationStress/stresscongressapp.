/**
 * Shared image picker + upload field used by AdminSpeakersScreen,
 * AdminCompaniesScreen, and AdminEventControlScreen.
 *
 * Flow:
 *  1. User taps "Upload Photo" → device photo library opens
 *  2. Image is resized to max 800 px wide, compressed to JPEG 80 %
 *  3. Base64 data URI is POSTed to /api/admin/upload-image
 *  4. Server returns a hosted image URL (or the data URI itself as a
 *     fallback when external image storage is not configured)
 *  5. Returned URL is stored in form state and displayed as preview
 */
import React, { useState } from "react";
import {
  View,
  Image,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { EventLogoImage } from "@/components/EventLogoImage";
import { AppColors, BorderRadius, Spacing } from "@/constants/theme";
import { apiRequest } from "@/lib/query-client";

interface Props {
  label: string;
  value: string;
  onChange: (v: string) => void;
  theme: any;
  /** "circle" for speaker photos; "square" (default) for logos */
  shape?: "circle" | "square";
  /** Show a framing selector for logos. */
  allowShapeSelection?: boolean;
  onShapeChange?: (shape: "circle" | "square") => void;
  /** Keep the full source image instead of cropping it to a square on upload. */
  preserveAspectRatio?: boolean;
  uploadEndpoint?: string;
  uploadMethod?: "POST" | "PUT";
}

async function pickCompressUpload(
  shape: "circle" | "square",
  uploadEndpoint: string,
  uploadMethod: "POST" | "PUT",
  preserveAspectRatio: boolean,
): Promise<string> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted)
    throw new Error("Photo library access is required to pick an image.");

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: !preserveAspectRatio,
    aspect:
      !preserveAspectRatio && (shape === "circle" || shape === "square")
        ? [1, 1]
        : undefined,
    quality: 0.9,
  });
  if (result.canceled || !result.assets[0]) throw new Error("CANCELLED");

  const manip = await ImageManipulator.manipulateAsync(
    result.assets[0].uri,
    [{ resize: { width: 600 } }],
    { compress: 0.72, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );

  const dataUri = `data:image/jpeg;base64,${manip.base64}`;

  const res = await apiRequest(uploadEndpoint, {
    method: uploadMethod,
    body: JSON.stringify({ dataUri }),
  });
  if (!res.ok) {
    const { message } = await res.json().catch(() => ({}));
    throw new Error(message || "Upload failed");
  }
  const { url } = await res.json();
  return url as string;
}

export function ImagePickerField({
  label,
  value,
  onChange,
  theme,
  shape = "square",
  allowShapeSelection = false,
  onShapeChange,
  preserveAspectRatio = false,
  uploadEndpoint = "/api/admin/upload-image",
  uploadMethod = "POST",
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewRadius = shape === "circle" ? 40 : 14;
  const isDataUri = value.startsWith("data:");

  const handlePick = async () => {
    setLoading(true);
    setError(null);
    try {
      const url = await pickCompressUpload(
        shape,
        uploadEndpoint,
        uploadMethod,
        preserveAspectRatio,
      );
      onChange(url);
    } catch (e: any) {
      if (e.message !== "CANCELLED") {
        setError(e.message || "Failed to upload image");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <ThemedText style={[styles.label, { color: theme.textSecondary }]}>
        {label}
      </ThemedText>

      <View style={styles.fieldWrap}>
        {value ? (
          <View style={styles.previewWrap}>
            {preserveAspectRatio ? (
              <EventLogoImage
                uri={value}
                shape={shape}
                zoom={100}
                offsetX={0}
                offsetY={0}
                maxWidth={96}
                maxHeight={96}
              />
            ) : (
              <Image
                source={{ uri: value }}
                style={[styles.preview, { borderRadius: previewRadius }]}
                resizeMode={shape === "circle" ? "cover" : "contain"}
              />
            )}
            {isDataUri ? (
              <ThemedText style={[styles.hint, { color: theme.textSecondary }]}>
                Stored locally — configure hosted image storage for production
              </ThemedText>
            ) : null}
          </View>
        ) : null}

        {allowShapeSelection ? (
          <View style={styles.shapeRow}>
            <ThemedText
              style={[styles.shapeLabel, { color: theme.textSecondary }]}
            >
              Logo frame
            </ThemedText>
            {(["square", "circle"] as const).map((option) => (
              <Pressable
                key={option}
                onPress={() => onShapeChange?.(option)}
                style={[
                  styles.shapeOption,
                  {
                    borderColor:
                      shape === option ? theme.primary : theme.border,
                    backgroundColor:
                      shape === option ? `${theme.primary}16` : "transparent",
                  },
                ]}
              >
                <Feather
                  name={option === "circle" ? "circle" : "square"}
                  size={14}
                  color={shape === option ? theme.primary : theme.textSecondary}
                />
                <ThemedText style={{ fontSize: 12, color: theme.text }}>
                  {option === "circle" ? "Circle" : "Square"}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        ) : null}

        <Pressable
          onPress={handlePick}
          disabled={loading}
          style={[
            styles.pickerBtn,
            {
              backgroundColor: theme.backgroundSecondary,
              borderColor: theme.border,
            },
          ]}
        >
          {loading ? (
            <ActivityIndicator size="small" color={theme.textSecondary} />
          ) : (
            <Feather name="upload" size={16} color={theme.textSecondary} />
          )}
          <ThemedText style={{ fontSize: 14, color: theme.textSecondary }}>
            {loading ? "Uploading…" : value ? "Change Image" : "Upload Photo"}
          </ThemedText>
        </Pressable>

        {error ? (
          <ThemedText style={[styles.errorText, { color: AppColors.error }]}>
            {error}
          </ThemedText>
        ) : null}

        {value ? (
          <Pressable
            onPress={() => onChange("")}
            style={styles.removeBtn}
            hitSlop={8}
          >
            <ThemedText style={{ fontSize: 12, color: AppColors.error }}>
              Remove
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  fieldWrap: { marginBottom: Spacing.md },
  shapeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  shapeLabel: { fontSize: 12, marginRight: 2 },
  shapeOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  previewWrap: { alignItems: "center", marginBottom: 8 },
  preview: { width: 80, height: 80 },
  hint: { fontSize: 10, marginTop: 4, textAlign: "center" },
  pickerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
  },
  errorText: { fontSize: 12, marginTop: 6 },
  removeBtn: { alignItems: "center", marginTop: 6 },
});
