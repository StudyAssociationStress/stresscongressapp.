const requiredModules = [
  "expo",
  "expo-font",
  "@expo/vector-icons",
  "react",
  "react-native",
  "react-native-web",
];

const missingModules = requiredModules.filter((moduleName) => {
  try {
    require.resolve(moduleName);
    return false;
  } catch {
    return true;
  }
});

if (missingModules.length > 0) {
  console.error(
    `[expo-preflight] Missing modules: ${missingModules.join(
      ", ",
    )}. Run npm install before starting the preview.`,
  );
  process.exit(1);
}

console.log("[expo-preflight] Expo web dependencies resolved.");
