import React, { useEffect, useRef } from "react";
import {
  StyleSheet,
  View,
  Animated,
  Dimensions,
  Image,
  ScrollView,
} from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { GradientBackground } from "@/components/GradientBackground";
import { AppColors, Spacing } from "@/constants/theme";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

interface CheckInSuccessProps {
  attendeeName: string;
  onDismiss: () => void;
  variant?: "staff" | "attendee" | "caseStudy";
  caseStudyCompany?: string;
}

const { width, height } = Dimensions.get("window");

const CONFETTI_COLORS = [
  AppColors.accent,
  AppColors.primaryLight,
  AppColors.success,
  AppColors.warning,
  "#FFD700",
];

function Confetti() {
  const confettiPieces = useRef(
    Array.from({ length: 50 }, (_, i) => {
      const startX = (((i * 37 + 17) % 101) / 100) * width;
      return {
        x: new Animated.Value(startX),
        startX,
        y: new Animated.Value(-50),
        rotate: new Animated.Value(0),
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        delay: (((i * 53 + 29) % 101) / 100) * 500,
      };
    }),
  ).current;

  useEffect(() => {
    confettiPieces.forEach((piece) => {
      const targetX = piece.startX + (Math.random() - 0.5) * 200;

      Animated.parallel([
        Animated.timing(piece.y, {
          toValue: height + 50,
          duration: 2500 + Math.random() * 1000,
          delay: piece.delay,
          useNativeDriver: true,
        }),
        Animated.timing(piece.x, {
          toValue: targetX,
          duration: 2500 + Math.random() * 1000,
          delay: piece.delay,
          useNativeDriver: true,
        }),
        Animated.timing(piece.rotate, {
          toValue: 360 * (2 + Math.random() * 3),
          duration: 2500 + Math.random() * 1000,
          delay: piece.delay,
          useNativeDriver: true,
        }),
      ]).start();
    });
  }, [confettiPieces]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {confettiPieces.map((piece, index) => (
        <Animated.View
          key={index}
          style={[
            styles.confettiPiece,
            {
              backgroundColor: piece.color,
              transform: [
                { translateX: piece.x },
                { translateY: piece.y },
                {
                  rotate: piece.rotate.interpolate({
                    inputRange: [0, 360],
                    outputRange: ["0deg", "360deg"],
                  }),
                },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

export function CheckInSuccess({
  attendeeName,
  onDismiss,
  variant = "attendee",
  caseStudyCompany,
}: CheckInSuccessProps) {
  const logoScale = useRef(new Animated.Value(0)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    Animated.sequence([
      Animated.parallel([
        Animated.spring(logoScale, {
          toValue: 1,
          friction: 6,
          tension: 100,
          useNativeDriver: true,
        }),
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(textOpacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();

    const duration =
      variant === "attendee" || variant === "caseStudy" ? 5000 : 3500;
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [logoOpacity, logoScale, onDismiss, textOpacity, variant]);

  if (variant === "caseStudy") {
    return (
      <GradientBackground
        colors={[AppColors.primary, AppColors.primaryLight]}
        style={styles.container}
      >
        <Confetti />

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View
            style={[
              styles.staffIconContainer,
              {
                transform: [{ scale: logoScale }],
                opacity: logoOpacity,
              },
            ]}
          >
            <View
              style={[
                styles.checkCircle,
                { width: 90, height: 90, borderRadius: 45 },
              ]}
            >
              <Feather name="check" size={44} color="#FFFFFF" />
            </View>
          </Animated.View>

          <Animated.View
            style={[styles.textContainer, { opacity: textOpacity }]}
          >
            <ThemedText type="h1" style={styles.welcomeText}>
              Yay!
            </ThemedText>
            <ThemedText type="h2" style={styles.checkedInMessage}>
              You&apos;re checked in to
            </ThemedText>
            <ThemedText type="h1" style={[styles.eventName, { fontSize: 28 }]}>
              {caseStudyCompany || "your case study"}
            </ThemedText>
            <ThemedText
              style={[styles.staffSubtitle, { marginTop: Spacing.lg }]}
            >
              Enjoy your case study!
            </ThemedText>
          </Animated.View>
        </ScrollView>
      </GradientBackground>
    );
  }

  if (variant === "staff") {
    return (
      <GradientBackground
        colors={[AppColors.primary, AppColors.primaryLight]}
        style={styles.container}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View
            style={[
              styles.staffIconContainer,
              {
                transform: [{ scale: logoScale }],
                opacity: logoOpacity,
              },
            ]}
          >
            <View style={styles.checkCircle}>
              <Feather name="check" size={58} color="#FFFFFF" />
            </View>
          </Animated.View>

          <Animated.View
            style={[styles.textContainer, { opacity: textOpacity }]}
          >
            <ThemedText type="h2" style={styles.staffTitle}>
              Check-in Successful
            </ThemedText>
            <ThemedText type="h3" style={styles.attendeeName}>
              {attendeeName}
            </ThemedText>
            <ThemedText style={styles.staffSubtitle}>
              has been checked in
            </ThemedText>
          </Animated.View>
        </ScrollView>
      </GradientBackground>
    );
  }

  return (
    <GradientBackground
      colors={[AppColors.primary, AppColors.primaryLight]}
      style={styles.container}
    >
      <Confetti />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          style={[
            styles.logoContainer,
            {
              transform: [{ scale: logoScale }],
              opacity: logoOpacity,
            },
          ]}
        >
          <Image
            source={require("../../assets/images/celebration-logo.png")}
            style={styles.logo}
            resizeMode="contain"
          />
        </Animated.View>

        <Animated.View style={[styles.textContainer, { opacity: textOpacity }]}>
          <ThemedText type="h1" style={styles.welcomeText}>
            Yay!
          </ThemedText>
          <ThemedText type="h2" style={styles.checkedInMessage}>
            You are checked in for
          </ThemedText>
          <ThemedText type="h1" style={styles.eventName}>
            Stress Congress
          </ThemedText>
          <ThemedText type="h3" style={styles.attendeeName}>
            {attendeeName}
          </ThemedText>
        </Animated.View>
      </ScrollView>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    zIndex: 1000,
  },
  content: {
    flexGrow: 1,
    minHeight: "100%",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing["2xl"],
    paddingVertical: Spacing["3xl"],
  },
  logoContainer: {
    marginBottom: Spacing["3xl"],
  },
  logo: {
    width: 180,
    height: 180,
  },
  staffIconContainer: {
    marginBottom: Spacing["3xl"],
  },
  checkCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: AppColors.success,
    justifyContent: "center",
    alignItems: "center",
  },
  checkMark: {
    color: "#FFFFFF",
    fontSize: 60,
    fontWeight: "700",
    marginTop: -4,
  },
  textContainer: {
    alignItems: "center",
  },
  welcomeText: {
    color: "#FFFFFF",
    fontSize: 36,
    opacity: 0.9,
    marginBottom: Spacing.sm,
  },
  checkedInMessage: {
    color: "#FFFFFF",
    fontSize: 20,
    opacity: 0.85,
    textAlign: "center",
    marginBottom: Spacing.xs,
  },
  eventName: {
    color: "#FFFFFF",
    fontSize: 34,
    textAlign: "center",
    maxWidth: "100%",
    flexShrink: 1,
    marginBottom: Spacing["2xl"],
  },
  staffTitle: {
    color: "#FFFFFF",
    fontSize: 28,
    textAlign: "center",
    marginBottom: Spacing.xl,
  },
  staffSubtitle: {
    color: "#FFFFFF",
    opacity: 0.8,
    fontSize: 16,
    marginTop: Spacing.sm,
  },
  attendeeName: {
    color: "#FFFFFF",
    opacity: 0.9,
  },
  confettiPiece: {
    position: "absolute",
    width: 10,
    height: 10,
    borderRadius: 2,
  },
});
