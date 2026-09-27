const { getDefaultConfig } = require("expo/metro-config");
const { createProxyMiddleware } = require("http-proxy-middleware");

const config = getDefaultConfig(__dirname);
const defaultEnhanceMiddleware = config.server?.enhanceMiddleware;

// Ignore rotating workflow logs so Metro does not crash with ENOENT when a
// temporary log folder disappears.
config.resolver = {
  ...config.resolver,
  blockList: [
    ...(Array.isArray(config.resolver?.blockList)
      ? config.resolver.blockList
      : []),
    /[\/\\]\.local[\/\\]state[\/\\]workflow-logs[\/\\].*/,
    /[\/\\]\.local[\/\\]skills[\/\\].*/,
    /[\/\\]test-results[\/\\].*/,
    /[\/\\]\.config[\/\\]chromium[\/\\].*/,
  ],
};

config.server = {
  ...config.server,
  enhanceMiddleware: (middleware, server) => {
    const enhancedMiddleware = defaultEnhanceMiddleware
      ? defaultEnhanceMiddleware(middleware, server)
      : middleware;
    const apiProxy = createProxyMiddleware({
      target: "http://127.0.0.1:5000",
      changeOrigin: true,
      ws: false,
    });

    return (req, res, next) => {
      if (req.url?.startsWith("/api")) {
        return apiProxy(req, res, next);
      }
      return enhancedMiddleware(req, res, next);
    };
  },
};

module.exports = config;
