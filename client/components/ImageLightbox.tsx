import React, { useState } from "react";
import { Image, Modal, Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

export function ImageLightbox({
  uri,
  style,
  resizeMode = "contain",
  shape = "square",
}: {
  uri: string;
  style: any;
  resizeMode?: "cover" | "contain" | "stretch" | "center";
  shape?: "circle" | "square";
}) {
  const [visible, setVisible] = useState(false);
  return (
    <>
      <Pressable onPress={() => setVisible(true)}>
        <Image source={{ uri }} style={style} resizeMode={resizeMode} />
      </Pressable>
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={() => setVisible(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setVisible(false)}>
          <View style={styles.imageWrap}>
            <Image
              source={{ uri }}
              style={[
                styles.largeImage,
                shape === "circle" ? styles.circleImage : styles.squareImage,
              ]}
              resizeMode="contain"
            />
            <Pressable
              style={styles.close}
              onPress={() => setVisible(false)}
              hitSlop={10}
            >
              <Feather name="x" size={24} color="#fff" />
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.86)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  imageWrap: { width: "100%", height: "80%", alignItems: "center" },
  largeImage: { width: "100%", height: "100%" },
  squareImage: { maxWidth: "100%" },
  circleImage: {
    width: 240,
    height: 240,
    borderRadius: 9999,
  },
  close: {
    position: "absolute",
    right: 0,
    top: -36,
    padding: 4,
  },
});
