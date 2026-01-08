# Behavior Lens

**Behavior Lens** is a Visual Studio Code extension designed to visualize [BehaviorTree.CPP](https://github.com/BehaviorTree/BehaviorTree.CPP) XML files effectively. Gain insights into your behavior trees with an interactive preview.

## Features

- **Visualize Behavior Trees**: Open any `.xml` or `.tree` file containing BehaviorTree definitions.
- **Interactive Preview**: Zoom, pan, and inspect your trees.
- **Side Panel Support**: View your code and the tree visualization side-by-side.

## Usage

1. Open a BehaviorTree XML file.
2. Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P` on macOS).
3. Run **"BehaviorTree: Open Preview"** to open the preview in the active editor group.
4. Run **"BehaviorTree: Open Preview to the Side"** to open the preview in a separate column.

## Release Instructions

To release this extension to the Visual Studio Code Marketplace, follow these steps:

### Prerequisites

- [Node.js](https://nodejs.org/) installed.
- `vsce` (Visual Studio Code Extensions) CLI tool installed:
  ```bash
  npm install -g @vscode/vsce
  ```

### Publishing Steps

1. **Create a Publisher**:
   - Go to the [Marketplace Management Page](https://marketplace.visualstudio.com/manage).
   - Log in with your Microsoft account.
   - Click "Create Publisher" and fill in the details. Note your `publisher ID`.

2. **Login via CLI**:
   - Generate a Personal Access Token (PAT) from Azure DevOps (with "Marketplace > Acquire" and "Marketplace > Manage" scopes).
   - Run:
     ```bash
     vsce login <publisher id>
     ```

3. **Package the Extension** (Optional, to create a `.vsix` file):
   ```bash
   vsce package
   ```

4. **Publish to Marketplace**:
   ```bash
   vsce publish
   ```
   *Note: This will perform a build and upload the extension. You may need to bump the version in `package.json` for subsequent releases.*

### Useful Commands

- `npm run compile`: Compiles the TypeScript code.
- `npm run watch`: Watches for changes and compiles automatically.
- `npm test`: Runs the test suite.
