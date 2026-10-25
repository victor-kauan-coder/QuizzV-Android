const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Builds nativos (Gradle, Tauri) não têm JS do app e mudam/travam arquivos
// durante a compilação, o que derruba o watcher do Metro.
const escape = (s) => s.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
// o watcher do Windows compara caminhos com "/", o resolver com "\"
const dir = (name) =>
  new RegExp(`^${path.join(__dirname, name).split(path.sep).map(escape).join("[\\\\/]")}([\\\\/]|$)`, "i");
config.resolver.blockList = [dir("android"), dir("src-tauri")];

module.exports = config;
