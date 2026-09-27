import React, { useEffect, useRef, useState } from "react";
import {
  StyleSheet,
  View,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
  useWindowDimensions,
  AppState,
} from "react-native";
import * as SecureStore from "expo-secure-store";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import {
  useAuth,
  type EmailLoginResult,
  type LoginEventOption,
} from "@/contexts/AuthContext";
import { useEventTheme } from "@/contexts/EventThemeContext";
import {
  BorderRadius,
  getEventGradientReadability,
  getReadableTextColor,
  getReadableEventGradient,
  Spacing,
} from "@/constants/theme";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { EventLogoImage } from "@/components/EventLogoImage";

type Step =
  | "login_email"
  | "select_event"
  | "login_password"
  | "activation_code"
  | "create_password"
  | "forgot_email"
  | "forgot_code"
  | "forgot_new_password";

const PENDING_ACTIVATION_KEY = "pending_activation_context";

type PendingActivationContext = {
  email: string;
  eventId?: string;
  savedAt: number;
};

async function savePendingActivation(
  email: string,
  eventId?: string,
): Promise<void> {
  const value = JSON.stringify({
    email,
    ...(eventId ? { eventId } : {}),
    savedAt: Date.now(),
  } satisfies PendingActivationContext);
  try {
    if (Platform.OS === "web") {
      localStorage.setItem(PENDING_ACTIVATION_KEY, value);
    } else {
      await SecureStore.setItemAsync(PENDING_ACTIVATION_KEY, value);
    }
  } catch {
    // Recovery storage is a convenience; it must never block activation.
  }
}

async function loadPendingActivation(): Promise<PendingActivationContext | null> {
  try {
    const value =
      Platform.OS === "web"
        ? localStorage.getItem(PENDING_ACTIVATION_KEY)
        : await SecureStore.getItemAsync(PENDING_ACTIVATION_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<PendingActivationContext>;
    if (
      typeof parsed.email !== "string" ||
      typeof parsed.savedAt !== "number" ||
      Date.now() - parsed.savedAt > 24 * 60 * 60 * 1000
    ) {
      await clearPendingActivation();
      return null;
    }
    return {
      email: normalizeEmail(parsed.email),
      eventId: typeof parsed.eventId === "string" ? parsed.eventId : undefined,
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

async function clearPendingActivation(): Promise<void> {
  try {
    if (Platform.OS === "web") {
      localStorage.removeItem(PENDING_ACTIVATION_KEY);
    } else {
      await SecureStore.deleteItemAsync(PENDING_ACTIVATION_KEY);
    }
  } catch {
    // Recovery storage is best effort and is never part of auth security.
  }
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase().replace(/\.+$/, "");
}

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const {
    login,
    setupPassword,
    requestActivation,
    forgotPassword,
    verifyResetCode,
    verifyActivationCode,
    resetPassword,
  } = useAuth();
  const eventTheme = useEventTheme();

  const [step, setStep] = useState<Step>("login_email");
  const [email, setEmail] = useState("");
  const [password, setPasswordValue] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [activationBlocked, setActivationBlocked] = useState(false);
  const [resetCodeBlocked, setResetCodeBlocked] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [eventOptions, setEventOptions] = useState<LoginEventOption[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | undefined>();
  const [activationRecoveryMessage, setActivationRecoveryMessage] =
    useState("");
  const appWasInactiveRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    void loadPendingActivation().then((pending) => {
      if (!mounted || !pending) return;
      setEmail(pending.email);
      setSelectedEventId(pending.eventId);
      setOtpCode("");
      setActivationBlocked(false);
      setResendCooldown(0);
      setActivationRecoveryMessage(
        "Welcome back. Enter your activation code again. If it has expired, request a new one below.",
      );
      setStep("activation_code");
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const recoverActivation = () => {
      if (step !== "activation_code" && step !== "create_password") return;
      if (step === "create_password") {
        setStep("activation_code");
        setOtpCode("");
        setPasswordValue("");
        setConfirmPassword("");
        setError("");
        setActivationRecoveryMessage(
          "Welcome back. For security, verify your activation code again before creating a password.",
        );
      } else {
        setActivationRecoveryMessage(
          "Welcome back. Your email is still selected. Enter the activation code again or request a new one below.",
        );
      }
    };
    const handleAppStateChange = (nextState: string) => {
      if (nextState !== "active") {
        appWasInactiveRef.current = true;
        return;
      }
      if (appWasInactiveRef.current) {
        appWasInactiveRef.current = false;
        recoverActivation();
      }
    };
    const subscription = AppState.addEventListener(
      "change",
      handleAppStateChange,
    );
    let handleVisibilityChange: (() => void) | undefined;
    if (Platform.OS === "web" && typeof document !== "undefined") {
      handleVisibilityChange = () => {
        if (document.visibilityState === "hidden") {
          appWasInactiveRef.current = true;
        } else if (appWasInactiveRef.current) {
          appWasInactiveRef.current = false;
          recoverActivation();
        }
      };
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }
    return () => {
      subscription.remove();
      if (handleVisibilityChange) {
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
      }
    };
  }, [step]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((current) => Math.max(0, current - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const clearError = () => setError("");
  const primaryColor = eventTheme.primaryColor;
  const accentColor = eventTheme.accentColor;
  const accentTextColor = getReadableTextColor(accentColor);
  const isNoLiveEvent = !eventTheme.isLoading && !eventTheme.eventId;
  const gradientColors = getReadableEventGradient(
    eventTheme.gradientStart,
    eventTheme.gradientEnd,
  );
  const gradientReadability = getEventGradientReadability(
    eventTheme.gradientStart,
    eventTheme.gradientEnd,
  );
  const gradientForeground = gradientReadability.foreground;
  const gradientMutedForeground = isNoLiveEvent
    ? "rgba(255,255,255,0.72)"
    : gradientReadability.mutedForeground;
  const eventName = isNoLiveEvent ? "No live event" : eventTheme.eventName;
  const eventDisplayName =
    !isNoLiveEvent && eventTheme.year
      ? eventName
          .trim()
          .replace(new RegExp(`(?:\\s|-)?${eventTheme.year}$`), "")
          .trim() || eventName
      : eventName;
  const eventYear =
    !isNoLiveEvent && eventTheme.showYearOnLogin ? eventTheme.year : null;
  const displayDate = isNoLiveEvent ? null : eventTheme.displayDate;
  const showEventYears = eventOptions.some(
    (event) => event.showYearOnLogin !== false,
  );
  const hasPasswordLength = password.length >= 8;
  const hasPasswordNumber = /\d/.test(password);
  const passwordsMatch =
    confirmPassword.length > 0 && password === confirmPassword;
  const hasActivationCode = otpCode.trim().length === 6;

  const startAccountSetup = async (
    normalizedEmail: string,
    eventId?: string,
  ) => {
    setIsLoading(true);
    clearError();
    const codeResult = await requestActivation(normalizedEmail, eventId);
    setIsLoading(false);
    if (codeResult.success) {
      await savePendingActivation(normalizedEmail, eventId);
      setOtpCode("");
      setActivationBlocked(false);
      setResendCooldown(30);
      setActivationRecoveryMessage("");
      setStep("activation_code");
    } else {
      setError(codeResult.error || "Unable to start account setup");
    }
  };

  const continueWithAccount = async (
    result: EmailLoginResult,
    eventId?: string,
    accountEmail = email,
  ) => {
    setSelectedEventId(eventId ?? result.event?.id);
    if (result.needsSetup) {
      await startAccountSetup(accountEmail, eventId ?? result.event?.id);
      return;
    }
    if (result.needsPassword) {
      setStep("login_password");
      return;
    }
    setError(result.error || "This email cannot sign in.");
  };

  const handleEmailSubmit = async () => {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      setError("Please enter your email address");
      return;
    }
    void clearPendingActivation();
    setEmail(normalizedEmail);
    setSelectedEventId(undefined);
    setEventOptions([]);
    setIsLoading(true);
    clearError();
    const result = await login(normalizedEmail);
    setIsLoading(false);
    if (result.eventSelectionRequired && result.eventOptions?.length) {
      setEventOptions(result.eventOptions);
      setStep("select_event");
      return;
    }
    await continueWithAccount(result, undefined, normalizedEmail);
  };

  const handleEventSelection = async (event: LoginEventOption) => {
    clearError();
    await continueWithAccount(
      {
        success: false,
        needsPassword: !event.needsSetup,
        needsSetup: event.needsSetup,
        event,
      },
      event.id,
      email,
    );
  };

  const handleCreatePassword = async () => {
    if (!password || password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (!/\d/.test(password)) {
      setError("Password must contain at least one number");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (otpCode.trim().length !== 6) {
      setError("Please enter the 6-digit activation code");
      return;
    }
    setIsLoading(true);
    clearError();
    const normalizedEmail = normalizeEmail(email);
    setEmail(normalizedEmail);
    const result = await setupPassword(
      normalizedEmail,
      password,
      otpCode.trim(),
      selectedEventId,
    );
    setIsLoading(false);
    if (result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setEmail(normalizedEmail);
      setResetEmail("");
      setOtpCode("");
      setPasswordValue("");
      setConfirmPassword("");
      setResetCodeBlocked(false);
      setResendCooldown(0);
      await clearPendingActivation();
      setActivationRecoveryMessage("");
      clearError();
      setStep("login_email");
    } else {
      if (result.errorCode === "VERIFICATION_ATTEMPTS_EXCEEDED") {
        setActivationBlocked(true);
      }
      const message = result.error || "Failed to create password";
      if (/expired|invalid/i.test(message)) {
        setStep("activation_code");
        setOtpCode("");
        setPasswordValue("");
        setConfirmPassword("");
        setActivationRecoveryMessage(
          "Your activation code expired before the password was saved. Request a new code below.",
        );
      } else if (/network|connection|reach/i.test(message)) {
        setActivationRecoveryMessage(
          "The connection was lost. Try creating the password again; your email and event are still selected.",
        );
      }
      setError(message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleVerifyActivationCode = async () => {
    if (activationBlocked) return;
    if (otpCode.trim().length !== 6) {
      setError("Please enter the 6-digit activation code");
      return;
    }
    setIsLoading(true);
    clearError();
    const result = await verifyActivationCode(
      normalizeEmail(email),
      otpCode.trim(),
      selectedEventId,
    );
    setIsLoading(false);
    if (result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPasswordValue("");
      setConfirmPassword("");
      clearError();
      setActivationRecoveryMessage("");
      setStep("create_password");
    } else {
      if (result.errorCode === "VERIFICATION_ATTEMPTS_EXCEEDED") {
        setActivationBlocked(true);
        setOtpCode("");
      }
      const message = result.error || "Invalid or expired activation code";
      setError(message);
      if (/expired|invalid/i.test(message)) {
        setActivationRecoveryMessage(
          "This code may have expired. Request a new activation code below and keep this email selected.",
        );
      } else if (/network|connection|reach/i.test(message)) {
        setActivationRecoveryMessage(
          "The connection was lost. Try verifying the same code again; your email and event are still selected.",
        );
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handlePasswordSubmit = async () => {
    if (!password) {
      setError("Please enter your password");
      return;
    }
    setIsLoading(true);
    clearError();
    const normalizedEmail = normalizeEmail(email);
    setEmail(normalizedEmail);
    const result = await login(normalizedEmail, password, selectedEventId);
    setIsLoading(false);
    if (result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      setError(result.error || "Invalid password");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleRequestActivation = async () => {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      setError("Please enter your email address");
      return;
    }
    setEmail(normalizedEmail);
    setIsLoading(true);
    clearError();
    const codeResult = await requestActivation(
      normalizedEmail,
      selectedEventId,
    );
    setIsLoading(false);
    if (codeResult.success) {
      await savePendingActivation(normalizedEmail, selectedEventId);
      setOtpCode("");
      setActivationBlocked(false);
      setResendCooldown(30);
      setActivationRecoveryMessage("");
      setStep("activation_code");
    } else {
      setError(codeResult.error || "Failed to send verification code");
    }
  };

  const handleForgotEmailSubmit = async () => {
    const targetEmail = normalizeEmail(resetEmail);
    if (!targetEmail) {
      setError("Please enter your email address");
      return;
    }
    setResetEmail(targetEmail);
    setIsLoading(true);
    clearError();
    const result = await forgotPassword(targetEmail, selectedEventId);
    setIsLoading(false);
    if (result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setOtpCode("");
      setResetCodeBlocked(false);
      setResendCooldown(30);
      setStep("forgot_code");
    } else {
      if (result.errorCode === "RESEND_COOLDOWN") {
        setResendCooldown(result.retryAfterSeconds || 30);
      }
      setError(result.error || "Failed to send reset code");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleVerifyCode = async () => {
    if (resetCodeBlocked) return;
    if (!otpCode.trim() || otpCode.trim().length < 6) {
      setError("Please enter the 6-digit code");
      return;
    }
    setIsLoading(true);
    clearError();
    const result = await verifyResetCode(
      normalizeEmail(resetEmail),
      otpCode.trim(),
      selectedEventId,
    );
    setIsLoading(false);
    if (result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPasswordValue("");
      setConfirmPassword("");
      setStep("forgot_new_password");
    } else {
      if (result.errorCode === "VERIFICATION_ATTEMPTS_EXCEEDED") {
        setResetCodeBlocked(true);
        setOtpCode("");
      }
      setError(result.error || "Invalid or expired code");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleResetPassword = async () => {
    if (!password || password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (!/\d/.test(password)) {
      setError("Password must contain at least one number");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setIsLoading(true);
    clearError();
    const result = await resetPassword(
      normalizeEmail(resetEmail),
      otpCode.trim(),
      password,
      selectedEventId,
    );
    setIsLoading(false);
    if (result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setEmail(email.trim().toLowerCase());
      setResetEmail("");
      setOtpCode("");
      setPasswordValue("");
      setConfirmPassword("");
      setResetCodeBlocked(false);
      setResendCooldown(0);
      setShowPassword(false);
      clearError();
      setStep("login_email");
    } else {
      setError(result.error || "Password reset failed");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleBack = () => {
    clearError();
    if (step === "login_password") {
      setStep("login_email");
      setPasswordValue("");
      setSelectedEventId(undefined);
    } else if (step === "select_event") {
      setStep("login_email");
      setEventOptions([]);
      setSelectedEventId(undefined);
    } else if (step === "activation_code") {
      void clearPendingActivation();
      setStep("login_email");
      setOtpCode("");
      setActivationBlocked(false);
      setActivationRecoveryMessage("");
    } else if (step === "create_password") {
      setStep("activation_code");
      setPasswordValue("");
      setConfirmPassword("");
      setActivationRecoveryMessage("");
    } else if (step === "forgot_email") {
      setStep("login_password");
      setPasswordValue("");
    } else if (step === "forgot_code") {
      setStep("forgot_email");
      setOtpCode("");
    } else if (step === "forgot_new_password") {
      setStep("forgot_code");
      setPasswordValue("");
      setConfirmPassword("");
    }
  };

  const showBackButton = step !== "login_email";

  return (
    <View style={styles.root}>
      <LinearGradient
        testID="login-gradient"
        colors={gradientColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View
        pointerEvents="none"
        style={[
          styles.gradientReadabilityOverlay,
          { backgroundColor: gradientReadability.overlay },
        ]}
      />
      <View style={[styles.blob1, { backgroundColor: accentColor }]} />
      <View style={styles.blob2} />
      <View style={styles.blob3} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.spacer} />

          <View style={styles.brand}>
            {eventTheme.logoUrl ? (
              <EventLogoImage
                frameTestID="event-logo-frame"
                imageTestID="event-logo"
                uri={eventTheme.logoUrl}
                shape={eventTheme.logoShape}
                zoom={eventTheme.logoZoom}
                offsetX={eventTheme.logoOffsetX}
                offsetY={eventTheme.logoOffsetY}
                maxWidth={Math.min(280, Math.max(0, windowWidth - 48))}
                maxHeight={148}
                accessibilityLabel={`${eventTheme.eventName} logo`}
                frameStyle={styles.eventLogoFrame}
              />
            ) : null}
            <ThemedText
              type="h1"
              style={[styles.eventTitle, { color: gradientForeground }]}
              testID="login-event-name"
            >
              {eventDisplayName}
            </ThemedText>
            {eventYear ? (
              <ThemedText
                testID="login-event-year"
                style={[styles.eventYear, { color: gradientMutedForeground }]}
              >
                {eventYear}
              </ThemedText>
            ) : null}
            {displayDate ? (
              <View style={styles.datePill}>
                <Feather
                  name="calendar"
                  size={12}
                  color={gradientMutedForeground}
                />
                <ThemedText
                  style={[styles.dateLabel, { color: gradientMutedForeground }]}
                >
                  {displayDate}
                </ThemedText>
              </View>
            ) : null}
            {eventTheme.tagline ? (
              <ThemedText
                testID="login-event-tagline"
                style={[
                  styles.eventTagline,
                  { color: gradientMutedForeground },
                ]}
                numberOfLines={3}
              >
                {eventTheme.tagline}
              </ThemedText>
            ) : null}
            {isNoLiveEvent ? (
              <ThemedText
                style={[
                  styles.noEventMessage,
                  { color: gradientMutedForeground },
                ]}
              >
                No event is currently published. Administrators can still sign
                in to prepare the next event.
              </ThemedText>
            ) : null}
          </View>

          <View
            style={[
              styles.form,
              eventTheme.eventId ? { borderColor: primaryColor } : null,
            ]}
            testID="login-form"
          >
            {showBackButton ? (
              <Pressable
                onPress={handleBack}
                style={styles.backBtn}
                testID="button-back"
              >
                <Feather
                  name="arrow-left"
                  size={16}
                  color={gradientForeground}
                />
              </Pressable>
            ) : null}

            {step === "activation_code" || step === "create_password" ? (
              <ActivationStepIndicator
                currentStep={step === "activation_code" ? 1 : 2}
                activeColor={accentColor}
                textColor={gradientForeground}
                mutedColor={gradientMutedForeground}
              />
            ) : null}
            {activationRecoveryMessage ? (
              <View
                style={styles.activationRecoveryNotice}
                testID="activation-recovery-message"
              >
                <Feather
                  name="info"
                  size={15}
                  color={gradientMutedForeground}
                />
                <ThemedText
                  style={[
                    styles.activationRecoveryText,
                    { color: gradientMutedForeground },
                  ]}
                >
                  {activationRecoveryMessage}
                </ThemedText>
              </View>
            ) : null}

            {step === "login_email" && (
              <>
                <ThemedText
                  type="h3"
                  style={[styles.formTitle, { color: gradientForeground }]}
                >
                  Welcome back
                </ThemedText>
                <ThemedText
                  style={[styles.formSub, { color: gradientMutedForeground }]}
                >
                  Sign in with your registered email to access the event
                </ThemedText>
                <InputRow
                  icon="mail"
                  placeholder="Email address"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="username"
                  textContentType="username"
                  importantForAutofill="yes"
                  editable={!isLoading && !activationBlocked}
                  testID="input-email"
                />
                {error ? <ErrorBanner message={error} /> : null}
                <Button
                  onPress={handleEmailSubmit}
                  disabled={isLoading}
                  textColor={accentTextColor}
                  style={[styles.cta, { backgroundColor: accentColor }]}
                  testID="button-continue"
                >
                  {isLoading ? "Checking..." : "Continue"}
                </Button>
                <ThemedText
                  style={[styles.hint, { color: gradientMutedForeground }]}
                >
                  We will check your event registration, then guide you to sign
                  in or set up your invited account.
                </ThemedText>
              </>
            )}

            {step === "select_event" && (
              <>
                <ThemedText
                  type="h3"
                  style={[styles.formTitle, { color: gradientForeground }]}
                >
                  {showEventYears
                    ? "Choose your event year"
                    : "Choose your event"}
                </ThemedText>
                <ThemedText
                  style={[styles.formSub, { color: gradientMutedForeground }]}
                >
                  This email is registered for more than one event. Select the
                  event you want to access.
                </ThemedText>
                {eventOptions.map((event) => (
                  <Pressable
                    key={event.id}
                    onPress={() => void handleEventSelection(event)}
                    disabled={isLoading}
                    style={styles.eventChoice}
                    testID={`button-event-${event.id}`}
                  >
                    <View style={styles.eventChoiceText}>
                      <ThemedText
                        style={[
                          styles.eventChoiceTitle,
                          { color: gradientForeground },
                        ]}
                      >
                        {event.name
                          .trim()
                          .replace(new RegExp(`(?:\\s|-)?${event.year}$`), "")
                          .trim() || event.name}
                      </ThemedText>
                      {event.showYearOnLogin !== false ? (
                        <ThemedText
                          style={[
                            styles.eventChoiceYear,
                            { color: gradientForeground },
                          ]}
                        >
                          {event.year}
                        </ThemedText>
                      ) : null}
                      <ThemedText
                        style={[
                          styles.eventChoiceMeta,
                          { color: gradientMutedForeground },
                        ]}
                      >
                        {event.status === "published"
                          ? "Live event"
                          : "Previous event"}
                      </ThemedText>
                    </View>
                    <Feather
                      name="chevron-right"
                      size={20}
                      color={gradientForeground}
                    />
                  </Pressable>
                ))}
                {error ? <ErrorBanner message={error} /> : null}
              </>
            )}

            {step === "activation_code" && (
              <>
                <ThemedText
                  type="h3"
                  style={[styles.formTitle, { color: gradientForeground }]}
                  testID="activation-heading"
                >
                  Step 1 of 2: Verify activation code
                </ThemedText>
                <ThemedText
                  style={[styles.formSub, { color: gradientMutedForeground }]}
                >
                  Enter the 6-digit code sent to {email}. Your password screen
                  will open only after this code is verified.
                </ThemedText>
                <InputRow
                  icon="shield"
                  placeholder="6-digit activation code"
                  value={otpCode}
                  onChangeText={setOtpCode}
                  keyboardType="number-pad"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  editable={!isLoading && !activationBlocked}
                  testID="input-activation-code"
                />
                {error ? <ErrorBanner message={error} /> : null}
                <Button
                  onPress={handleVerifyActivationCode}
                  disabled={
                    isLoading || activationBlocked || !hasActivationCode
                  }
                  textColor={accentTextColor}
                  style={[styles.cta, { backgroundColor: accentColor }]}
                  testID="button-verify-activation"
                >
                  {isLoading
                    ? "Checking..."
                    : activationBlocked
                      ? "Verification blocked"
                      : "Verify Code"}
                </Button>
                <Pressable
                  onPress={handleRequestActivation}
                  disabled={
                    isLoading || activationBlocked || resendCooldown > 0
                  }
                  style={styles.linkBtn}
                  testID="button-resend-activation"
                >
                  <ThemedText
                    style={[
                      styles.linkText,
                      resendCooldown > 0 && styles.disabledLinkText,
                    ]}
                  >
                    {resendCooldown > 0
                      ? `Resend code in ${resendCooldown}s`
                      : "Resend activation code"}
                  </ThemedText>
                </Pressable>
              </>
            )}

            {step === "create_password" && (
              <>
                <ThemedText
                  type="h3"
                  style={[styles.formTitle, { color: gradientForeground }]}
                  testID="create-password-heading"
                >
                  Step 2 of 2: Create your password
                </ThemedText>
                <ThemedText
                  style={[styles.formSub, { color: gradientMutedForeground }]}
                >
                  Activation code verified. Choose a secure password for your
                  account.
                </ThemedText>
                <InputRow
                  icon="lock"
                  placeholder="New password (min. 8 characters)"
                  value={password}
                  onChangeText={setPasswordValue}
                  secureTextEntry={!showPassword}
                  autoComplete="new-password"
                  textContentType="newPassword"
                  importantForAutofill="yes"
                  editable={!isLoading}
                  testID="input-create-password"
                  rightEl={
                    <Pressable
                      onPress={() => setShowPassword(!showPassword)}
                      style={styles.eyeBtn}
                    >
                      <Feather
                        name={showPassword ? "eye-off" : "eye"}
                        size={18}
                        color="#A1A1AA"
                      />
                    </Pressable>
                  }
                />
                <InputRow
                  icon="lock"
                  placeholder="Confirm password"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showPassword}
                  autoComplete="new-password"
                  textContentType="newPassword"
                  importantForAutofill="yes"
                  editable={!isLoading}
                  testID="input-create-confirm-password"
                />
                <PasswordRequirements
                  textColor={gradientMutedForeground}
                  passwordLengthValid={hasPasswordLength}
                  passwordNumberValid={hasPasswordNumber}
                  passwordTouched={password.length > 0}
                />
                {confirmPassword.length > 0 && !passwordsMatch ? (
                  <ThemedText
                    style={[
                      styles.passwordMatchHint,
                      { color: gradientMutedForeground },
                    ]}
                  >
                    Passwords do not match yet
                  </ThemedText>
                ) : null}
                {error ? <ErrorBanner message={error} /> : null}
                <Button
                  onPress={handleCreatePassword}
                  disabled={
                    isLoading ||
                    activationBlocked ||
                    !hasPasswordLength ||
                    !hasPasswordNumber ||
                    !passwordsMatch
                  }
                  textColor={accentTextColor}
                  style={[styles.cta, { backgroundColor: accentColor }]}
                  testID="button-create-password"
                >
                  {isLoading ? "Creating..." : "Create Password & Sign In"}
                </Button>
              </>
            )}

            {step === "login_password" && (
              <>
                <ThemedText
                  type="h3"
                  style={[styles.formTitle, { color: gradientForeground }]}
                >
                  Enter password
                </ThemedText>
                <ThemedText
                  style={[styles.formSub, { color: gradientMutedForeground }]}
                >
                  Signing in as {email}
                </ThemedText>
                <InputRow
                  icon="lock"
                  placeholder="Password"
                  value={password}
                  onChangeText={setPasswordValue}
                  secureTextEntry={!showPassword}
                  autoComplete="current-password"
                  textContentType="password"
                  importantForAutofill="yes"
                  editable={!isLoading}
                  testID="input-password"
                  rightEl={
                    <Pressable
                      onPress={() => setShowPassword(!showPassword)}
                      style={styles.eyeBtn}
                    >
                      <Feather
                        name={showPassword ? "eye-off" : "eye"}
                        size={18}
                        color="#A1A1AA"
                      />
                    </Pressable>
                  }
                />
                {error ? <ErrorBanner message={error} /> : null}
                <Button
                  onPress={handlePasswordSubmit}
                  disabled={isLoading}
                  textColor={accentTextColor}
                  style={[styles.cta, { backgroundColor: accentColor }]}
                  testID="button-signin-submit"
                >
                  {isLoading ? "Signing in..." : "Sign In"}
                </Button>
                <Pressable
                  onPress={() => {
                    clearError();
                    setPasswordValue("");
                    setResetEmail(email.trim().toLowerCase());
                    setStep("forgot_email");
                  }}
                  style={styles.linkBtn}
                  testID="button-forgot-password"
                >
                  <ThemedText
                    style={[
                      styles.linkText,
                      { color: gradientMutedForeground },
                    ]}
                  >
                    Forgot password?
                  </ThemedText>
                </Pressable>
              </>
            )}

            {step === "forgot_email" && (
              <>
                <ThemedText
                  type="h3"
                  style={[styles.formTitle, { color: gradientForeground }]}
                >
                  Reset password
                </ThemedText>
                <ThemedText
                  style={[styles.formSub, { color: gradientMutedForeground }]}
                >
                  We will send a 6-digit code to the email registered for this
                  account.
                </ThemedText>
                <InputRow
                  icon="mail"
                  placeholder="Email address"
                  value={resetEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="username"
                  textContentType="username"
                  importantForAutofill="yes"
                  editable={false}
                  testID="input-forgot-email"
                />
                {error ? <ErrorBanner message={error} /> : null}
                <Button
                  onPress={handleForgotEmailSubmit}
                  disabled={isLoading}
                  textColor={accentTextColor}
                  style={[styles.cta, { backgroundColor: accentColor }]}
                  testID="button-forgot-continue"
                >
                  {isLoading ? "Sending code..." : "Send Code"}
                </Button>
              </>
            )}

            {step === "forgot_code" && (
              <>
                <ThemedText
                  type="h3"
                  style={[styles.formTitle, { color: gradientForeground }]}
                >
                  Enter code
                </ThemedText>
                <ThemedText
                  style={[styles.formSub, { color: gradientMutedForeground }]}
                >
                  A 6-digit code was sent to {resetEmail}. Check your inbox.
                </ThemedText>
                <InputRow
                  icon="shield"
                  placeholder="6-digit code"
                  value={otpCode}
                  onChangeText={setOtpCode}
                  keyboardType="number-pad"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  editable={!isLoading}
                  testID="input-otp-code"
                />
                {error ? <ErrorBanner message={error} /> : null}
                <Button
                  onPress={handleVerifyCode}
                  disabled={isLoading || resetCodeBlocked}
                  textColor={accentTextColor}
                  style={[styles.cta, { backgroundColor: accentColor }]}
                  testID="button-verify-code"
                >
                  {isLoading
                    ? "Verifying..."
                    : resetCodeBlocked
                      ? "Verification blocked"
                      : "Verify Code"}
                </Button>
                <Pressable
                  onPress={handleForgotEmailSubmit}
                  style={styles.linkBtn}
                  disabled={isLoading || resendCooldown > 0}
                  testID="button-resend-code"
                >
                  <ThemedText
                    style={[
                      styles.linkText,
                      resendCooldown > 0 && styles.disabledLinkText,
                    ]}
                  >
                    {resendCooldown > 0
                      ? `Resend code in ${resendCooldown}s`
                      : "Resend code"}
                  </ThemedText>
                </Pressable>
              </>
            )}

            {step === "forgot_new_password" && (
              <>
                <ThemedText
                  type="h3"
                  style={[styles.formTitle, { color: gradientForeground }]}
                >
                  New password
                </ThemedText>
                <ThemedText
                  style={[styles.formSub, { color: gradientMutedForeground }]}
                >
                  Choose a secure password for your account. The requirements
                  are shown below.
                </ThemedText>
                <PasswordRequirements
                  textColor={gradientMutedForeground}
                  passwordLengthValid={hasPasswordLength}
                  passwordNumberValid={hasPasswordNumber}
                  passwordTouched={password.length > 0}
                />
                <InputRow
                  icon="lock"
                  placeholder="New password"
                  value={password}
                  onChangeText={setPasswordValue}
                  secureTextEntry={!showPassword}
                  autoComplete="new-password"
                  textContentType="newPassword"
                  importantForAutofill="yes"
                  editable={!isLoading}
                  testID="input-new-password"
                  rightEl={
                    <Pressable
                      onPress={() => setShowPassword(!showPassword)}
                      style={styles.eyeBtn}
                    >
                      <Feather
                        name={showPassword ? "eye-off" : "eye"}
                        size={18}
                        color="#A1A1AA"
                      />
                    </Pressable>
                  }
                />
                <InputRow
                  icon="lock"
                  placeholder="Confirm password"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showPassword}
                  autoComplete="new-password"
                  textContentType="newPassword"
                  importantForAutofill="yes"
                  editable={!isLoading}
                  testID="input-confirm-password"
                />
                {error ? <ErrorBanner message={error} /> : null}
                <Button
                  onPress={handleResetPassword}
                  disabled={
                    isLoading ||
                    !hasPasswordLength ||
                    !hasPasswordNumber ||
                    !passwordsMatch
                  }
                  textColor={accentTextColor}
                  style={[styles.cta, { backgroundColor: accentColor }]}
                  testID="button-reset-password"
                >
                  {isLoading ? "Saving..." : "Set New Password"}
                </Button>
              </>
            )}
          </View>

          <View style={styles.spacer} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function ActivationStepIndicator({
  currentStep,
  activeColor,
  textColor,
  mutedColor,
}: {
  currentStep: 1 | 2;
  activeColor: string;
  textColor: string;
  mutedColor: string;
}) {
  const { width } = useWindowDimensions();
  const compact = width <= 360;

  return (
    <View
      style={styles.activationStepIndicator}
      testID="activation-step-indicator"
      accessibilityLabel={`Account setup, step ${currentStep} of 2`}
    >
      <ThemedText style={[styles.activationStepEyebrow, { color: mutedColor }]}>
        ACCOUNT SETUP
      </ThemedText>
      <View
        style={[
          styles.activationStepTrack,
          compact && styles.activationStepTrackCompact,
        ]}
      >
        <ActivationStep
          number="1"
          label="Verify code"
          active={currentStep === 1}
          complete={currentStep === 2}
          activeColor={activeColor}
          textColor={textColor}
          mutedColor={mutedColor}
          compact={compact}
        />
        <View
          style={[
            styles.activationStepConnector,
            compact && styles.activationStepConnectorCompact,
            {
              backgroundColor:
                currentStep === 2 ? activeColor : "rgba(255,255,255,0.2)",
            },
          ]}
        />
        <ActivationStep
          number="2"
          label="Create password"
          active={currentStep === 2}
          complete={false}
          activeColor={activeColor}
          textColor={textColor}
          mutedColor={mutedColor}
          compact={compact}
        />
      </View>
    </View>
  );
}

function ActivationStep({
  number,
  label,
  active,
  complete,
  activeColor,
  textColor,
  mutedColor,
  compact,
}: {
  number: string;
  label: string;
  active: boolean;
  complete: boolean;
  activeColor: string;
  textColor: string;
  mutedColor: string;
  compact: boolean;
}) {
  return (
    <View
      style={[styles.activationStep, compact && styles.activationStepCompact]}
    >
      <View
        style={[
          styles.activationStepNumber,
          {
            backgroundColor: active || complete ? activeColor : "transparent",
            borderColor: active || complete ? activeColor : mutedColor,
          },
        ]}
      >
        {complete ? (
          <Feather
            name="check"
            size={13}
            color={getReadableTextColor(activeColor)}
          />
        ) : (
          <ThemedText
            style={[
              styles.activationStepNumberText,
              {
                color: active ? getReadableTextColor(activeColor) : mutedColor,
              },
            ]}
          >
            {number}
          </ThemedText>
        )}
      </View>
      <ThemedText
        style={[
          styles.activationStepLabel,
          { color: active || complete ? textColor : mutedColor },
        ]}
        numberOfLines={1}
      >
        {label}
      </ThemedText>
    </View>
  );
}

function PasswordRequirements({
  textColor,
  passwordLengthValid,
  passwordNumberValid,
  passwordTouched,
}: {
  textColor: string;
  passwordLengthValid: boolean;
  passwordNumberValid: boolean;
  passwordTouched: boolean;
}) {
  return (
    <View style={styles.passwordRequirements}>
      <ThemedText
        style={[styles.passwordRequirementsTitle, { color: textColor }]}
      >
        Password requirements
      </ThemedText>
      <PasswordRequirement
        label="At least 8 characters"
        met={passwordLengthValid}
        textColor={textColor}
        showInvalid={passwordTouched}
        testID="password-requirement-length"
      />
      <PasswordRequirement
        label="At least one number"
        met={passwordNumberValid}
        textColor={textColor}
        showInvalid={passwordTouched}
        testID="password-requirement-number"
      />
    </View>
  );
}

function PasswordRequirement({
  label,
  met,
  textColor,
  showInvalid,
  testID,
}: {
  label: string;
  met: boolean;
  textColor: string;
  showInvalid: boolean;
  testID: string;
}) {
  const iconName = met ? "check-circle" : showInvalid ? "x-circle" : "circle";
  const statusColor = met ? "#86EFAC" : showInvalid ? "#FCA5A5" : textColor;
  return (
    <View
      style={styles.passwordRequirementRow}
      testID={testID}
      accessibilityRole="text"
      accessibilityLabel={`${label}: ${
        met ? "complete" : showInvalid ? "not met" : "not checked"
      }`}
    >
      <Feather name={iconName} size={15} color={statusColor} />
      <ThemedText
        style={[
          styles.passwordRequirementText,
          { color: met ? "#DCFCE7" : showInvalid ? "#FECACA" : textColor },
        ]}
      >
        {label}
      </ThemedText>
    </View>
  );
}

function InputRow({
  icon,
  placeholder,
  value,
  onChangeText,
  keyboardType,
  autoCapitalize,
  autoCorrect,
  secureTextEntry,
  autoComplete,
  textContentType,
  importantForAutofill,
  editable,
  testID,
  rightEl,
}: any) {
  return (
    <View style={inputStyles.wrap}>
      <Feather name={icon} size={17} color="#A1A1AA" style={inputStyles.icon} />
      <TextInput
        style={inputStyles.input}
        placeholder={placeholder}
        placeholderTextColor="#A1A1AA"
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        secureTextEntry={secureTextEntry}
        autoComplete={autoComplete}
        textContentType={textContentType}
        importantForAutofill={importantForAutofill}
        editable={editable}
        testID={testID}
      />
      {rightEl ?? null}
    </View>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <View style={errorStyles.wrap}>
      <Feather name="alert-circle" size={14} color="#ff6b6b" />
      <ThemedText style={errorStyles.text}>{message}</ThemedText>
    </View>
  );
}

const inputStyles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    height: 54,
  },
  icon: { marginRight: 10 },
  input: { flex: 1, fontSize: 16, color: "#18181B" },
});

const errorStyles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.12)",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: "rgba(255,100,100,0.4)",
  },
  text: { color: "#ffb3b3", fontSize: 13, flex: 1, lineHeight: 18 },
});

const styles = StyleSheet.create({
  root: { flex: 1, overflow: "hidden" },
  flex: { flex: 1 },
  gradientReadabilityOverlay: {
    ...StyleSheet.absoluteFill,
  },
  blob1: {
    position: "absolute",
    top: -80,
    right: -80,
    width: 300,
    height: 300,
    borderRadius: 150,
    opacity: 0.25,
  },
  blob2: {
    position: "absolute",
    top: 120,
    left: -100,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "#FFFFFF",
    opacity: 0.05,
  },
  blob3: {
    position: "absolute",
    bottom: 60,
    right: -60,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: "#FFFFFF",
    opacity: 0.04,
  },
  scroll: { flexGrow: 1, paddingHorizontal: Spacing["2xl"] },
  spacer: { flex: 1, minHeight: 20 },
  brand: { alignItems: "center", paddingBottom: Spacing.lg },
  eventLogoFrame: {
    marginBottom: Spacing.xl,
  },
  eventTitle: {
    color: "#fff",
    textAlign: "center",
    marginBottom: 4,
    letterSpacing: -0.5,
    fontWeight: "800",
    fontSize: 30,
  },
  eventYear: {
    color: "rgba(255,255,255,0.9)",
    textAlign: "center",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 10,
  },
  eventTagline: {
    color: "rgba(255,255,255,0.82)",
    textAlign: "center",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 10,
    maxWidth: 340,
  },
  datePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.14)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: BorderRadius.full,
  },
  dateLabel: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 13,
    fontWeight: "600",
  },
  noEventMessage: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 13,
    lineHeight: 19,
    maxWidth: 320,
    textAlign: "center",
    marginTop: Spacing.sm,
  },
  form: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 560,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 24,
    padding: Spacing["2xl"],
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xl,
    alignSelf: "flex-start",
  },
  formTitle: {
    marginBottom: 8,
    color: "#fff",
    letterSpacing: -0.3,
    fontWeight: "700",
  },
  formSub: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 14,
    marginBottom: Spacing["2xl"],
    lineHeight: 20,
  },
  activationStepIndicator: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    marginBottom: Spacing.xl,
    padding: Spacing.md,
  },
  activationStepEyebrow: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginBottom: Spacing.sm,
  },
  activationStepTrack: {
    alignItems: "center",
    flexDirection: "row",
  },
  activationStepTrackCompact: {
    alignItems: "stretch",
  },
  activationStep: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
  },
  activationStepCompact: {
    flex: 1,
    flexDirection: "column",
    gap: 4,
    justifyContent: "center",
  },
  activationStepNumber: {
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  activationStepNumberText: { fontSize: 12, fontWeight: "800" },
  activationStepLabel: {
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  activationStepConnector: {
    flex: 1,
    height: 1,
    marginHorizontal: Spacing.sm,
  },
  activationStepConnectorCompact: {
    flex: 0,
    alignSelf: "center",
    width: Spacing.md,
  },
  activationRecoveryNotice: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 8,
    marginBottom: Spacing.md,
    paddingHorizontal: 2,
  },
  activationRecoveryText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  passwordRequirements: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    gap: 8,
    marginBottom: Spacing.md,
    padding: Spacing.md,
  },
  passwordRequirementsTitle: {
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 2,
  },
  passwordRequirementRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  passwordRequirementText: {
    fontSize: 13,
    lineHeight: 18,
  },
  passwordMatchHint: {
    fontSize: 12,
    lineHeight: 17,
    marginBottom: Spacing.sm,
  },
  cta: { marginTop: Spacing.sm },
  eyeBtn: { padding: 4 },
  hint: {
    textAlign: "center",
    fontSize: 12,
    marginTop: Spacing.lg,
    lineHeight: 18,
    color: "rgba(255,255,255,0.45)",
  },
  eventChoice: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  eventChoiceText: { flex: 1 },
  eventChoiceTitle: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  eventChoiceYear: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
    marginTop: 5,
  },
  eventChoiceMeta: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 13,
    marginTop: 2,
  },
  linkBtn: { alignItems: "center", marginTop: Spacing.lg, padding: Spacing.sm },
  linkText: { fontSize: 14, fontWeight: "600", color: "rgba(255,255,255,0.8)" },
  disabledLinkText: { color: "rgba(255,255,255,0.4)" },
});
