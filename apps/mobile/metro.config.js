// Monorepo-aware Metro config. Without watchFolders + nodeModulesPaths, Metro
// cannot resolve workspace packages (@branches/engine) or the root-hoisted
// node_modules, and the bundler fails on import.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Workspace packages are consumed as TypeScript source (@branches/engine's
// entry is src/index.ts), so Metro must resolve and transform them itself.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
