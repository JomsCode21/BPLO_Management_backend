const path = require("path");
const esbuild = require("esbuild");
const fs = require("fs");

const buildDir = path.resolve(__dirname, "build");
const sourceEnv = path.resolve(__dirname, ".env");
const destinationEnv = path.resolve(buildDir, ".env");

const startTime = Date.now();

esbuild
  .build({
    entryPoints: [path.resolve(__dirname, "src/index.ts")],
    outfile: path.resolve(buildDir, "index.js"),
    bundle: true,
    target: "node14",
    platform: "node",
    sourcemap: false,
    minify: false,
    resolveExtensions: [".ts", ".tsx", ".js", ".json"],
    loader: {
      ".ts": "ts",
      ".tsx": "tsx",
    },
    banner: {
      js: "process.env.GEODATADIR = require('path').join(__dirname, 'data');",
    },
    external: [
      "geolite2-redist",
      "maxmind",
      "kerberos",
      "@mongodb-js/zstd",
      "mongodb-client-encryption",
      "@mongodb-js/zstd",
      "@aws-sdk/credential-providers",
      "snappy",
      "socks",
      "aws4",
      "mongodb-client-encryption",
    ],
    logLevel: "info",
    write: true,
  })
  .then(() => {
    // Copy geoip data
    const geoDataDir = path.resolve(__dirname, "node_modules/geoip-lite/data");
    const destDataDir = path.resolve(buildDir, "data");

    if (fs.existsSync(geoDataDir)) {
      if (!fs.existsSync(destDataDir)) fs.mkdirSync(destDataDir);

      // Copy the specific .dat files required
      const files = fs.readdirSync(geoDataDir);
      files.forEach(file => {
        fs.copyFileSync(path.join(geoDataDir, file), path.join(destDataDir, file));
      });
      console.log("GeoIP data files copied to build/data.");
    }

    const buildTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`Build completed in ${buildTime} seconds.`);
  })
  .catch((error) => {
    console.error("Build failed with errors:", error);
    process.exit(1);
  });
